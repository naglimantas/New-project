// The Windows side (src-tauri/src/lib.rs). In a plain browser (`npm run dev`) every call is a harmless
// stand-in, so the UI can be worked on without Windows.

import type { ModeId } from '../core/model';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!isDesktop) return fallback;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * Tells Windows the mode: what to block (programs, and the title words of sites from `siteKeys`),
 * whether to count program time, and what the tray shows (`label` the mode's name, `status` its line).
 */
export function setMode(mode: ModeId, label: string, status: string, blocked: string[], sites: string[], tracking: boolean): Promise<void> {
  return call('set_mode', { mode, label, status, blocked, sites, tracking }, undefined);
}

/** A Windows notification (in a browser: nothing). */
export function notify(title: string, body: string): Promise<void> {
  return call('notify', { title, body }, undefined);
}

/** Brings the window forward. */
export function showWindow(): Promise<void> {
  return call('show_window', {}, undefined);
}

/** Which of these programs are running now. */
export function runningBlocked(names: string[]): Promise<string[]> {
  return call('running_blocked', { names }, []);
}

/** Programs with a window open now. */
export function runningPrograms(): Promise<string[]> {
  return call('running_programs', {}, []);
}

/** Program time counted since the last call (ms per program). */
export function takeUsage(): Promise<Record<string, number>> {
  return call('take_usage', {}, {});
}

/** Opens a program, shortcut, file, folder or URL. Rejects with a reason. */
export function openItem(target: string, args: string): Promise<void> {
  if (!isDesktop && /^https?:\/\//i.test(target)) {
    window.open(target, '_blank', 'noopener');
    return Promise.resolve();
  }
  return call('open_item', { target, args }, undefined);
}

export function setAutostart(on: boolean): Promise<void> {
  return call('set_autostart', { on }, undefined);
}

/** Lets the user pick a file; null when cancelled or outside Windows. */
export async function pickFile(): Promise<string | null> {
  if (!isDesktop) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: 'Programs and shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return typeof r === 'string' ? r : null;
}

/** Listens to an event from Windows; returns the way to stop listening. */
export function onNative(event: 'tray' | 'blocked', fn: (payload: string) => void): () => void {
  if (!isDesktop) return () => {};
  let stop: (() => void) | null = null;
  let stopped = false;
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<string>(event, (e) => fn(e.payload)).then((un) => {
      if (stopped) un();
      else stop = un;
    }),
  );
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Modes was started with Windows (not by the user). */
export function startedAtLogin(): Promise<boolean> {
  return call('started_at_login', {}, false);
}
