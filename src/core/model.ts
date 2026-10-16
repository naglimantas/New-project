// The whole state of Modes, and the pure functions that change it. No UI, no Tauri: everything
// here takes `now` explicitly so it can be tested.

export type ModeId = 'work' | 'free';

/** Something to open when a mode starts: a program, a shortcut, a file, a folder or a URL. */
export interface StartItem {
  target: string;
  args: string;
}

export interface ModeRules {
  /** Program file names closed while the mode is on, lower case (`steam.exe`), sorted. */
  blocked: string[];
  startup: StartItem[];
}

export type Outcome = 'done' | 'partly' | 'not' | 'skipped';

export interface WorkSession {
  id: string;
  start: number;
  /** Set when the session is checked out. */
  end: number | null;
  goal: string;
  outcome: Outcome | null;
  /** What to do next time; offered as the next session's goal. */
  next: string;
  /** Milliseconds each program was in front during the session (idle time is not counted). */
  usage: Record<string, number>;
}

export interface Settings {
  /** Start Modes with Windows, hidden in the tray. */
  autostart: boolean;
  /** Open the mode's startup items when it starts. */
  openStartup: boolean;
}

export interface State {
  v: 1;
  mode: ModeId;
  /** When the current mode started. */
  since: number;
  rules: Record<ModeId, ModeRules>;
  /** The running work session (only while `mode` is `work`). */
  current: WorkSession | null;
  /** Finished work sessions, newest first. */
  log: WorkSession[];
  settings: Settings;
}

export const MODES: ModeId[] = ['work', 'free'];
export const MODE_NAME: Record<ModeId, string> = { work: 'WORK', free: 'FREE TIME' };

export const OUTCOME_NAME: Record<Outcome, string> = {
  done: 'Done',
  partly: 'Partly',
  not: 'Not done',
  skipped: 'Skipped check-out',
};

/** A session this short can be cancelled instead of checked out (started by mistake). */
export const CANCEL_MS = 2 * 60_000;

/** How many finished sessions are kept. */
export const LOG_MAX = 1000;

export const GOAL_MAX = 200;

export function initialState(now: number): State {
  return {
    v: 1,
    mode: 'free',
    since: now,
    rules: {
      work: { blocked: ['discord.exe', 'epicgameslauncher.exe', 'steam.exe'], startup: [] },
      // Empty: Modes starts in free time, and nothing should close without the user choosing it.
      free: { blocked: [], startup: [] },
    },
    current: null,
    log: [],
    settings: { autostart: true, openStartup: true },
  };
}

export function startWork(s: State, goal: string, now: number): State {
  const g = goal.trim().slice(0, GOAL_MAX);
  if (!g || s.mode === 'work') return s;
  return {
    ...s,
    mode: 'work',
    since: now,
    current: { id: `w${now.toString(36)}`, start: now, end: null, goal: g, outcome: null, next: '', usage: {} },
  };
}

/** Leaves work: the session goes to the log with how it went. */
export function checkOut(s: State, outcome: Outcome, next: string, now: number): State {
  if (s.mode !== 'work') return s;
  const log = s.current
    ? [{ ...s.current, end: Math.max(now, s.current.start), outcome, next: next.trim().slice(0, GOAL_MAX) }, ...s.log].slice(0, LOG_MAX)
    : s.log;
  return { ...s, mode: 'free', since: now, current: null, log };
}

/** Leaves work without a trace. Only allowed in the first `CANCEL_MS`. */
export function cancelWork(s: State, now: number): State {
  if (!canCancel(s, now)) return s;
  return { ...s, mode: 'free', since: now, current: null };
}

export function canCancel(s: State, now: number): boolean {
  return s.mode === 'work' && !!s.current && now - s.current.start < CANCEL_MS;
}

/** Adds program time measured since the last call to the running session. */
export function addUsage(s: State, delta: Record<string, number>): State {
  if (!s.current) return s;
  const usage = { ...s.current.usage };
  let changed = false;
  for (const [app, ms] of Object.entries(delta)) {
    if (!app || !Number.isFinite(ms) || ms <= 0) continue;
    usage[app] = (usage[app] ?? 0) + ms;
    changed = true;
  }
  return changed ? { ...s, current: { ...s.current, usage } } : s;
}

/** The "next step" written at the last check-out, offered as the next goal. */
export function suggestedGoal(s: State): string {
  return s.log.find((w) => w.outcome !== 'skipped')?.next ?? '';
}

export function setRules(s: State, mode: ModeId, rules: ModeRules): State {
  return { ...s, rules: { ...s.rules, [mode]: rules } };
}

export function activeMs(usage: Record<string, number>): number {
  return Object.values(usage).reduce((a, b) => a + b, 0);
}

/** The programs used most, longest first; the rest summed up as `other`. */
export function topApps(usage: Record<string, number>, n: number): { apps: [string, number][]; other: number } {
  const all = Object.entries(usage)
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { apps: all.slice(0, n), other: activeMs(Object.fromEntries(all.slice(n))) };
}
