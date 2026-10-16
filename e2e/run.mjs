// End-to-end checks of the built app in Chromium, with a fake Windows side and a fake clock.
//
//   npm run e2e                     (builds first)
//   CHROMIUM_PATH=/path/to/chrome   to use a given browser (else Playwright's own)
//
// The fake Tauri records every `invoke` (window.__calls) and lets a test send the events Rust sends
// (window.__emit('tray', 'switch'), window.__emit('blocked', 'steam.exe')).

import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const MIN = 60_000;
const GOAL = 'e.g. Finish the sync conflict fix';

function fakeTauri() {
  const cbs = new Map();
  let n = 1;
  const listeners = {};
  window.__calls = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) {
      const id = n++;
      cbs.set(id, cb);
      return id;
    },
    unregisterCallback(id) {
      cbs.delete(id);
    },
    async invoke(cmd, args) {
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') {
        (listeners[args.event] ??= []).push(args.handler);
        return n++;
      }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'running_blocked') return args.names.filter((x) => x === 'steam.exe');
      if (cmd === 'running_programs') return ['code.exe', 'steam.exe', 'spotify.exe'];
      if (cmd === 'take_usage') return { 'code.exe': 9000 };
      if (cmd === 'started_at_login') return false;
      if (cmd === 'export_file') return `C:\\Users\\me\\Downloads\\${args.name}`;
      return null;
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  };
  window.__emit = (event, payload) => (listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, payload, id: 0 }));
}

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failed = 0;

async function scenario(name, { tauri = true, time = new Date(2026, 9, 14, 8, 58), viewport = { width: 1000, height: 640 } } = {}, fn) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  if (tauri) await ctx.addInitScript(fakeTauri);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.clock.install({ time });
  await p.goto(URL);
  const t0 = Date.now();
  try {
    await fn(p);
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.stack ?? e).split('\n').slice(0, 6).join('\n     ')}`);
    await p.screenshot({ path: `e2e/fail-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  }
  await ctx.close();
}

const calls = (p, cmd) => p.evaluate((c) => window.__calls.filter((x) => x[0] === c).map((x) => x[1]), cmd);
const lastMode = async (p) => (await calls(p, 'set_mode')).at(-1);
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('modes-state')));
const tab = (p, name) => p.getByRole('tab', { name }).click();
const dialog = (p, title) => p.locator(`[role=dialog][aria-label="${title}"]`);

async function startWork(p, goal, lock) {
  await p.getByText('START WORK…').click();
  if (lock) await p.getByRole('radio', { name: `${lock} min` }).click();
  await p.getByPlaceholder(GOAL).fill(goal);
  await p.getByPlaceholder(GOAL).press('Enter');
  await p.locator('.mode-tag.work').waitFor();
}

await scenario('start, rules lock, check out, next goal', {}, async (p) => {
  await p.getByText('Got it').click();
  await startWork(p, 'Write the release notes');
  // Regression: the Enter that starts work must not also press END WORK.
  assert.equal(await p.getByRole('dialog').count(), 0, 'no dialog after starting with Enter');
  const m = await lastMode(p);
  assert.equal(m.mode, 'work');
  assert.equal(m.tracking, true);
  assert.equal(m.status, 'WORK: Write the release notes');
  assert.deepEqual(m.blocked, ['discord.exe', 'epicgameslauncher.exe', 'steam.exe']);

  await tab(p, 'RULES');
  assert.equal(await p.locator('[aria-label="Unblock steam.exe"]').count(), 0, 'work list locked during work');
  await p.getByLabel('Block a program in WORK').fill('explorer');
  await p.getByLabel('Block a program in WORK').press('Enter');
  await p.getByText('never blocked').waitFor();
  await p.getByRole('button', { name: 'RUNNING…' }).first().click();
  await p.getByRole('button', { name: '+ spotify' }).click();
  assert.ok((await saved(p)).rules.work.blocked.includes('spotify.exe'));

  await tab(p, 'NOW');
  await p.clock.runFor(3 * MIN);
  await p.getByText('END WORK…').click();
  const end = dialog(p, 'END WORK').locator('.wfoot .btn.primary');
  assert.equal(await end.isDisabled(), true, 'END needs an answer');
  assert.equal(await p.getByText('Started by mistake').count(), 0, 'no cancel after 2 min');
  await p.getByRole('radio', { name: 'Partly' }).click();
  await p.getByPlaceholder('What is left?').fill('Proofread and publish');
  await end.click();
  await p.locator('.mode-tag.free').waitFor();
  const s = await saved(p);
  assert.equal(s.log.length, 1);
  assert.equal(s.log[0].outcome, 'partly');
  assert.equal(s.log[0].next, 'Proofread and publish');
  await p.getByText('START WORK…').click();
  assert.equal(await p.getByPlaceholder(GOAL).inputValue(), 'Proofread and publish', 'next step offered as goal');
});

