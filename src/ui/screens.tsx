import { useState, type ReactNode } from 'react';
import {
  activeMs,
  isLocked,
  MODE_NAME,
  MODES,
  OUTCOME_NAME,
  type ModeId,
  type ModeRules,
  type Schedule,
  type Settings,
  type State,
  type WorkSession,
} from '../core/model';
import { addBlocked, addSite, shortName } from '../core/programs';
import { fmtClock, fmtDay, fmtDuration, fmtTime, lastDays, weekSummary } from '../core/stats';
import { isDesktop, openItem, pickFile, runningPrograms } from '../platform/native';
import { Panel, toast } from './kit';
import { Tries, UsageList } from './Usage';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday first, as the week is shown everywhere else. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** `540` → `09:00`. */
export function fmtMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function parseMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

function scheduleText(sc: Schedule): string {
  const days = WEEK_ORDER.filter((d) => sc.days.includes(d));
  const dayText = days.join() === '1,2,3,4,5' ? 'Mon–Fri' : days.length === 7 ? 'every day' : days.map((d) => WEEKDAYS[d]).join(' ');
  return `Work hours ${fmtMinutes(sc.start)}–${fmtMinutes(sc.end)}, ${dayText || 'no days'}`;
}

function WeekLine({ log, now }: { log: WorkSession[]; now: number }) {
  const w = weekSummary(log, now);
  if (!w.sessions) return <span>No work sessions this week yet.</span>;
  return (
    <span>
      This week: {w.sessions} session{w.sessions === 1 ? '' : 's'} · {w.outcomes.done} done · {w.outcomes.partly} partly · {fmtDuration(w.totalMs)}
    </span>
  );
}

function Guide({ onClose }: { onClose: () => void }) {
  return (
    <Panel
      title="HOW MODES WORKS"
      right={
        <button className="btn sm ghost" onClick={onClose}>
          Got it
        </button>
      }
    >
      <ol className="guide">
        <li>
          In <b>RULES</b>, choose what each mode blocks (programs and sites) and what it opens.
        </li>
        <li>
          <b>START WORK</b> with one goal. WORK's blocked programs and site tabs get closed until work ends.
        </li>
        <li>
          <b>END WORK</b> with a check-out: did you get it done, and what is next. <b>LOG</b> keeps the score.
        </li>
      </ol>
      <p className="dim small">Ctrl+Alt+M starts or ends work from anywhere. Closing the window keeps Modes in the tray.</p>
    </Panel>
  );
}

export function NowScreen({ s, now, onSwitch, onGuideDone }: { s: State; now: number; onSwitch: () => void; onGuideDone: () => void }) {
  const work = s.mode === 'work';
  const rules = s.rules[s.mode];
  const locked = isLocked(s, now);
  const sc = s.settings.schedule;
  return (
    <div className="screen">
      {!s.guideDone && <Guide onClose={onGuideDone} />}
      <Panel title="MODE" className={`mode ${s.mode}`}>
        <div className="mode-head">
          <div>
            <div className="mode-name">{MODE_NAME[s.mode]}</div>
            <div className="dim">since {fmtTime(s.since)}</div>
          </div>
          <div className="clock">{fmtClock(now - s.since)}</div>
        </div>
        <button className="btn primary lg" onClick={onSwitch}>
          {work ? 'END WORK…' : 'START WORK…'}
          <span className="kbd">Ctrl+Alt+M</span>
        </button>
        {locked && s.current?.lockUntil && (
          <p className="lock-note">
            Focus lock until {fmtTime(s.current.lockUntil)} ({fmtDuration(s.current.lockUntil - now)} left).
          </p>
        )}
      </Panel>

      {work && s.current && (
        <Panel title="GOAL" right={`${fmtDuration(activeMs(s.current.usage))} at the PC`}>
          <p className="goal">{s.current.goal}</p>
          <UsageList usage={s.current.usage} />
          <Tries tries={s.current.tries} />
        </Panel>
      )}

      <Panel title={`BLOCKED IN ${MODE_NAME[s.mode]}`}>
        {rules.blocked.length || rules.sites.length ? (
          <div className="chips">
            {rules.blocked.map((b) => (
              <span key={b} className="chip" title={b}>
                {shortName(b)}
              </span>
            ))}
            {rules.sites.map((b) => (
              <span key={b} className="chip site" title={`${b} (browser tabs)`}>
                {b}
              </span>
            ))}
          </div>
        ) : (
          <p className="dim">Nothing. Add programs and sites in RULES.</p>
        )}
      </Panel>

      <p className="foot">
        <WeekLine log={s.log} now={now} />
        {sc.on && <span className="dim"> · {scheduleText(sc)}</span>}
      </p>
    </div>
  );
}

