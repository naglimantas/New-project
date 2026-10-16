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
