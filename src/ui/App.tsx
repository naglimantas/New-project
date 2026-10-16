import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addTry,
  addUsage,
  cancelWork,
  canCancel,
  checkOut,
  deleteSession,
  endBreak,
  isLocked,
  markPrompted,
  MODE_NAME,
  schedulePrompt,
  setRules,
  settleBreak,
  startBreak,
  startWork,
  suggestedGoal,
  type ModeId,
  type Outcome,
  type State,
} from '../core/model';
import { shortName, siteKeys } from '../core/programs';
import { hasSavedState, loadState, parseState, saveState } from '../core/store';
import { loadBackup, notify, onNative, openItem, saveBackup, saveFile, setAutostart, setMode, showWindow, startedAtLogin, takeUsage } from '../platform/native';
import { toCsv } from '../core/export';
import { fmtTime } from '../core/stats';
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

/** The tray's first line: the mode, and during work the goal (or the break). */
function trayStatus(s: State): string {
  if (s.mode !== 'work' || !s.current) return MODE_NAME[s.mode];
  return s.current.onBreak ? `WORK: on break until ${fmtTime(s.current.onBreak.until)}` : `WORK: ${s.current.goal}`;
}

export function App() {
  const [s, setS] = useState<State>(() => loadState(Date.now()));
  const [tab, setTab] = useState<Tab>('now');
  const [dialog, setDialog] = useState<'start' | 'checkout' | null>(null);
  const now = useNow(1000);
  const latest = useRef(s);
  latest.current = s;
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;

  // Every change is saved at once, so a crash or shutdown loses nothing; a copy goes to a file in the
  // app's data folder a moment later (in case the WebView's storage is ever cleared).
  const [restored, setRestored] = useState(() => hasSavedState());
  useEffect(() => {
    saveState(s);
    if (!restored) return;
    const id = setTimeout(() => void saveBackup(JSON.stringify(s)).catch(() => {}), 1500);
    return () => clearTimeout(id);
  }, [s, restored]);

  // Storage empty (first start, or cleared): take the backup file if there is one.
  useEffect(() => {
    if (restored) return;
    loadBackup()
      .then((json) => {
        if (json) {
          const back = parseState(json, Date.now());
          latest.current = back;
          setS(back);
          if (back.log.length) toast(`Restored ${back.log.length} session${back.log.length === 1 ? '' : 's'} from the backup file.`);
        }
      })
      .catch(() => {})
      .finally(() => setRestored(true));
  }, [restored]);

  // Windows follows the mode: what to block, whether to count program time, what the tray says.
  // During a break nothing is blocked or measured.
  const rules = s.rules[s.mode];
  const breakUntil = s.current?.onBreak?.until ?? 0;
  const goal = s.current?.goal ?? '';
  const blockedKey = rules.blocked.join('|');
  const sitesKey = rules.sites.join('|');
  const status = trayStatus(s);
  useEffect(() => {
    const blocked = blockedKey ? blockedKey.split('|') : [];
    const sites = sitesKey ? sitesKey.split('|').flatMap(siteKeys) : [];
    const work = s.mode === 'work';
    const failed = (e: unknown) => toast(`Windows side: ${String(e)}`, 'warn');
    if (work && breakUntil) {
      const resume = { at: breakUntil, blocked, sites, status: `WORK: ${goal}`, body: `Back to: ${goal}` };
      setMode(s.mode, MODE_NAME[s.mode], status, [], [], false, resume).catch(failed);
    } else {
      setMode(s.mode, MODE_NAME[s.mode], status, blocked, sites, work).catch(failed);
    }
  }, [s.mode, blockedKey, sitesKey, status, breakUntil, goal]);

  // A break whose time is up ends by itself (Windows has put the rules back and notified already).
  useEffect(() => {
    const b = latest.current.current?.onBreak;
    if (!b || now < b.until) return;
    setS((x) => settleBreak(x, now));
    toast('Break over. Blocking is on again.');
  }, [now]);

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

  const doStart = (goal: string, lockMin: number) => {
    const next = startWork(latest.current, goal, Date.now(), lockMin);
    if (next === latest.current) return;
    // Time measured before work started is not part of it.
    void takeUsage().catch(() => {});
    latest.current = next;
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
    const after = checkOut(addUsage(before, delta), outcome, next, Date.now());
    if (after.mode !== 'free') {
      // Still locked (or not in work): keep the measured time, end nothing.
      if (before.mode === 'work') setS((x) => addUsage(x, delta));
      return;
    }
    setDialog(null);
    latest.current = after;
    setS(after);
    toast(outcome === 'skipped' ? 'Work ended without a check-out.' : `Work ended: ${outcome === 'done' ? 'done.' : outcome === 'partly' ? 'partly done.' : 'not done.'}`);
    openStartup(after, 'free');
  };

  const doBreak = (min: number) => {
    // Time before the break belongs to the work.
    void flushUsage();
    setS((x) => startBreak(x, min, Date.now()));
    toast(`Break for ${min} minutes. Nothing is blocked until it ends.`);
  };

  const doEndBreak = () => {
    setS((x) => endBreak(x, Date.now()));
    toast('Back to work. Blocking is on again.');
  };

  const doExport = async () => {
    const d = new Date();
    const name = `modes-log-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
    try {
      const where = await saveFile(name, toCsv(latest.current.log));
      toast(`Saved ${where}`, 'info', 8000);
    } catch (e) {
      toast(`Could not save the file: ${String(e)}`, 'warn', 8000);
    }
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

  // The tray's "Start work…" / "End work…" and Ctrl+Alt+M, and what Windows closed.
  useEffect(() => {
    const a = onNative('tray', (p) => {
      if (p === 'switch' && !dialogRef.current) {
        setTab('now');
        onSwitch();
      }
    });
    // Sent when Windows ended a break on time; this page's own clock may be slowed down in the tray.
    const c = onNative('break-over', () => setS((x) => settleBreak(x, Date.now())));
    const b = onNative('blocked', (name) => {
      const site = !name.endsWith('.exe');
      toast(site ? `${name} is blocked in ${MODE_NAME[latest.current.mode]}: tab closed.` : `${shortName(name)} is blocked in ${MODE_NAME[latest.current.mode]}: closing it.`, 'warn');
      setS((x) => addTry(x, name));
    });
    return () => {
      a();
      b();
      c();
    };
  }, [onSwitch]);

  // Work hours: ask to start, and to check out at the end (not while a dialog is open or work is locked).
  useEffect(() => {
    const x = latest.current;
    const p = schedulePrompt(x, now);
    if (!p || dialogRef.current || (p === 'end' && isLocked(x, now))) return;
    setS((y) => markPrompted(y, p, now));
    setTab('now');
    setDialog(p === 'start' ? 'start' : 'checkout');
    void showWindow().catch(() => {});
    void notify(p === 'start' ? 'Time to start work' : 'Work hours are over', p === 'start' ? 'What will you get done?' : 'How did it go? Check out to end work.').catch(
      () => {},
    );
    if (p === 'end') void flushUsage();
  }, [now, flushUsage]);

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
        <span className={`mode-tag ${s.mode}`}>
          {MODE_NAME[s.mode]}
          {breakUntil ? ' · BREAK' : ''}
        </span>
      </nav>
      <main>
        {tab === 'now' && (
          <NowScreen
            s={s}
            now={now}
            onSwitch={onSwitch}
            onBreak={doBreak}
            onEndBreak={doEndBreak}
            onGuideDone={() => setS((x) => ({ ...x, guideDone: true }))}
          />
        )}
        {tab === 'rules' && <RulesScreen s={s} onRules={(m, r) => setS((x) => setRules(x, m, r))} onSettings={(st) => setS((x) => ({ ...x, settings: st }))} />}
        {tab === 'log' && <LogScreen s={s} now={now} onDelete={(id) => setS((x) => deleteSession(x, id))} onExport={() => void doExport()} />}
      </main>
      {dialog === 'start' && s.mode === 'free' && <StartWorkDialog s={s} suggestion={suggestedGoal(s)} onStart={doStart} onClose={() => setDialog(null)} />}
      {dialog === 'checkout' && s.mode === 'work' && (
        <CheckOutDialog
          s={s}
          now={now}
          canCancel={canCancel(s, now)}
          locked={isLocked(s, now)}
          onDone={(o, n) => void doCheckOut(o, n)}
          onCancelWork={doCancel}
          onClose={() => setDialog(null)}
        />
      )}
      <Toasts />
    </div>
  );
}
