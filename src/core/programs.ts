// Program names as the blocker sees them: the lower-case file name of the executable.

/** Windows itself and Modes: never blocked, whatever the rules say. Mirrors `PROTECTED` in src-tauri/src/rules.rs. */
export const PROTECTED = [
  'system',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'svchost.exe',
  'dwm.exe',
  'explorer.exe',
  'sihost.exe',
  'fontdrvhost.exe',
  'ctfmon.exe',
  'conhost.exe',
  'taskmgr.exe',
  'lockapp.exe',
  'logonui.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'textinputhost.exe',
  'runtimebroker.exe',
  'msedgewebview2.exe',
  'modes.exe',
];

export function isProtected(name: string): boolean {
  return PROTECTED.includes(name);
}

/**
 * What the user typed or picked, as a program file name: `C:\Games\Steam.EXE` and `Steam` are both
 * `steam.exe`. Returns '' for something that is not a program name.
 */
export function normalizeExe(input: string): string {
  let s = input.trim().replace(/^"+|"+$/g, '').trim();
  s = s.split(/[\\/]/).pop() ?? '';
  s = s.toLowerCase();
  if (!s || /[<>:"|?*]/.test(s) || /[\x00-\x1f]/.test(s)) return '';
  if (!/\.[a-z0-9]+$/.test(s)) s += '.exe';
  return s === '.exe' ? '' : s;
}

export type AddResult = { ok: true; list: string[] } | { ok: false; reason: string };

/** Adds a program to a blocklist, or says why it cannot be blocked. */
export function addBlocked(list: string[], input: string): AddResult {
  const name = normalizeExe(input);
  if (!name) return { ok: false, reason: 'Not a program name.' };
  if (!name.endsWith('.exe')) return { ok: false, reason: 'Only programs (.exe) can be blocked.' };
  if (isProtected(name)) return { ok: false, reason: `${name} is part of Windows or Modes and is never blocked.` };
  if (list.includes(name)) return { ok: false, reason: `${name} is already on the list.` };
  return { ok: true, list: [...list, name].sort() };
}

/** `steam.exe` → `steam` for display. */
export function shortName(exe: string): string {
  return exe.replace(/\.exe$/, '');
}

// ───────── Sites ─────────
// A blocked site is matched against browser tab titles (see `site_in_title` in src-tauri/src/rules.rs):
// a title like "Some video - YouTube - Google Chrome" has the part "YouTube".

/** What the user typed as a site: `https://www.YouTube.com/watch?v=1` is `youtube.com`; '' if it is not one. */
export function normalizeSite(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0] ?? '';
  s = s.replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (!s || !/^[a-z0-9.-]+$/.test(s) || !/[a-z]/.test(s) || s.startsWith('.') || s.includes('..')) return '';
  return s;
}

const SECOND_LEVEL = ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'];

/**
 * The words a tab title shows for a site, lower case: `youtube.com` → `youtube.com` and `youtube`;
 * `bbc.co.uk` → also `bbc`; a plain `reddit` → `reddit`. A subdomain such as `music.youtube.com` is only
 * itself, so it never blocks all of YouTube. Mirrors nothing in Rust: Rust gets these keys.
 */
export function siteKeys(site: string): string[] {
  const labels = site.split('.');
  const n = labels.length;
  const ccSecond = n === 3 && SECOND_LEVEL.includes(labels[1]) && labels[2].length === 2;
  if (n === 1) return [site];
  if (n === 2) return [site, labels[0]];
  if (ccSecond) return [site, labels[0]];
  return [site];
}

/** Adds a site to a blocklist, or says why it cannot be added. */
export function addSite(list: string[], input: string): AddResult {
  const site = normalizeSite(input);
  if (!site) return { ok: false, reason: 'Not a site. Type it like youtube.com.' };
  if (list.includes(site)) return { ok: false, reason: `${site} is already on the list.` };
  return { ok: true, list: [...list, site].sort() };
}
