import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { computeBusRequirement, formatClock, formatMix, groupByOperator } from '@diu/shared';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dayLabel, routeLabel } from '../lib/format';
import type { Allocation, BusOption, PredictionRow } from '../lib/types';
import { ErrorNote, Loading, opStyle, useToast } from './ui';

type Status = 'draft' | 'published';

/**
 * Allocate buses to one trip. The office decides: the prediction is a guide, any
 * bus can be picked (including the other pool), and a bus whose estimated busy
 * window overlaps another trip can still be used after giving a reason.
 * Only out-of-service buses (marked by the office itself) cannot be picked.
 */
export function AllocationDrawer({ row, date, current, onClose }: { row: PredictionRow; date: string; current?: Allocation; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set(current?.buses.map((b) => b.id) ?? []));
  const [confirm, setConfirm] = useState<{ status: Status; clashes: string[] } | null>(null);
  const [reason, setReason] = useState('');
  const options = useQuery({ queryKey: ['alloc-options', date, row.timeSlotId], queryFn: () => api<{ buses: BusOption[]; window: { start: number; end: number } }>('/admin/allocations/options', { query: { date, timeSlotId: row.timeSlotId } }) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const buses = options.data?.buses ?? [];
  const pool = buses.filter((b) => b.samePool);
  const otherPool = buses.filter((b) => !b.samePool);
  const chosen = buses.filter((b) => selected.has(b.id));
  const seats = chosen.reduce((t, b) => t + b.capacity, 0);
  const target = row.p90;
  const free = pool.filter((b) => (!b.blockedReason && !b.conflict) || selected.has(b.id)).map((b) => ({ id: b.id, code: b.code, operatorCode: b.operatorCode, capacity: b.capacity }));
  const operatorCodes = useMemo(() => groupByOperator(pool).map((g) => g.operatorCode), [pool]);
  const req = useMemo(() => (target === null ? null : computeBusRequirement(target, free, { operators: operatorCodes })), [target, free, operatorCodes]);
  const names = new Map(buses.map((b) => [b.operatorCode, b.operatorName]));
  const tone = target === null ? 'ok' : seats >= target ? 'ok' : row.predicted !== null && seats >= row.predicted ? 'warn' : 'crit';
  const conflicted = chosen.filter((b) => b.conflict);

  const save = useMutation({
    mutationFn: (v: { status: Status; override?: string }) => api<Allocation>('/admin/allocations', {
      method: 'PUT',
      body: { serviceDate: date, timeSlotId: row.timeSlotId, busIds: [...selected], status: v.status, ...(v.override ? { overrideConflicts: true, overrideReason: v.override } : {}) },
    }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['allocations', date] });
      qc.invalidateQueries({ queryKey: ['alloc-options', date] });
      toast(v.status === 'published' ? `Published · ${routeLabel(row.direction, row.routeName)} ${formatClock(row.departureMinutes)} · riders notified` : 'Draft saved');
      onClose();
    },
    onError: (e, v) => {
      // Another trip took one of these buses since the drawer opened: ask, as for a known overlap.
      if (e instanceof ApiError && e.code === 'bus_conflict' && !v.override) {
        const details = (e.details as { busCode: string; busyWith: string }[] | undefined) ?? [];
        setConfirm({ status: v.status, clashes: details.map((d) => `${d.busCode} is on ${d.busyWith}`) });
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/allocations/${current!.id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['allocations', date] }); toast('Allocation deleted'); onClose(); },
  });

  const submit = (status: Status) => {
    if (conflicted.length) setConfirm({ status, clashes: conflicted.map((b) => `${b.code} is ${b.conflict!.replace(/^On /, 'on ')}`) });
    else save.mutate({ status });
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const busButtons = (list: BusOption[]) => groupByOperator(list).map(({ operatorCode, buses: group }) => (
    <div key={operatorCode} className="grid gap-2">
      <div><b>{group[0]!.operatorName}</b> <span className="muted text-xs">{[...new Set(group.map((b) => b.capacity))].join(' / ')} seats</span></div>
      <div className="flex flex-wrap gap-1.5">
        {group.map((b) => (
          <button key={b.id} type="button" className="bus" style={{ ...opStyle(b.operatorColor), ...(b.conflict ? { borderStyle: 'dashed' } : {}) }} aria-pressed={selected.has(b.id)}
            disabled={Boolean(b.blockedReason) && !selected.has(b.id)} title={b.blockedReason ?? b.conflict ?? `${b.capacity} seats`} onClick={() => toggle(b.id)}>
            {b.code}{b.conflict ? ' ⚠' : ''}
          </button>
        ))}
      </div>
    </div>
  ));

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Allocate buses">
        <div className="flex items-start gap-2.5 border-b border-line p-4">
          <div className="flex-1">
            <p className="muted text-xs">{row.routeKind === 'shuttle' ? 'Shuttle' : `${row.routeCode} · ${row.audience === 'faculty' ? 'Faculty' : 'Student'} service`} · {dayLabel(date)}</p>
            <h2 className="text-lg">{routeLabel(row.direction, row.routeName)} · {formatClock(row.departureMinutes)}</h2>
            <p className="muted text-xs">{current ? `${current.status === 'published' ? 'Published' : 'Draft'}` : 'No allocation yet'}</p>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
          {target === null ? (
            <p className="tile">No prediction for this trip yet. Pick the buses you think it needs; you can run the forecast later.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {[['Routine max', row.expectedMax, 'everyone with class'], ['Predicted', row.predicted, 'likely riders'], ['P90 (safe)', row.p90, 'allocate for this']].map(([l, v, s]) => (
                <div key={String(l)} className="tile"><div className="tile-label">{l}</div><div className="tile-big text-2xl">{v}</div><div className="muted text-xs">{s}</div></div>
              ))}
            </div>
          )}
          {req && (
            <div>
              <b>Buses required for P90</b> <span className="muted text-xs">(a suggestion: you decide)</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {req.singleOperator.map((o) => (
                  <div key={o.operatorCode} className="tile"><span className="muted text-xs">Only {names.get(o.operatorCode) ?? o.operatorCode}</span><b className="block text-lg" style={{ color: o.feasible ? undefined : 'var(--crit)' }}>{o.busesNeeded}</b><span className="text-xs">{o.feasible ? 'available' : 'not enough free'}</span></div>
                ))}
                <div className="tile"><span className="muted text-xs">Mixed</span><b className="block text-lg">{req.mixed.busesNeeded}</b><span className="mono text-xs">{formatMix(req.mixed.byOperator)}</span></div>
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <div className="flex"><b className="flex-1">Seats selected</b><span className="num"><b>{seats}</b>{target !== null && <> / {target} needed</>}</span></div>
            {target !== null && <div className={`bar ${tone}`}><i style={{ width: `${Math.min(100, Math.round((seats / Math.max(1, target)) * 100))}%` }} /></div>}
            <div className="flex flex-wrap gap-2">
              {req && <button className="btn btn-sm" onClick={() => setSelected(new Set(req.mixed.buses.map((b) => b.id!)))}>Use suggestion ({formatMix(req.mixed.byOperator) || 'none'})</button>}
              <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
          {options.isLoading ? <Loading what="Loading buses" /> : options.error ? <ErrorNote error={options.error} /> : (
            <div className="grid gap-3">
              <b>{row.audience === 'faculty' ? 'Faculty / staff' : 'Student'} buses</b>
              {options.data && <span className="muted text-xs">⚠ dashed: on another trip that overlaps {formatClock(options.data.window.start)}–{formatClock(options.data.window.end)} (estimated). You can still pick it and give a reason. Crossed out: out of service today.</span>}
              {busButtons(pool)}
              {otherPool.length > 0 && (
                <details className="grid gap-3" open={otherPool.some((b) => selected.has(b.id))}>
                  <summary className="cursor-pointer font-bold">{row.audience === 'faculty' ? 'Student' : 'Faculty / staff'} buses ({otherPool.length})</summary>
                  <div className="mt-2 grid gap-3">{busButtons(otherPool)}</div>
                </details>
              )}
            </div>
          )}
          {confirm && (
            <div className="tile grid gap-2" style={{ borderColor: 'var(--warn)' }} role="alertdialog" aria-label="Confirm overlapping trips">
              <b>These buses are also on another trip at about the same time:</b>
              <ul className="pl-4 text-sm">{confirm.clashes.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="muted text-xs">The busy time is estimated from the route's travel time. If you know the bus will be free, allocate anyway. Your reason is saved in the audit log.</p>
              <label className="field" htmlFor="override-reason">Reason
                <input id="override-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. H-10 comes back early on Fridays" />
              </label>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={reason.trim().length < 5 || save.isPending} onClick={() => save.mutate({ status: confirm.status, override: reason.trim() })}>
                  {confirm.status === 'published' ? 'Publish anyway' : 'Save anyway'}
                </button>
                <button className="btn" onClick={() => setConfirm(null)}>Change buses</button>
              </div>
            </div>
          )}
          {save.error && !(save.error instanceof ApiError && save.error.code === 'bus_conflict' && confirm) ? <ErrorNote error={save.error} /> : null}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line p-3">
          {can('allocation.publish') && <button className="btn btn-primary" disabled={!selected.size || save.isPending} onClick={() => submit('published')}>Publish</button>}
          <button className="btn" disabled={!selected.size || save.isPending} onClick={() => submit('draft')}>Save draft</button>
          <span className="flex-1" />
          {current && <button className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete allocation</button>}
        </div>
      </aside>
    </>
  );
}
