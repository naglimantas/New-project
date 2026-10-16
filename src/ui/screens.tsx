import { useState } from 'react';
import { activeMs, MODE_NAME, MODES, OUTCOME_NAME, type ModeId, type ModeRules, type Settings, type State, type WorkSession } from '../core/model';
import { addBlocked, shortName } from '../core/programs';
import { fmtClock, fmtDay, fmtDuration, fmtTime, weekSummary } from '../core/stats';
import { isDesktop, openItem, pickFile, runningPrograms } from '../platform/native';
import { Panel, toast } from './kit';
import { UsageList } from './Usage';

function WeekLine({ log, now }: { log: WorkSession[]; now: number }) {
  const w = weekSummary(log, now);
  if (!w.sessions) return <span className="dim">No work sessions this week yet.</span>;
  return (
    <span>
      This week: {w.sessions} session{w.sessions === 1 ? '' : 's'} · {w.outcomes.done} done · {w.outcomes.partly} partly · {fmtDuration(w.totalMs)}
    </span>
  );
}

export function NowScreen({ s, now, onSwitch }: { s: State; now: number; onSwitch: () => void }) {
  const work = s.mode === 'work';
  const rules = s.rules[s.mode];
  return (
    <div className="screen">
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
        </button>
      </Panel>

      {work && s.current && (
        <Panel title="GOAL" right={`${fmtDuration(activeMs(s.current.usage))} at the PC`}>
          <p className="goal">{s.current.goal}</p>
          <UsageList usage={s.current.usage} />
        </Panel>
      )}

      <Panel title={`BLOCKED IN ${MODE_NAME[s.mode]}`}>
        {rules.blocked.length ? (
          <div className="chips">
            {rules.blocked.map((b) => (
              <span key={b} className="chip" title={b}>
                {shortName(b)}
              </span>
            ))}
          </div>
        ) : (
          <p className="dim">Nothing. Add programs in RULES.</p>
        )}
      </Panel>

      <p className="foot">
        <WeekLine log={s.log} now={now} />
      </p>
    </div>
  );
}

function Blocklist({ mode, rules, locked, onChange }: { mode: ModeId; rules: ModeRules; locked: boolean; onChange: (r: ModeRules) => void }) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState<string[] | null>(null);
  const add = (input: string) => {
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
      <p className="label">BLOCKED PROGRAMS</p>
      {rules.blocked.length ? (
        <div className="chips">
          {rules.blocked.map((b) => (
            <span key={b} className="chip" title={b}>
              {shortName(b)}
              {!locked && (
                <button className="chip-x" aria-label={`Unblock ${b}`} onClick={() => onChange({ ...rules, blocked: rules.blocked.filter((x) => x !== b) })}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="dim small">None.</p>
      )}
      {locked && <p className="dim small">Locked during work: you can add programs, not remove them.</p>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (add(text)) setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="program, e.g. steam" aria-label={`Block a program in ${MODE_NAME[mode]}`} />
        <button className="btn" type="submit" disabled={!text.trim()}>
          ADD
        </button>
        {isDesktop && (
          <button className={`btn ${running ? 'pressed' : ''}`} type="button" onClick={pickRunning}>
            RUNNING…
          </button>
        )}
      </form>
      {running && (
        <div className="chips pick">
          {offer.length ? (
            offer.map((p) => (
              <button key={p} className="chip add" onClick={() => add(p)} title={`Block ${p}`}>
                + {shortName(p)}
              </button>
            ))
          ) : (
            <span className="dim small">No other programs with a window are open.</span>
          )}
        </div>
      )}
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
              <button className="btn sm ghost" aria-label={`Remove ${i.target}`} onClick={() => onChange({ ...rules, startup: rules.startup.filter((_, k) => k !== n) })}>
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
        <input className="grow" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="program, file, folder or https:// link" aria-label={`Open when ${MODE_NAME[mode]} starts`} />
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

export function RulesScreen({ s, onRules, onSettings }: { s: State; onRules: (m: ModeId, r: ModeRules) => void; onSettings: (st: Settings) => void }) {
  return (
    <div className="screen">
      <div className="cols">
        {MODES.map((m) => (
          <Panel key={m} title={MODE_NAME[m]} right={s.mode === m ? 'ON NOW' : undefined} className={`mode ${m}`}>
            <Blocklist mode={m} rules={s.rules[m]} locked={m === 'work' && s.mode === 'work'} onChange={(r) => onRules(m, r)} />
            <Startup mode={m} rules={s.rules[m]} onChange={(r) => onRules(m, r)} />
          </Panel>
        ))}
      </div>
      <Panel title="SETTINGS">
        <label className="check">
          <input type="checkbox" checked={s.settings.autostart} onChange={(e) => onSettings({ ...s.settings, autostart: e.target.checked })} />
          Start with Windows (in the tray, in the mode you were in)
        </label>
        <label className="check">
          <input type="checkbox" checked={s.settings.openStartup} onChange={(e) => onSettings({ ...s.settings, openStartup: e.target.checked })} />
          Open a mode's startup items when it starts and when Windows starts
        </label>
        <p className="dim small">
          A blocked program is asked to close (so it can save), then ended after 4 seconds. Programs run as administrator cannot be closed. Closing this window keeps Modes running in the tray; during work the tray has no Quit.
        </p>
      </Panel>
      <p className="foot dim">Modes {__APP_VERSION__}</p>
    </div>
  );
}

export function LogScreen({ s, now }: { s: State; now: number }) {
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
                  <span className={`tag ${x.outcome}`}>{x.outcome ? OUTCOME_NAME[x.outcome] : ''}</span>
                </div>
                <p className="goal">{x.goal}</p>
                {x.next && <p className="dim small">Next: {x.next}</p>}
                {activeMs(x.usage) > 0 && <UsageList usage={x.usage} n={3} />}
              </article>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}
