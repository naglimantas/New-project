import { topApps } from '../core/model';
import { shortName } from '../core/programs';
import { fmtDuration } from '../core/stats';
import { Bar } from './kit';

/** Program time during a work session, longest first. */
export function UsageList({ usage, n = 5 }: { usage: Record<string, number>; n?: number }) {
  const { apps, other } = topApps(usage, n);
  if (!apps.length) return <p className="dim">Nothing measured yet.</p>;
  const max = apps[0][1];
  return (
    <ul className="usage">
      {apps.map(([app, ms]) => (
        <li key={app}>
          <span className="name" title={app}>
            {shortName(app)}
          </span>
          <Bar value={ms} max={max} />
          <span className="num">{fmtDuration(ms)}</span>
        </li>
      ))}
      {other > 0 && (
        <li className="dim">
          <span className="name">other</span>
          <Bar value={other} max={max} />
          <span className="num">{fmtDuration(other)}</span>
        </li>
      )}
    </ul>
  );
}

/** "Blocked during work: steam ×3, youtube.com ×1", most first; nothing when nothing was tried. */
export function Tries({ tries }: { tries: Record<string, number> }) {
  const list = Object.entries(tries)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!list.length) return null;
  const total = list.reduce((a, [, n]) => a + n, 0);
  return (
    <p className="tries small">
      <span className="dim">Blocked {total}× during work: </span>
      {list.map(([name, n]) => `${shortName(name)} ×${n}`).join(', ')}
    </p>
  );
}
