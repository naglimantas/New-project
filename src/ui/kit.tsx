import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Panel({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className ?? ''}`}>
      <header className="legend">
        <span>{title}</span>
        {right && <span className="legend-right">{right}</span>}
      </header>
      {children}
    </section>
  );
}

/** A dialog. Esc and the × call `onClose`; only the body scrolls, so the buttons always show. */
export function Window({ title, onClose, children, foot }: { title: string; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, button.primary');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="window" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="wtitle">
          <span>{title}</span>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="wbody">{children}</div>
        <div className="wfoot">{foot}</div>
      </div>
    </div>,
    document.body,
  );
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn';
}

let nextToast = 1;
const listeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];

function emit() {
  for (const l of listeners) l(toasts);
}

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 5000) {
  const t = { id: nextToast++, text, kind };
  toasts = [...toasts.slice(-3), t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, ms);
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** A bar of `value` out of `max`, for program time. */
export function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return (
    <span className="bar" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
