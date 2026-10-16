import { describe, expect, it } from 'vitest';
import { addUsage, cancelWork, canCancel, checkOut, initialState, setRules, startWork, suggestedGoal, topApps, CANCEL_MS } from './model';
import { addBlocked, normalizeExe } from './programs';
import { parseState } from './store';
import { fmtClock, fmtDuration, weekStart, weekSummary } from './stats';

const T0 = new Date(2026, 9, 14, 9, 0).getTime(); // Wednesday 14 Oct 2026, 09:00 local
const MIN = 60_000;

describe('work sessions', () => {
  it('starts work with a goal and checks out to free time', () => {
    let s = initialState(T0);
    expect(s.mode).toBe('free');
    s = startWork(s, '  Fix the sync bug  ', T0);
    expect(s.mode).toBe('work');
    expect(s.current?.goal).toBe('Fix the sync bug');
    s = addUsage(s, { 'code.exe': 30 * MIN, 'chrome.exe': 5 * MIN });
    s = addUsage(s, { 'code.exe': 10 * MIN });
    s = checkOut(s, 'partly', ' Write the tests ', T0 + 60 * MIN);
    expect(s.mode).toBe('free');
    expect(s.current).toBeNull();
    expect(s.since).toBe(T0 + 60 * MIN);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ goal: 'Fix the sync bug', outcome: 'partly', next: 'Write the tests', end: T0 + 60 * MIN });
    expect(s.log[0].usage).toEqual({ 'code.exe': 40 * MIN, 'chrome.exe': 5 * MIN });
    expect(suggestedGoal(s)).toBe('Write the tests');
  });

  it('needs a goal, and does not start twice', () => {
    const s = initialState(T0);
    expect(startWork(s, '   ', T0)).toBe(s);
    const w = startWork(s, 'A', T0);
    expect(startWork(w, 'B', T0 + 1)).toBe(w);
  });

  it('checking out outside work changes nothing', () => {
    const s = initialState(T0);
    expect(checkOut(s, 'done', '', T0)).toBe(s);
  });

  it('a skipped check-out is logged but its next step is not suggested', () => {
    let s = startWork(initialState(T0), 'A', T0);
    s = checkOut(s, 'done', 'B next', T0 + MIN);
    s = startWork(s, 'C', T0 + 2 * MIN);
    s = checkOut(s, 'skipped', '', T0 + 3 * MIN);
    expect(s.log.map((w) => w.outcome)).toEqual(['skipped', 'done']);
    expect(suggestedGoal(s)).toBe('B next');
  });

  it('can be cancelled only right after starting', () => {
    const s = startWork(initialState(T0), 'Oops', T0);
    expect(canCancel(s, T0 + CANCEL_MS - 1)).toBe(true);
    const c = cancelWork(s, T0 + MIN);
    expect(c.mode).toBe('free');
    expect(c.log).toHaveLength(0);
    expect(cancelWork(s, T0 + CANCEL_MS)).toBe(s);
  });

  it('ignores bad usage and usage outside work', () => {
    const free = initialState(T0);
    expect(addUsage(free, { 'a.exe': 5 })).toBe(free);
    const s = startWork(free, 'A', T0);
    expect(addUsage(s, { 'a.exe': -1, '': 5, 'b.exe': NaN })).toBe(s);
  });

  it('lists the top programs and sums the rest', () => {
    const { apps, other } = topApps({ 'a.exe': 1, 'b.exe': 5, 'c.exe': 3, 'd.exe': 0 }, 2);
    expect(apps).toEqual([
      ['b.exe', 5],
      ['c.exe', 3],
    ]);
    expect(other).toBe(1);
  });
});

