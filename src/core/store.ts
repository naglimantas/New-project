// Reading the saved state back. Anything missing or broken falls back to the defaults, so a damaged
// file never stops the app from starting.

import { GOAL_MAX, initialState, LOG_MAX, type ModeId, type ModeRules, type Outcome, type Schedule, type StartItem, type State, type WorkSession } from './model';
import { isProtected, normalizeExe, normalizeSite } from './programs';

export const STORAGE_KEY = 'modes-state';

const OUTCOMES: Outcome[] = ['done', 'partly', 'not', 'skipped'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const str = (x: unknown, max = 2000): string => (typeof x === 'string' ? x.slice(0, max) : '');

function readRules(x: unknown, fallback: ModeRules): ModeRules {
  if (!isObj(x)) return fallback;
  const blocked = Array.isArray(x.blocked)
    ? [...new Set(x.blocked.map((b) => normalizeExe(str(b))).filter((b) => b.endsWith('.exe') && !isProtected(b)))].sort()
    : fallback.blocked;
  const sites = Array.isArray(x.sites) ? [...new Set(x.sites.map((b) => normalizeSite(str(b))).filter(Boolean))].sort() : fallback.sites;
  const startup: StartItem[] = Array.isArray(x.startup)
    ? x.startup.filter(isObj).map((i) => ({ target: str(i.target).trim(), args: str(i.args).trim() })).filter((i) => i.target)
    : fallback.startup;
  return { blocked, sites, startup };
}

/** Positive numbers by name (program time, tries). */
function readCounts(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) if (k && num(v) && v > 0) out[k] = v;
  return out;
}

function readSchedule(x: unknown, fallback: Schedule): Schedule {
  if (!isObj(x)) return fallback;
  const minute = (v: unknown, d: number) => (num(v) && v >= 0 && v < 24 * 60 ? Math.round(v) : d);
  let start = minute(x.start, fallback.start);
  let end = minute(x.end, fallback.end);
  if (start >= end) [start, end] = [fallback.start, fallback.end];
  const days = Array.isArray(x.days) ? [...new Set(x.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : fallback.days;
  return { on: x.on === true, days, start, end };
}

function readSession(x: unknown, finished: boolean): WorkSession | null {
  if (!isObj(x) || !num(x.start) || typeof x.goal !== 'string') return null;
  const outcome = OUTCOMES.includes(x.outcome as Outcome) ? (x.outcome as Outcome) : null;
  const end = num(x.end) ? x.end : null;
  if (finished && (end === null || outcome === null)) return null;
  return {
    id: str(x.id) || `w${x.start.toString(36)}`,
    start: x.start,
    end: finished ? end : null,
    goal: str(x.goal, GOAL_MAX),
    outcome: finished ? outcome : null,
    next: str(x.next, GOAL_MAX),
    usage: readCounts(x.usage),
    tries: readCounts(x.tries),
    lockUntil: !finished && num(x.lockUntil) ? x.lockUntil : null,
    breaks: Array.isArray(x.breaks)
      ? x.breaks.filter((b): b is { from: number; to: number } => isObj(b) && num(b.from) && num(b.to) && b.to > b.from).map((b) => ({ from: b.from, to: b.to }))
      : [],
    onBreak: !finished && isObj(x.onBreak) && num(x.onBreak.from) && num(x.onBreak.until) && x.onBreak.until > x.onBreak.from ? { from: x.onBreak.from, until: x.onBreak.until } : null,
  };
}

export function parseState(raw: string | null, now: number): State {
  const d = initialState(now);
  if (!raw) return d;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return d;
  }
  if (!isObj(x) || x.v !== 1) return d;
  const rules = isObj(x.rules) ? x.rules : {};
  const current = readSession(x.current, false);
  // Work without a session (or a session outside work) cannot happen; if the file says so, trust the session.
  const mode: ModeId = current ? 'work' : 'free';
  const settings = isObj(x.settings) ? x.settings : {};
  const prompted = isObj(x.prompted) ? x.prompted : {};
  return {
    v: 1,
    mode,
    since: current ? current.start : num(x.since) ? x.since : now,
    rules: { work: readRules(rules.work, d.rules.work), free: readRules(rules.free, d.rules.free) },
    current,
    log: Array.isArray(x.log)
      ? x.log
          .map((w) => readSession(w, true))
          .filter((w): w is WorkSession => w !== null)
          .slice(0, LOG_MAX)
      : [],
    settings: {
      autostart: typeof settings.autostart === 'boolean' ? settings.autostart : d.settings.autostart,
      openStartup: typeof settings.openStartup === 'boolean' ? settings.openStartup : d.settings.openStartup,
      schedule: readSchedule(settings.schedule, d.settings.schedule),
    },
    prompted: { start: str(prompted.start, 10), end: str(prompted.end, 10) },
    guideDone: x.guideDone === true,
  };
}

export function loadState(now: number): State {
  try {
    return parseState(localStorage.getItem(STORAGE_KEY), now);
  } catch {
    return initialState(now);
  }
}

export function saveState(s: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: the app keeps working, it just will not remember this change.
  }
}