await scenario('a mistaken start is cancelled without a log entry', {}, async (p) => {
  await startWork(p, 'Oops');
  await p.evaluate(() => window.__emit('tray', 'switch'));
  await dialog(p, 'END WORK').waitFor();
  await p.getByText('Started by mistake').click();
  await p.locator('.mode-tag.free').waitFor();
  assert.equal((await saved(p)).log.length, 0);
});

await scenario('work hours, focus lock, tries, hotkey', {}, async (p) => {
  await tab(p, 'RULES');
  await p.getByLabel('Block a site in WORK').fill('https://www.YouTube.com/watch?v=1');
  await p.getByLabel('Block a site in WORK').press('Enter');
  await p.getByText('Work hours: ask me').click();
  // 09:00 on a Wednesday: the schedule asks.
  await p.clock.runFor(3 * MIN);
  await dialog(p, 'START WORK').waitFor();
  assert.ok((await calls(p, 'notify')).some((c) => c.title === 'Time to start work'));
  assert.ok((await calls(p, 'show_window')).length > 0);
  await p.getByRole('radio', { name: '25 min' }).click();
  await p.getByPlaceholder(GOAL).fill('Ship it');
  await p.getByRole('button', { name: 'START WORK', exact: true }).click();
  await p.getByText('Focus lock until').waitFor();
  assert.deepEqual((await lastMode(p)).sites, ['youtube.com', 'youtube']);

  await p.evaluate(() => ['steam.exe', 'youtube', 'steam.exe'].forEach((n) => window.__emit('blocked', n)));
  await p.getByText('Blocked 3× during work').waitFor();

  const end = dialog(p, 'END WORK').locator('.wfoot .btn.primary');
  await p.clock.runFor(10 * MIN);
  await p.evaluate(() => window.__emit('tray', 'switch'));
  await p.getByRole('radio', { name: 'Done', exact: true }).click();
  assert.equal(await end.isDisabled(), true, 'locked');
  assert.equal(await p.getByText('Skip check-out').count(), 0, 'no skip while locked');
  await p.keyboard.press('Escape');
  await p.clock.runFor(16 * MIN);
  await p.evaluate(() => window.__emit('tray', 'switch'));
  await p.getByRole('radio', { name: 'Done', exact: true }).click();
  assert.equal(await end.isDisabled(), false, 'unlocked after 25 min');
  await end.click();
  await p.locator('.mode-tag.free').waitFor();
  const s = await saved(p);
  assert.deepEqual(s.log[0].tries, { 'steam.exe': 2, youtube: 1 });
  // Not asked again today.
  await p.clock.runFor(5 * MIN);
  assert.equal(await p.getByRole('dialog').count(), 0);
  // 17:00: asked to check out work begun before it.
  await startWork(p, 'Afternoon');
  // Jump (timers fire once) instead of running 8 hours of 1 s ticks.
  await p.clock.fastForward(8 * 60 * MIN);
  await dialog(p, 'END WORK').waitFor();
  assert.ok((await calls(p, 'notify')).some((c) => c.title === 'Work hours are over'));
});