describe('program names', () => {
  it('normalizes what the user types or picks', () => {
    expect(normalizeExe('Steam')).toBe('steam.exe');
    expect(normalizeExe('  "C:\\Program Files\\Steam\\Steam.EXE" ')).toBe('steam.exe');
    expect(normalizeExe('discord.exe')).toBe('discord.exe');
    expect(normalizeExe('')).toBe('');
    expect(normalizeExe('a|b')).toBe('');
  });

  it('never blocks Windows or Modes, nor twice', () => {
    expect(addBlocked([], 'explorer')).toMatchObject({ ok: false });
    expect(addBlocked([], 'Modes.exe')).toMatchObject({ ok: false });
    expect(addBlocked([], 'notes.txt')).toMatchObject({ ok: false });
    expect(addBlocked(['steam.exe'], 'STEAM')).toMatchObject({ ok: false });
    expect(addBlocked(['steam.exe'], 'Discord')).toEqual({ ok: true, list: ['discord.exe', 'steam.exe'] });
  });
});

describe('saved state', () => {
  it('round-trips', () => {
    let s = startWork(initialState(T0), 'A', T0);
    s = addUsage(s, { 'code.exe': MIN });
    s = setRules(s, 'free', { blocked: ['slack.exe'], startup: [{ target: 'https://example.com', args: '' }] });
    expect(parseState(JSON.stringify(s), T0 + 5)).toEqual(s);
  });

  it('falls back to defaults for missing or broken data', () => {
    expect(parseState(null, T0)).toEqual(initialState(T0));
    expect(parseState('{nope', T0)).toEqual(initialState(T0));
    expect(parseState('{"v":2}', T0)).toEqual(initialState(T0));
    const odd = parseState(
      JSON.stringify({
        v: 1,
        mode: 'work',
        current: null,
        rules: { work: { blocked: ['Explorer.exe', 'STEAM', 5], startup: [{ target: '' }, { target: 'x.exe' }] } },
        log: [{ start: 1, goal: 'g' }, { start: 2, end: 3, goal: 'h', outcome: 'done', usage: { 'a.exe': -4, 'b.exe': 7 } }],
      }),
      T0,
    );
    // Work without a session is free time.
    expect(odd.mode).toBe('free');
    expect(odd.rules.work).toEqual({ blocked: ['steam.exe'], startup: [{ target: 'x.exe', args: '' }] });
    expect(odd.rules.free).toEqual(initialState(T0).rules.free);
    // The unfinished session in the log is dropped.
    expect(odd.log).toHaveLength(1);
    expect(odd.log[0].usage).toEqual({ 'b.exe': 7 });
  });
});

describe('week summary', () => {
  it('starts on Monday', () => {
    expect(new Date(weekStart(T0)).getDay()).toBe(1);
    expect(weekStart(T0)).toBe(new Date(2026, 9, 12).getTime());
  });

  it('counts this week only and scores partly as half', () => {
    let s = initialState(T0 - 7 * 24 * 60 * MIN);
    s = startWork(s, 'last week', s.since);
    s = checkOut(s, 'not', '', s.since + MIN);
    for (const o of ['done', 'partly', 'skipped'] as const) {
      s = startWork(s, o, T0);
      s = addUsage(s, { 'a.exe': 20 * MIN });
      s = checkOut(s, o, '', T0 + 30 * MIN);
    }
    const w = weekSummary(s.log, T0 + 60 * MIN);
    expect(w.sessions).toBe(3);
    expect(w.totalMs).toBe(90 * MIN);
    expect(w.activeMs).toBe(60 * MIN);
    expect(w.outcomes).toEqual({ done: 1, partly: 1, not: 0, skipped: 1 });
    expect(w.score).toBe(0.75);
    expect(weekSummary([], T0).score).toBeNull();
  });

  it('formats durations', () => {
    expect(fmtDuration(65 * MIN)).toBe('1h 05m');
    expect(fmtDuration(12 * MIN + 5000)).toBe('12m');
    expect(fmtDuration(40_000)).toBe('40s');
    expect(fmtClock(3_909_000)).toBe('1:05:09');
  });
});
