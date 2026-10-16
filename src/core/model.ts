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
  /** Sites whose browser tab is closed while the mode is on (`youtube.com`), sorted. */
  sites: string[];
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
  /** How often each blocked program or site was opened and closed again. */
  tries: Record<string, number>;
  /** Work cannot be ended before this (a lock chosen at the start); null without one. */
  lockUntil: number | null;
  /** Finished breaks: nothing was blocked or measured during them. */
  breaks: Break[];
  /** The break going on now (`until` is when it ends by itself); null outside one. */
  onBreak: { from: number; until: number } | null;
}

export interface Break {
  from: number;
  to: number;
}

/** Work hours: Modes asks to start work at `start` and to check out at `end` on these days. */
export interface Schedule {
  on: boolean;
  /** 0 = Sunday … 6 = Saturday, sorted. */
  days: number[];
  /** Minutes after midnight, `start < end`. */
  start: number;
  end: number;
}

export interface Settings {
  /** Start Modes with Windows, hidden in the tray. */
  autostart: boolean;
  /** Open the mode's startup items when it starts. */
  openStartup: boolean;
  schedule: Schedule;
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
  /** The day (`dayKey`) each schedule prompt last came, so it comes once a day. */
  prompted: { start: string; end: string };
  /** The first-run guide on NOW was closed. */
  guideDone: boolean;
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

/** The focus locks offered when work starts, in minutes. */
export const LOCKS = [0, 25, 50, 90];

/** The breaks offered during work, in minutes. */
export const BREAKS = [5, 10, 15];

/** How many finished sessions are kept. */
export const LOG_MAX = 1000;

export const GOAL_MAX = 200;

export function initialState(now: number): State {
  return {
    v: 1,
    mode: 'free',
    since: now,
    rules: {
      work: { blocked: ['discord.exe', 'epicgameslauncher.exe', 'steam.exe'], sites: [], startup: [] },
      // Empty: Modes starts in free time, and nothing should close without the user choosing it.
      free: { blocked: [], sites: [], startup: [] },
    },
    current: null,
    log: [],
    settings: { autostart: true, openStartup: true, schedule: { on: false, days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 } },
    prompted: { start: '', end: '' },
    guideDone: false,
  };
}

/** The local day of `t`, `2026-10-16`. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `minutes` after local midnight of the day of `t`. */
export function atMinutes(t: number, minutes: number): number {
  const d = new Date(t);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

/** Starts work on `goal`, optionally locked for `lockMin` minutes. */
export function startWork(s: State, goal: string, now: number, lockMin = 0): State {
  const g = goal.trim().slice(0, GOAL_MAX);
  if (!g || s.mode === 'work') return s;
  return {
    ...s,
    mode: 'work',
    since: now,
    current: {
      id: `w${now.toString(36)}`,
      start: now,
      end: null,
      goal: g,
      outcome: null,
      next: '',
      usage: {},
      tries: {},
      lockUntil: lockMin > 0 ? now + lockMin * 60_000 : null,
      breaks: [],
      onBreak: null,
    },
    // Work started today: the schedule does not need to ask any more.
    prompted: { ...s.prompted, start: dayKey(now) },
  };
}

export function isLocked(s: State, now: number): boolean {
  return s.mode === 'work' && !!s.current?.lockUntil && now < s.current.lockUntil;
}

/** Leaves work: the session goes to the log with how it went. Not while it is locked. */
export function checkOut(s: State, outcome: Outcome, next: string, now: number): State {
  if (s.mode !== 'work' || isLocked(s, now)) return s;
  const w = s.current && endBreak(s, Math.min(now, s.current.onBreak?.until ?? now)).current;
  const log = w ? [{ ...w, end: Math.max(now, w.start), outcome, next: next.trim().slice(0, GOAL_MAX) }, ...s.log].slice(0, LOG_MAX) : s.log;
  return { ...s, mode: 'free', since: now, current: null, log };
}

/** A break of `min` minutes during work: nothing is blocked or measured until it ends. */
export function startBreak(s: State, min: number, now: number): State {
  if (!s.current || s.current.onBreak || min <= 0) return s;
  return { ...s, current: { ...s.current, onBreak: { from: now, until: now + min * 60_000 } } };
}

/** Ends the break now (or at `now`, however it ended). */
export function endBreak(s: State, now: number): State {
  const b = s.current?.onBreak;
  if (!s.current || !b) return s;
  const to = Math.max(b.from, Math.min(now, b.until));
  const breaks = to > b.from ? [...s.current.breaks, { from: b.from, to }] : s.current.breaks;
  return { ...s, current: { ...s.current, breaks, onBreak: null } };
}

export function isOnBreak(s: State, now: number): boolean {
  return !!s.current?.onBreak && now < s.current.onBreak.until;
}

/** A break whose time is up, ended at its planned end; otherwise the state as it is. */
export function settleBreak(s: State, now: number): State {
  const b = s.current?.onBreak;
  return b && now >= b.until ? endBreak(s, b.until) : s;
}

/** Break time of a session, the running break up to `now` included. */
export function breakMs(w: WorkSession, now = Infinity): number {
  const done = w.breaks.reduce((a, b) => a + (b.to - b.from), 0);
  const b = w.onBreak;
  return done + (b ? Math.max(0, Math.min(now, b.until) - b.from) : 0);
}

/** Time from start to end (or `now`) without breaks. */
export function workedMs(w: WorkSession, now: number): number {
  return Math.max(0, (w.end ?? now) - w.start - breakMs(w, w.end ?? now));
}

/** Leaves work without a trace. Only allowed in the first `CANCEL_MS` (also when locked). */
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

/** A blocked program or site was opened during work (and closed again). */
export function addTry(s: State, name: string): State {
  if (!s.current || !name) return s;
  const tries = { ...s.current.tries, [name]: (s.current.tries[name] ?? 0) + 1 };
  return { ...s, current: { ...s.current, tries } };
}

export function deleteSession(s: State, id: string): State {
  const log = s.log.filter((w) => w.id !== id);
  return log.length === s.log.length ? s : { ...s, log };
}

/** The "next step" written at the last check-out, offered as the next goal. */
export function suggestedGoal(s: State): string {
  return s.log.find((w) => w.outcome !== 'skipped')?.next ?? '';
}

export function setRules(s: State, mode: ModeId, rules: ModeRules): State {
  return { ...s, rules: { ...s.rules, [mode]: rules } };
}

export type Prompt = 'start' | 'end';

/**
 * What the schedule asks now, if anything: to start work (free time inside work hours, not asked or
 * started today) or to check out (work that began before today's end, after it, not asked today).
 */
export function schedulePrompt(s: State, now: number): Prompt | null {
  const sc = s.settings.schedule;
  if (!sc.on || !sc.days.includes(new Date(now).getDay())) return null;
  const day = dayKey(now);
  const start = atMinutes(now, sc.start);
  const end = atMinutes(now, sc.end);
  if (s.mode === 'free' && now >= start && now < end && s.prompted.start !== day) return 'start';
  if (s.mode === 'work' && s.current && now >= end && s.current.start < end && s.prompted.end !== day) return 'end';
  return null;
}

export function markPrompted(s: State, p: Prompt, now: number): State {
  return { ...s, prompted: { ...s.prompted, [p]: dayKey(now) } };
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
