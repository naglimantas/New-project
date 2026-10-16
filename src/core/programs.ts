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
