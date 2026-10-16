// Summaries for the LOG screen and text formatting.

import { activeMs, type Outcome, type WorkSession } from './model';

/** Monday 00:00 (local time) of the week `t` falls in. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export interface WeekSummary {
  sessions: number;
  /** Time from start to check-out, all sessions. */
  totalMs: number;
  /** Time at the PC (a program in front, not idle). */
  activeMs: number;
  outcomes: Record<Outcome, number>;
  /** Share of checked-out sessions that were done (partly counts half); null without any. */
  score: number | null;
}

/** The sessions that started in the week of `now`. */
export function weekSummary(log: WorkSession[], now: number): WeekSummary {
  const from = weekStart(now);
  const outcomes: Record<Outcome, number> = { done: 0, partly: 0, not: 0, skipped: 0 };
  let totalMs = 0;
  let active = 0;
  let sessions = 0;
  for (const w of log) {
    if (w.start < from || w.start > now || w.end === null || w.outcome === null) continue;
    sessions++;
    totalMs += w.end - w.start;
    active += activeMs(w.usage);
    outcomes[w.outcome]++;
  }
  const rated = outcomes.done + outcomes.partly + outcomes.not;
  const score = rated ? (outcomes.done + outcomes.partly / 2) / rated : null;
  return { sessions, totalMs, activeMs: active, outcomes, score };
}

/** `1h 05m`, `12m`, `40s`. */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** `1:05:09` for a running clock. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function fmtTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Fri 16 Oct`. */
export function fmtDay(t: number): string {
  const d = new Date(t);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
