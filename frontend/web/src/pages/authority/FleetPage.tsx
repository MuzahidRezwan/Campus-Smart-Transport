import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPERATOR_PALETTE } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { todayDhaka } from '../../lib/format';
import type { Allocation, AvailabilityDay, BusRow, Operator } from '../../lib/types';
import { BusChip, Card, ErrorNote, Loading, Modal, Pill, opStyle, useToast } from '../../components/ui';

export function FleetPage() {
  const { can } = useAuth();
  const manage = can('fleet.manage');
  const today = todayDhaka();
  const buses = useQuery({ queryKey: ['buses'], queryFn: () => api<BusRow[]>('/admin/fleet/buses') });
  const operators = useQuery({ queryKey: ['operators'], queryFn: () => api<Operator[]>('/admin/fleet/operators') });
  const avail = useQuery({ queryKey: ['availability', today, 1], queryFn: () => api<AvailabilityDay[]>('/admin/fleet/availability', { query: { from: today, days: 1 } }) });
  const allocs = useQuery({ queryKey: ['allocations', today], queryFn: () => api<Allocation[]>('/admin/allocations', { query: { date: today } }) });
  const [editOp, setEditOp] = useState<Operator | 'new' | null>(null);
  const [editBus, setEditBus] = useState<BusRow | 'new' | null>(null);
  if (buses.isLoading || operators.isLoading) return <Loading />;
  const out = new Map((avail.data?.[0]?.unavailable ?? []).map((u) => [u.code, u.reason]));
  const trips = new Map<string, number>();
  for (const a of allocs.data ?? []) for (const b of a.buses) trips.set(b.code, (trips.get(b.code) ?? 0) + 1);
  const list = buses.data ?? [];
  const usable = list.filter((b) => b.isActive && b.operatorActive);
  const ops = operators.data ?? [];
  return (
    <>
      <Card title="Bus companies" actions={manage && <button className="btn btn-sm btn-primary" onClick={() => setEditOp('new')}>Add company</button>}>
        <p className="muted mb-2 text-xs">Every screen lists the companies here: the dashboard's "Only …" rows, the allocation drawer, riders' My Bus and the scanner. Retire a company when its contract ends; its buses then cannot be allocated, and its history stays.</p>
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Company</th><th>Code</th><th>Contact</th><th>Buses</th><th>Status</th>{manage && <th />}</tr></thead>
          <tbody>{ops.map((o) => (
            <tr key={o.id}>
              <td><span className="bus mr-2" style={opStyle(o.displayColor)}>{o.code}</span><b>{o.name}</b></td>
              <td className="mono">{o.code}</td>
              <td className="mono text-xs">{o.contactPhone ?? '—'}</td>
              <td className="num">{o.activeBuses}{o.buses !== o.activeBuses && <span className="muted text-xs"> / {o.buses}</span>}</td>
              <td>{o.isActive ? <Pill tone="ok">Active</Pill> : <Pill tone="none">Retired</Pill>}</td>
              {manage && <td><button className="btn btn-sm" onClick={() => setEditOp(o)}>Edit</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Card>

      <Card title="Total bus list" actions={<>
        <Pill tone="none">{list.length} buses</Pill>
        <Pill tone="ok">{usable.filter((b) => !out.has(b.code)).length} available today</Pill>
        <Pill tone="info">{trips.size} allocated today</Pill>
        {manage && <button className="btn btn-sm btn-primary" disabled={!ops.some((o) => o.isActive)} onClick={() => setEditBus('new')}>Add bus</button>}
      </>}>
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Bus</th><th>Company</th><th>Seats</th><th>Pool</th><th>Driver</th><th>GPS</th><th>Today</th>{manage && <th />}</tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.id}>
              <td><BusChip code={b.code} color={b.operatorColor} /></td><td>{b.operatorName}</td><td className="num">{b.seatCapacity}</td><td>{b.pool === 'faculty' ? 'Faculty' : 'Student'}</td>
              <td>{b.driverName ?? '—'}<div className="muted mono text-xs">{b.driverPhone}</div></td>
              <td className="text-xs">{b.gpsDeviceId ? <Pill tone="ok">Linked</Pill> : <Pill tone="none">No tracker</Pill>}</td>
              <td>{!b.isActive ? <Pill tone="none">Retired</Pill> : !b.operatorActive ? <Pill tone="none">Company retired</Pill> : out.has(b.code) ? <Pill tone="crit">{out.get(b.code)}</Pill> : trips.get(b.code) ? <Pill tone="info">{trips.get(b.code)} trip(s)</Pill> : <Pill tone="ok">Free</Pill>}</td>
              {manage && <td><button className="btn btn-sm" onClick={() => setEditBus(b)}>Edit</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Card>

      {editOp && <OperatorDialog op={editOp === 'new' ? null : editOp} onClose={() => setEditOp(null)} />}
      {editBus && <BusDialog bus={editBus === 'new' ? null : editBus} operators={ops} onClose={() => setEditBus(null)} />}
    </>
  );
}

function OperatorDialog({ op, onClose }: { op: Operator | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ code: op?.code ?? '', name: op?.name ?? '', contactPhone: op?.contactPhone ?? '', color: op?.color ?? '' });
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['operators'] }); qc.invalidateQueries({ queryKey: ['buses'] }); toast(msg); onClose(); };
  const save = useMutation({
    mutationFn: () => {
      const body = { code: f.code.trim().toUpperCase(), name: f.name.trim(), contactPhone: f.contactPhone.trim() || (op ? null : undefined), color: f.color || (op ? null : undefined) };
      return op ? api(`/admin/fleet/operators/${op.id}`, { method: 'PATCH', body }) : api('/admin/fleet/operators', { body });
    },
    onSuccess: () => done(op ? 'Company saved' : 'Company added'),
  });
  const toggle = useMutation({
    mutationFn: () => api(`/admin/fleet/operators/${op!.id}`, { method: 'PATCH', body: { isActive: !op!.isActive } }),
    onSuccess: () => done(op!.isActive ? `${op!.name} retired` : `${op!.name} is active again`),
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/fleet/operators/${op!.id}`, { method: 'DELETE' }),
    onSuccess: () => done('Company deleted'),
  });
  return (
    <Modal title={op ? `Edit ${op.name}` : 'Add a bus company'} onClose={onClose} width={560}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="flex flex-wrap gap-2">
          <label className="field flex-1" htmlFor="op-name">Name<input id="op-name" className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Hanif" /></label>
          <label className="field w-28" htmlFor="op-code">Short code<input id="op-code" className="input mono" required pattern="[A-Za-z]{1,3}" maxLength={3} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="H" /></label>
        </div>
        {op && f.code !== op.code && <p className="muted text-xs">Bus numbers such as {op.code}-10 keep their names; edit each bus if they should change too.</p>}
        <label className="field" htmlFor="op-phone">Contact phone (optional)<input id="op-phone" className="input mono" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="01XXXXXXXXX" /></label>
        <div className="field">Colour
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Colour">
            <button type="button" className="btn btn-sm" aria-pressed={!f.color} onClick={() => setF({ ...f, color: '' })}>Automatic</button>
            {OPERATOR_PALETTE.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })}
                className="h-7 w-7 rounded-full border-2" style={{ background: c, borderColor: f.color === c ? 'var(--ink)' : 'transparent' }} />
            ))}
          </div>
        </div>
        {save.error ? <ErrorNote error={save.error} /> : null}
        {toggle.error ? <ErrorNote error={toggle.error} /> : null}
        {remove.error ? <ErrorNote error={remove.error} /> : null}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={save.isPending}>{op ? 'Save' : 'Add company'}</button>
          {op && <button type="button" className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate()}>{op.isActive ? 'Retire company' : 'Bring back'}</button>}
          <span className="flex-1" />
          {op && op.buses === 0 && <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</button>}
        </div>
        {op?.isActive && op.activeBuses > 0 && <p className="muted text-xs">Retiring stops new allocations of its {op.activeBuses} bus(es). Trips already allocated stay as they are; replace those buses on the dashboard.</p>}
      </form>
    </Modal>
  );
}

function BusDialog({ bus, operators, onClose }: { bus: BusRow | null; operators: Operator[]; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const choices = operators.filter((o) => o.isActive || o.id === bus?.operatorId);
  const [f, setF] = useState({
    code: bus?.code ?? '', operatorId: bus?.operatorId ?? choices[0]?.id ?? '', seatCapacity: String(bus?.seatCapacity ?? 40), pool: bus?.pool ?? 'student',
    registrationNumber: bus?.registrationNumber ?? '', driverName: bus?.driverName ?? '', driverPhone: bus?.driverPhone ?? '', isActive: bus?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const opt = (v: string) => v.trim() || undefined;
      const body = {
        code: f.code.trim().toUpperCase(), operatorId: f.operatorId, seatCapacity: Number(f.seatCapacity), pool: f.pool,
        registrationNumber: opt(f.registrationNumber), driverName: opt(f.driverName), driverPhone: opt(f.driverPhone), isActive: f.isActive,
      };
      return bus ? api(`/admin/fleet/buses/${bus.id}`, { method: 'PATCH', body }) : api('/admin/fleet/buses', { body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['buses'] }); qc.invalidateQueries({ queryKey: ['operators'] }); toast(bus ? `${f.code} saved` : `${f.code} added`); onClose(); },
  });
  const code = choices.find((o) => o.id === f.operatorId)?.code ?? 'H';
  return (
    <Modal title={bus ? `Edit ${bus.code}` : 'Add a bus'} onClose={onClose} width={620}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="flex flex-wrap gap-2">
          <label className="field flex-1" htmlFor="bus-op">Company<select id="bus-op" className="input" value={f.operatorId} onChange={(e) => setF({ ...f, operatorId: e.target.value })}>
            {choices.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code}){o.isActive ? '' : ' · retired'}</option>)}</select></label>
          <label className="field w-32" htmlFor="bus-code">Bus number<input id="bus-code" className="input mono" required pattern="[A-Za-z]{1,3}-[0-9]{1,3}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder={`${code}-10`} /></label>
          <label className="field w-24" htmlFor="bus-seats">Seats<input id="bus-seats" type="number" min={10} max={90} className="input" required value={f.seatCapacity} onChange={(e) => setF({ ...f, seatCapacity: e.target.value })} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="field" htmlFor="bus-pool">Pool<select id="bus-pool" className="input" value={f.pool} onChange={(e) => setF({ ...f, pool: e.target.value as 'student' | 'faculty' })}>
            <option value="student">Student buses</option><option value="faculty">Faculty / staff buses</option></select></label>
          <label className="field flex-1" htmlFor="bus-reg">Registration (optional)<input id="bus-reg" className="input mono" value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value })} placeholder="Dhaka Metro Ba 11-2233" /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="field flex-1" htmlFor="bus-driver">Driver (optional)<input id="bus-driver" className="input" value={f.driverName} onChange={(e) => setF({ ...f, driverName: e.target.value })} /></label>
          <label className="field flex-1" htmlFor="bus-phone">Driver phone (optional)<input id="bus-phone" className="input mono" value={f.driverPhone} onChange={(e) => setF({ ...f, driverPhone: e.target.value })} placeholder="01XXXXXXXXX" /></label>
        </div>
        {bus && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />In service (untick to retire this bus)</label>}
        {save.error ? <ErrorNote error={save.error} /> : null}
        <div><button className="btn btn-primary" disabled={save.isPending}>{bus ? 'Save' : 'Add bus'}</button></div>
      </form>
    </Modal>
  );
}