await scenario('breaks pause blocking and end by themselves', {}, async (p) => {
  await startWork(p, 'Deep work');
  await p.getByRole('button', { name: '10 min', exact: true }).click();
  await p.getByText('ON BREAK').waitFor();
  let m = await lastMode(p);
  assert.deepEqual([m.blocked, m.sites, m.tracking], [[], [], false], 'nothing blocked or measured on a break');
  assert.match(m.status, /on break until/);
  await p.clock.runFor(10 * MIN + 2000);
  await p.getByText('Break over').first().waitFor();
  assert.ok((await calls(p, 'notify')).some((c) => c.title === 'Break over'));
  m = await lastMode(p);
  assert.equal(m.tracking, true);
  assert.ok(m.blocked.includes('steam.exe'), 'blocking back on');
  await p.getByRole('button', { name: '5 min', exact: true }).click();
  await p.clock.runFor(2 * MIN);
  await p.getByText('END BREAK NOW').click();
  await p.clock.runFor(MIN);
  await p.getByText('END WORK…').click();
  await dialog(p, 'END WORK').getByText(/1m worked · 12m break/).waitFor();
  await p.getByRole('radio', { name: 'Done', exact: true }).click();
  await dialog(p, 'END WORK').locator('.wfoot .btn.primary').click();
  await p.locator('.mode-tag.free').waitFor();
  const w = (await saved(p)).log[0];
  assert.equal(w.breaks.length, 2);
  // The fake clock also runs in real time between steps: allow a second.
  assert.ok(Math.abs(w.breaks.reduce((a, b) => a + b.to - b.from, 0) - 12 * MIN) < 1000, 'breaks add up to 12 min');
});

await scenario('log: chart, streak, export, delete', {}, async (p) => {
  await startWork(p, 'Logged work');
  await p.clock.runFor(30 * MIN);
  await p.getByText('END WORK…').click();
  await p.getByRole('radio', { name: 'Done', exact: true }).click();
  await dialog(p, 'END WORK').locator('.wfoot .btn.primary').click();
  await p.locator('.mode-tag.free').waitFor();
  await tab(p, 'LOG');
  assert.equal(await p.locator('.chart .col').count(), 7);
  assert.match(await p.locator('.chart .col').last().getAttribute('title'), /Wed 14 Oct: 30m, 1 session, 1 done/);
  assert.match(await p.locator('.stats').innerText(), /1\s+day in a row done/);
  await p.getByText('EXPORT CSV').click();
  await p.getByText('Saved C:').waitFor();
  const exp = (await calls(p, 'export_file'))[0];
  assert.match(exp.name, /^modes-log-2026-10-14\.csv$/);
  assert.match(exp.contents, /^date,start,end,worked_min/);
  assert.match(exp.contents, /2026-10-14,08:58,09:28,30,0,\d+,Logged work,Done,/);
  await p.getByLabel('Delete this session').click();
  await p.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal((await saved(p)).log.length, 0);
});

await scenario('browser download export without Windows', { tauri: false }, async (p) => {
  await startWork(p, 'In a browser');
  await p.clock.runFor(5 * MIN);
  await p.getByText('END WORK…').click();
  await p.getByRole('radio', { name: 'Done', exact: true }).click();
  await dialog(p, 'END WORK').locator('.wfoot .btn.primary').click();
  await p.locator('.mode-tag.free').waitFor();
  await tab(p, 'LOG');
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByText('EXPORT CSV').click()]);
  assert.equal(download.suggestedFilename(), 'modes-log-2026-10-14.csv');
});

for (const scheme of ['light', 'dark']) {
  await scenario(`phone width, ${scheme}: no sideways scroll`, { viewport: { width: 390, height: 740 } }, async (p) => {
    await p.emulateMedia({ colorScheme: scheme });
    for (const t of ['NOW', 'RULES', 'LOG']) {
      await tab(p, t);
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= 390, `${t} is ${w}px wide`);
    }
    await tab(p, 'NOW');
    await p.getByText('START WORK…').click();
    const box = await dialog(p, 'START WORK').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'dialog fits');
  });
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));
if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