/** A list of names with × buttons and an input to add one (programs or sites). */
function NameList({
  label,
  items,
  locked,
  placeholder,
  ariaLabel,
  display,
  onAdd,
  onRemove,
  extra,
}: {
  label: string;
  items: string[];
  locked: boolean;
  placeholder: string;
  ariaLabel: string;
  display: (x: string) => string;
  onAdd: (input: string) => boolean;
  onRemove: (x: string) => void;
  extra?: ReactNode;
}) {
  const [text, setText] = useState('');
  return (
    <>
      <p className="label">{label}</p>
      {items.length ? (
        <div className="chips">
          {items.map((b) => (
            <span key={b} className="chip" title={b}>
              {display(b)}
              {!locked && (
                <button className="chip-x" aria-label={`Unblock ${b}`} onClick={() => onRemove(b)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="dim small">None.</p>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (onAdd(text)) setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} />
        <button className="btn" type="submit" disabled={!text.trim()}>
          ADD
        </button>
        {extra}
      </form>
    </>
  );
}

function Blocklists({ mode, rules, locked, onChange }: { mode: ModeId; rules: ModeRules; locked: boolean; onChange: (r: ModeRules) => void }) {
  const [running, setRunning] = useState<string[] | null>(null);
  const addProgram = (input: string) => {
    const r = addBlocked(rules.blocked, input);
    if (!r.ok) {
      toast(r.reason, 'warn');
      return false;
    }
    onChange({ ...rules, blocked: r.list });
    return true;
  };
  const pickRunning = async () => {
    if (running) return setRunning(null);
    try {
      setRunning(await runningPrograms());
    } catch {
      toast('Could not list the running programs.', 'warn');
    }
  };
  const offer = running?.filter((p) => !rules.blocked.includes(p)) ?? [];
  return (
    <>
      <NameList
        label="BLOCKED PROGRAMS"
        items={rules.blocked}
        locked={locked}
        placeholder="program, e.g. steam"
        ariaLabel={`Block a program in ${MODE_NAME[mode]}`}
        display={shortName}
        onAdd={addProgram}
        onRemove={(b) => onChange({ ...rules, blocked: rules.blocked.filter((x) => x !== b) })}
        extra={
          isDesktop && (
            <button className={`btn ${running ? 'pressed' : ''}`} type="button" onClick={pickRunning}>
              RUNNING…
            </button>
          )
        }
      />
      {running && (
        <div className="chips pick">
          {offer.length ? (
            offer.map((p) => (
              <button key={p} className="chip add" onClick={() => addProgram(p)} title={`Block ${p}`}>
                + {shortName(p)}
              </button>
            ))
          ) : (
            <span className="dim small">No other programs with a window are open.</span>
          )}
        </div>
      )}
      <NameList
        label="BLOCKED SITES"
        items={rules.sites}
        locked={locked}
        placeholder="site, e.g. youtube.com"
        ariaLabel={`Block a site in ${MODE_NAME[mode]}`}
        display={(x) => x}
        onAdd={(input) => {
          const r = addSite(rules.sites, input);
          if (!r.ok) {
            toast(r.reason, 'warn');
            return false;
          }
          onChange({ ...rules, sites: r.list });
          return true;
        }}
        onRemove={(b) => onChange({ ...rules, sites: rules.sites.filter((x) => x !== b) })}
      />
      {locked && <p className="dim small">Locked during work: you can add, not remove.</p>}
    </>
  );
}

function Startup({ mode, rules, onChange }: { mode: ModeId; rules: ModeRules; onChange: (r: ModeRules) => void }) {
  const [target, setTarget] = useState('');
  const [args, setArgs] = useState('');
  const add = () => {
    const t = target.trim().replace(/^"+|"+$/g, '');
    if (!t) return;
    onChange({ ...rules, startup: [...rules.startup, { target: t, args: args.trim() }] });
    setTarget('');
    setArgs('');
  };
  const test = (t: string, a: string) => openItem(t, a).catch((e) => toast(`Could not open ${t}: ${String(e)}`, 'warn'));
  return (
    <>
      <p className="label">OPENS WHEN IT STARTS</p>
      {rules.startup.length ? (
        <ul className="items">
          {rules.startup.map((i, n) => (
            <li key={`${n}:${i.target}`}>
              <span className="name" title={i.args ? `${i.target} ${i.args}` : i.target}>
                {i.target}
                {i.args && <span className="dim"> {i.args}</span>}
              </span>
              <button className="btn sm ghost" onClick={() => test(i.target, i.args)}>
                OPEN
              </button>
              <button
                className="btn sm ghost"
                aria-label={`Remove ${i.target}`}
                onClick={() => onChange({ ...rules, startup: rules.startup.filter((_, k) => k !== n) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim small">None.</p>
      )}
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="grow"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="program, file, folder or https:// link"
          aria-label={`Open when ${MODE_NAME[mode]} starts`}
        />
        <input className="args" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="arguments" aria-label="Arguments (optional)" />
        {isDesktop && (
          <button
            className="btn"
            type="button"
            onClick={async () => {
              const f = await pickFile().catch(() => null);
              if (f) setTarget(f);
            }}
          >
            BROWSE…
          </button>
        )}
        <button className="btn" type="submit" disabled={!target.trim()}>
          ADD
        </button>
      </form>
    </>
  );
}

function ScheduleEditor({ sc, onChange }: { sc: Schedule; onChange: (sc: Schedule) => void }) {
  const [start, setStart] = useState(fmtMinutes(sc.start));
  const [end, setEnd] = useState(fmtMinutes(sc.end));
  const commit = (which: 'start' | 'end', v: string) => {
    const m = parseMinutes(v);
    const next = { ...sc, [which]: m ?? sc[which] };
    if (m === null || next.start >= next.end) {
      toast('Work hours need a start before the end, on the same day.', 'warn');
      setStart(fmtMinutes(sc.start));
      setEnd(fmtMinutes(sc.end));
      return;
    }
    onChange(next);
  };
  const toggleDay = (d: number) => onChange({ ...sc, days: sc.days.includes(d) ? sc.days.filter((x) => x !== d) : [...sc.days, d].sort((a, b) => a - b) });
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={sc.on} onChange={(e) => onChange({ ...sc, on: e.target.checked })} />
        Work hours: ask me to start work, and to check out when they end
      </label>
      <div className={`schedule ${sc.on ? '' : 'off'}`}>
        <div className="chips" role="group" aria-label="Work days">
          {WEEK_ORDER.map((d) => (
            <button key={d} className={`btn sm ${sc.days.includes(d) ? 'pressed' : ''}`} aria-pressed={sc.days.includes(d)} disabled={!sc.on} onClick={() => toggleDay(d)}>
              {WEEKDAYS[d]}
            </button>
          ))}
        </div>
        <div className="row times">
          <input type="time" value={start} disabled={!sc.on} aria-label="Work starts" onChange={(e) => setStart(e.target.value)} onBlur={(e) => commit('start', e.target.value)} />
          <span className="dim">to</span>
          <input type="time" value={end} disabled={!sc.on} aria-label="Work ends" onChange={(e) => setEnd(e.target.value)} onBlur={(e) => commit('end', e.target.value)} />
        </div>
      </div>
    </>
  );
}

export function RulesScreen({ s, onRules, onSettings }: { s: State; onRules: (m: ModeId, r: ModeRules) => void; onSettings: (st: Settings) => void }) {
  return (
    <div className="screen">
      <div className="cols">
        {MODES.map((m) => (
          <Panel key={m} title={MODE_NAME[m]} right={s.mode === m ? 'ON NOW' : undefined} className={`mode ${m}`}>
            <Blocklists mode={m} rules={s.rules[m]} locked={m === 'work' && s.mode === 'work'} onChange={(r) => onRules(m, r)} />
            <Startup mode={m} rules={s.rules[m]} onChange={(r) => onRules(m, r)} />
          </Panel>
        ))}
      </div>
      <Panel title="SETTINGS">
        <ScheduleEditor sc={s.settings.schedule} onChange={(schedule) => onSettings({ ...s.settings, schedule })} />
        <label className="check">
          <input type="checkbox" checked={s.settings.autostart} onChange={(e) => onSettings({ ...s.settings, autostart: e.target.checked })} />
          Start with Windows (in the tray, in the mode you were in)
        </label>
        <label className="check">
          <input type="checkbox" checked={s.settings.openStartup} onChange={(e) => onSettings({ ...s.settings, openStartup: e.target.checked })} />
          Open a mode's startup items when it starts and when Windows starts
        </label>
        <p className="dim small">
          A blocked program is asked to close (so it can save), then ended after 4 seconds; programs run as administrator cannot be closed. A blocked site's tab
          is closed (Ctrl+W) when it is in front for 2 seconds; Modes finds it by the tab title, so a page whose title does not name the site gets through.
          Closing this window keeps Modes in the tray; during work the tray has no Quit.
        </p>
      </Panel>
      <p className="foot dim">Modes {__APP_VERSION__}</p>
    </div>
  );
}

/** Work per day, last 7 days. One series: no legend, the panel title names it; hover shows the numbers. */
function WeekChart({ log, now }: { log: WorkSession[]; now: number }) {
  const days = lastDays(log, now);
  const max = Math.max(...days.map((d) => d.ms), 60 * 60_000);
  return (
    <div className="chart" role="img" aria-label="Work time per day, last 7 days">
      {days.map((d) => {
        const tip = `${fmtDay(d.day)}: ${d.sessions ? `${fmtDuration(d.ms)}, ${d.sessions} session${d.sessions === 1 ? '' : 's'}, ${d.done} done` : 'no work'}`;
        return (
          <div key={d.day} className="col" title={tip}>
            <span className="track">
              {d.ms > 0 && (
                <>
                  <span className="fill" style={{ height: `${Math.max(3, (d.ms / max) * 100)}%` }} />
                  <span className="val" style={{ bottom: `${Math.max(3, (d.ms / max) * 100)}%` }}>
                    {fmtDuration(d.ms)}
                  </span>
                </>
              )}
            </span>
            <span className="day">{WEEKDAYS[new Date(d.day).getDay()]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LogScreen({ s, now, onDelete }: { s: State; now: number; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const w = weekSummary(s.log, now);
  const days: { day: string; list: WorkSession[] }[] = [];
  for (const x of s.log) {
    const day = fmtDay(x.start);
    const last = days[days.length - 1];
    if (last?.day === day) last.list.push(x);
    else days.push({ day, list: [x] });
  }
  return (
    <div className="screen">
      <Panel title="THIS WEEK">
        {w.sessions ? (
          <div className="stats">
            <div>
              <b>{w.sessions}</b>
              <span>sessions</span>
            </div>
            <div>
              <b>{fmtDuration(w.totalMs)}</b>
              <span>working</span>
            </div>
            <div>
              <b>{fmtDuration(w.activeMs)}</b>
              <span>at the PC</span>
            </div>
            <div>
              <b>{w.score === null ? '–' : `${Math.round(w.score * 100)}%`}</b>
              <span>
                {w.outcomes.done} done · {w.outcomes.partly} partly · {w.outcomes.not} not
                {w.outcomes.skipped ? ` · ${w.outcomes.skipped} skipped` : ''}
              </span>
            </div>
          </div>
        ) : (
          <p className="dim">No work sessions this week yet.</p>
        )}
      </Panel>
      <Panel title="WORK PER DAY · LAST 7 DAYS">
        <WeekChart log={s.log} now={now} />
      </Panel>
      <Panel title="SESSIONS">
        {!days.length && <p className="dim">Sessions show here after their check-out.</p>}
        {days.map((d) => (
          <div key={d.day} className="day">
            <p className="label">{d.day.toUpperCase()}</p>
            {d.list.map((x) => (
              <article key={x.id} className="entry">
                <div className="entry-head">
                  <span className="dim">
                    {fmtTime(x.start)}–{fmtTime(x.end ?? x.start)} · {fmtDuration((x.end ?? x.start) - x.start)}
                  </span>
                  <span className="entry-tools">
                    <span className={`tag ${x.outcome}`}>{x.outcome ? OUTCOME_NAME[x.outcome] : ''}</span>
                    {confirm === x.id ? (
                      <>
                        <button
                          className="btn sm ghost danger"
                          onClick={() => {
                            onDelete(x.id);
                            setConfirm(null);
                          }}
                        >
                          Delete
                        </button>
                        <button className="btn sm ghost" onClick={() => setConfirm(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button className="btn sm ghost" aria-label="Delete this session" onClick={() => setConfirm(x.id)}>
                        ×
                      </button>
                    )}
                  </span>
                </div>
                <p className="goal">{x.goal}</p>
                {x.next && <p className="dim small">Next: {x.next}</p>}
                {activeMs(x.usage) > 0 && <UsageList usage={x.usage} n={3} />}
                <Tries tries={x.tries} />
              </article>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}
