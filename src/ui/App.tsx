import { useCallback, useEffect, useRef, useState } from 'react';
import { addUsage, cancelWork, canCancel, checkOut, MODE_NAME, setRules, startWork, suggestedGoal, type ModeId, type Outcome, type State } from '../core/model';
import { shortName } from '../core/programs';
import { loadState, saveState } from '../core/store';
import { onNative, openItem, setAutostart, setMode, startedAtLogin, takeUsage } from '../platform/native';
import { CheckOutDialog, StartWorkDialog } from './dialogs';
import { toast, Toasts } from './kit';
import { LogScreen, NowScreen, RulesScreen } from './screens';
import { useNow } from './useNow';

type Tab = 'now' | 'rules' | 'log';
const TABS: { id: Tab; name: string }[] = [
  { id: 'now', name: 'NOW' },
  { id: 'rules', name: 'RULES' },
  { id: 'log', name: 'LOG' },
];

/** How often the program time measured on the Windows side is moved into the session. */
const USAGE_EVERY_MS = 10_000;

function openStartup(s: State, mode: ModeId) {
  if (!s.settings.openStartup) return;
  for (const i of s.rules[mode].startup) {
    openItem(i.target, i.args).catch((e) => toast(`Could not open ${i.target}: ${String(e)}`, 'warn', 8000));
  }
}

export function App() {
  const [s, setS] = useState<State>(() => loadState(Date.now()));
  const [tab, setTab] = useState<Tab>('now');
  const [dialog, setDialog] = useState<'start' | 'checkout' | null>(null);
  const now = useNow(1000);
  const latest = useRef(s);
  latest.current = s;

  // Every change is saved at once, so a crash or shutdown loses nothing.
  useEffect(() => saveState(s), [s]);

  // Windows follows the mode: what to block, whether to count program time, what the tray says.
  const blockedKey = s.rules[s.mode].blocked.join('|');
  useEffect(() => {
    setMode(s.mode, MODE_NAME[s.mode], blockedKey ? blockedKey.split('|') : [], s.mode === 'work').catch((e) => toast(`Windows side: ${String(e)}`, 'warn'));
  }, [s.mode, blockedKey]);

  useEffect(() => {
    setAutostart(s.settings.autostart).catch(() => {});
  }, [s.settings.autostart]);

  // Started with Windows: open this mode's programs, as if it had just started.
  useEffect(() => {
    startedAtLogin()
      .then((yes) => yes && openStartup(latest.current, latest.current.mode))
      .catch(() => {});
  }, []);

  // Moves measured program time into the running session.
  const flushUsage = useCallback(async () => {
    let delta: Record<string, number> = {};
    try {
      delta = await takeUsage();
    } catch {
      return;
    }
    if (!Object.keys(delta).length) return;
    if (latest.current.mode !== 'work') {
      // Work ended while it was on its way: it belonged to that session's last seconds; drop it.
      return;
    }
    setS((x) => addUsage(x, delta));
  }, []);

  useEffect(() => {
    if (s.mode !== 'work') return;
    const id = setInterval(() => void flushUsage(), USAGE_EVERY_MS);
    return () => clearInterval(id);
  }, [s.mode, flushUsage]);

  // Saved right before the window goes away, too.
  useEffect(() => {
    const save = () => saveState(latest.current);
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, []);

  const doStart = (goal: string) => {
    const next = startWork(latest.current, goal, Date.now());
    if (next === latest.current) return;
    // Time measured before work started is not part of it.
    void takeUsage().catch(() => {});
    setS(next);
    setDialog(null);
    openStartup(next, 'work');
  };

  const checkingOut = useRef(false);
  const doCheckOut = async (outcome: Outcome, next: string) => {
    // A double click must not log the session twice.
    if (checkingOut.current) return;
    checkingOut.current = true;
    let delta: Record<string, number> = {};
    try {
      delta = await takeUsage();
    } catch {
      // Without the last seconds; nothing else is lost.
    }
    checkingOut.current = false;
    const before = latest.current;
    setDialog(null);
    if (before.mode !== 'work') return;
    const after = checkOut(addUsage(before, delta), outcome, next, Date.now());
    latest.current = after;
    setS(after);
    toast(outcome === 'skipped' ? 'Work ended without a check-out.' : `Work ended: ${outcome === 'done' ? 'done.' : outcome === 'partly' ? 'partly done.' : 'not done.'}`);
    openStartup(after, 'free');
  };

  const doCancel = () => {
    void takeUsage().catch(() => {});
    setS((x) => cancelWork(x, Date.now()));
    setDialog(null);
    toast('Work cancelled. Nothing was logged.');
  };

  const onSwitch = useCallback(() => {
    if (latest.current.mode === 'work') {
      void flushUsage();
      setDialog('checkout');
    } else {
      setDialog('start');
    }
  }, [flushUsage]);

  // The tray's "Start work…" / "End work…", and programs Windows closed.
  useEffect(() => {
    const a = onNative('tray', (p) => {
      if (p === 'switch') {
        setTab('now');
        onSwitch();
      }
    });
    const b = onNative('blocked', (app) => toast(`${shortName(app)} is blocked in ${MODE_NAME[latest.current.mode]}: closing it.`, 'warn'));
    return () => {
      a();
      b();
    };
  }, [onSwitch]);

  // Keys: 1–3 switch screens, Esc closes a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (dialog) {
        if (e.key === 'Escape') setDialog(null);
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const t = { '1': 'now', '2': 'rules', '3': 'log' }[e.key] as Tab | undefined;
      if (t) setTab(t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  useEffect(() => {
    document.title = `Modes · ${MODE_NAME[s.mode]}`;
    document.documentElement.dataset.mode = s.mode;
  }, [s.mode]);

  return (
    <div className="app">
      <nav className="tabs" role="tablist">
        {TABS.map((t, i) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            <span className="kbd">{i + 1}</span>
            {t.name}
          </button>
        ))}
        <span className={`mode-tag ${s.mode}`}>{MODE_NAME[s.mode]}</span>
      </nav>
      <main>
        {tab === 'now' && <NowScreen s={s} now={now} onSwitch={onSwitch} />}
        {tab === 'rules' && <RulesScreen s={s} onRules={(m, r) => setS((x) => setRules(x, m, r))} onSettings={(st) => setS((x) => ({ ...x, settings: st }))} />}
        {tab === 'log' && <LogScreen s={s} now={now} />}
      </main>
      {dialog === 'start' && s.mode === 'free' && <StartWorkDialog s={s} suggestion={suggestedGoal(s)} onStart={doStart} onClose={() => setDialog(null)} />}
      {dialog === 'checkout' && s.mode === 'work' && (
        <CheckOutDialog s={s} now={now} canCancel={canCancel(s, now)} onDone={(o, n) => void doCheckOut(o, n)} onCancelWork={doCancel} onClose={() => setDialog(null)} />
      )}
      <Toasts />
    </div>
  );
}
