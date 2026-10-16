import { useEffect, useState } from 'react';
import { activeMs, breakMs, GOAL_MAX, workedMs, LOCKS, MODE_NAME, OUTCOME_NAME, type ModeId, type Outcome, type State } from '../core/model';
import { shortName } from '../core/programs';
import { fmtDuration, fmtTime } from '../core/stats';
import { runningBlocked } from '../platform/native';
import { Window } from './kit';
import { Tries, UsageList } from './Usage';

/** What switching to `to` will do: running programs it closes, site tabs it closes, items it opens. */
function WillClose({ s, to }: { s: State; to: ModeId }) {
  const [names, setNames] = useState<string[]>([]);
  const blocked = s.rules[to].blocked;
  useEffect(() => {
    let live = true;
    runningBlocked(blocked)
      .then((n) => live && setNames(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [blocked]);
  const sites = s.rules[to].sites;
  const opens = s.settings.openStartup ? s.rules[to].startup.length : 0;
  if (!names.length && !opens && !sites.length) return null;
  return (
    <div className="notes">
      {names.length > 0 && <p className="warn">Will be closed: {names.map(shortName).join(', ')}. Save your work there first.</p>}
      {sites.length > 0 && <p className="dim">Tabs of {sites.join(', ')} get closed while they are in front.</p>}
      {opens > 0 && (
        <p className="dim">
          Opens {opens} startup item{opens === 1 ? '' : 's'} for {MODE_NAME[to]}.
        </p>
      )}
    </div>
  );
}

export function StartWorkDialog({
  s,
  suggestion,
  onStart,
  onClose,
}: {
  s: State;
  suggestion: string;
  onStart: (goal: string, lockMin: number) => void;
  onClose: () => void;
}) {
  const [goal, setGoal] = useState(suggestion);
  const [lock, setLock] = useState(0);
  const ok = goal.trim().length > 0;
  const submit = () => ok && onStart(goal, lock);
  return (
    <Window
      title="START WORK"
      onClose={onClose}
      foot={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok} onClick={submit}>
            START WORK
          </button>
        </>
      }
    >
      <label className="field">
        <span>What will you get done?</span>
        <input
          value={goal}
          maxLength={GOAL_MAX}
          placeholder="e.g. Finish the sync conflict fix"
          onChange={(e) => setGoal(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            // Without preventDefault the same Enter would also press the button focus returns to.
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <p className="dim small">{suggestion ? 'Filled in from your last check-out. ' : ''}One concrete outcome works best. You will be asked about it when work ends.</p>
      <p className="label">FOCUS LOCK</p>
      <div className="choices four" role="radiogroup" aria-label="Focus lock">
        {LOCKS.map((m) => (
          <button key={m} role="radio" aria-checked={lock === m} className={`btn ${lock === m ? 'pressed' : ''}`} onClick={() => setLock(m)}>
            {m ? `${m} min` : 'Off'}
          </button>
        ))}
      </div>
      <p className="dim small">{lock ? `Work cannot be ended for ${lock} minutes (only cancelled in the first 2).` : 'End work whenever you like.'}</p>
      <WillClose s={s} to="work" />
    </Window>
  );
}

export function CheckOutDialog({
  s,
  now,
  canCancel,
  locked,
  onDone,
  onCancelWork,
  onClose,
}: {
  s: State;
  now: number;
  canCancel: boolean;
  locked: boolean;
  onDone: (outcome: Outcome, next: string) => void;
  onCancelWork: () => void;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [next, setNext] = useState('');
  const [skipping, setSkipping] = useState(false);
  const w = s.current;
  if (!w) return null;
  const submit = () => outcome && !locked && onDone(outcome, next);
  const choices: Outcome[] = ['done', 'partly', 'not'];
  return (
    <Window
      title="END WORK"
      onClose={onClose}
      foot={
        <>
          {canCancel ? (
            <button className="btn ghost left" onClick={onCancelWork} title="Started by mistake: leave work without a log entry">
              Started by mistake
            </button>
          ) : locked ? null : skipping ? (
            <button className="btn ghost danger left" onClick={() => onDone('skipped', '')}>
              Really skip (it is logged)
            </button>
          ) : (
            <button className="btn ghost left" onClick={() => setSkipping(true)}>
              Skip check-out…
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Keep working
          </button>
          <button className="btn primary" disabled={!outcome || locked} onClick={submit}>
            END WORK
          </button>
        </>
      }
    >
      {locked && w.lockUntil && (
        <p className="lock-note">
          Focus lock: work can end at {fmtTime(w.lockUntil)}, in {fmtDuration(w.lockUntil - now)}.
        </p>
      )}
      <p className="label">GOAL</p>
      <p className="goal">{w.goal}</p>
      <p className="dim small">
        {fmtDuration(workedMs(w, now))} worked{breakMs(w, now) ? ` · ${fmtDuration(breakMs(w, now))} break` : ''} · {fmtDuration(activeMs(w.usage))} at the PC
      </p>
      <p className="label">WHERE THE TIME WENT</p>
      <UsageList usage={w.usage} />
      <Tries tries={w.tries} />
      <p className="label">DID YOU GET IT DONE?</p>
      <div className="choices" role="radiogroup" aria-label="Did you get it done?">
        {choices.map((o, i) => (
          <button
            key={o}
            data-autofocus={i === 0 ? '' : undefined}
            role="radio"
            aria-checked={outcome === o}
            className={`btn ${outcome === o ? 'pressed' : ''}`}
            onClick={() => setOutcome(o)}
          >
            {OUTCOME_NAME[o]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Next step (optional, offered as your next goal)</span>
        <input
          value={next}
          maxLength={GOAL_MAX}
          placeholder={outcome === 'done' ? 'What comes after this?' : 'What is left?'}
          onChange={(e) => setNext(e.target.value)}
          onKeyDown={(e) => {
            // Without preventDefault the same Enter would also press the button focus returns to.
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <WillClose s={s} to="free" />
    </Window>
  );
}
