// The log as a CSV file (proof of the work done, for a spreadsheet) and the streak of work days.

import { activeMs, breakMs, dayKey, OUTCOME_NAME, topApps, workedMs, type WorkSession } from './model';
import { shortName } from './programs';

/** One CSV cell: quoted when needed, and text a spreadsheet would run as a formula made plain. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pad = (n: number) => String(n).padStart(2, '0');
const time = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const minutes = (ms: number) => Math.round(ms / 60_000);

export const CSV_HEADER = ['date', 'start', 'end', 'worked_min', 'break_min', 'at_pc_min', 'goal', 'outcome', 'next', 'top_programs', 'blocked'];

/** Finished sessions, oldest first, one per line (Windows line ends, as Excel expects). */
export function toCsv(log: WorkSession[]): string {
  const rows = [...log]
    .filter((w) => w.end !== null && w.outcome !== null)
    .sort((a, b) => a.start - b.start)
    .map((w) => {
      const end = w.end ?? w.start;
      const top = topApps(w.usage, 3)
        .apps.map(([a, ms]) => `${shortName(a)} ${minutes(ms)}m`)
        .join('; ');
      const tries = Object.entries(w.tries)
        .sort((a, b) => b[1] - a[1])
        .map(([n, k]) => `${shortName(n)} x${k}`)
        .join('; ');
      return [
        dayKey(w.start),
        time(w.start),
        time(end),
        minutes(workedMs(w, end)),
        minutes(breakMs(w)),
        minutes(activeMs(w.usage)),
        w.goal,
        w.outcome ? OUTCOME_NAME[w.outcome] : '',
        w.next,
        top,
        tries,
      ];
    });
  return [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * Work days in a row with a session checked out as done, up to today. Today without one yet does not
 * break it (the day is not over), and days that are not work days (`workDays`, 0 = Sunday; null means
 * every day) are skipped.
 */
export function streak(log: WorkSession[], now: number, workDays: number[] | null): number {
  const done = new Set(log.filter((w) => w.outcome === 'done').map((w) => dayKey(w.start)));
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const key = dayKey(d.getTime());
    const workDay = !workDays || workDays.includes(d.getDay());
    if (done.has(key)) n++;
    else if (workDay && i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
