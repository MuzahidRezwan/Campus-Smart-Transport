import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

/** A bus number, coloured by its company. */
export function BusChip({ code, capacity, color }: { code: string; capacity?: number; color?: string }) {
  return <span className="bus" style={opStyle(color)}>{code}{capacity ? <span className="opacity-70 font-medium">{capacity}</span> : null}</span>;
}

/** Sets the company colour used by `.bus` chips and buttons. */
export const opStyle = (color?: string): CSSProperties => ({ ['--op' as string]: color ?? 'var(--muted)' });

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'none';
export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`pill pill-${tone}`}>{children}</span>;

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          {title && <h2 className="text-lg">{title}</h2>}
          <span className="flex-1" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted py-6">{what}…</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong';
  return <p role="alert" className="rounded-lg px-3 py-2 font-semibold" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{msg}</p>;
}

export function Modal({ title, onClose, children, width }: { title: string; onClose(): void; children: ReactNode; width?: number }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, calc(100% - 32px))` } : undefined}>
        <div className="grid gap-3 p-5">
          <div className="flex items-center gap-2"><h2 className="flex-1 text-lg">{title}</h2><button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * Asks for a written reason before an access change. The reason goes to the audit log.
 * With `payBy`, also offers "the rider will pay later" with a pay-by date.
 */
export function ReasonDialog({ title, subject, onCancel, onConfirm, payBy }: {
  title: string; subject: ReactNode; onCancel(): void; onConfirm(reason: string, extra: { payBy?: string }): Promise<void>;
  payBy?: { min: string; max?: string; initial?: string; required?: boolean };
}) {
  const [reason, setReason] = useState('');
  const [later, setLater] = useState(Boolean(payBy?.required || payBy?.initial));
  const [date, setDate] = useState(payBy?.initial ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dateMissing = Boolean(payBy) && later && !date;
  return (
    <Modal title={title} onClose={onCancel} width={560}>
      <p className="muted">{subject}</p>
      {payBy && (
        <div className="grid gap-2">
          {!payBy.required && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />The rider will pay later</label>}
          {later && (
            <label className="field" htmlFor="pay-by">Pay by (access stops the day after if unpaid)
              <input id="pay-by" type="date" className="input" min={payBy.min} max={payBy.max} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          {later && <p className="muted m-0 text-xs">The rider is reminded 3 days and 1 day before, and on the day. Paying in the app makes it a normal card to the end of the semester.</p>}
        </div>
      )}
      <label className="field" htmlFor="reason">Reason (saved in the audit log)
        <textarea id="reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sports quota approved by the Proctor's office, memo 41/2026" />
      </label>
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || reason.trim().length < 5 || dateMissing} onClick={async () => {
          setBusy(true);
          try { await onConfirm(reason.trim(), payBy && later && date ? { payBy: date } : {}); } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Confirm</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 left-1/2 z-[70] grid w-[min(460px,calc(100%-32px))] -translate-x-1/2 gap-2">
        {items.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
