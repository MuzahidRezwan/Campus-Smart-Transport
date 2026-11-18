import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USER_CATEGORIES, USER_CATEGORY_LABELS, type UserCategory } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { taka } from '../../lib/format';
import type { RouteInfo } from '../../lib/types';
import { Card, ErrorNote, Loading, Pill, useToast } from '../../components/ui';

interface Semester { id: string; code: string; name: string; isCurrent: boolean }
interface FeeRule { id: string; category: UserCategory | null; routeId: string | null; routeCode: string | null; routeName: string | null; amountBdt: number; isActive: boolean }
interface RiderFee { id: string; universityId: string; name: string; amountBdt: number; reason: string }
interface Preview { name?: string; fee: { amountBdt: number; label: string } | null }

const catLabel = (c: UserCategory | null) => (c ? USER_CATEGORY_LABELS[c] : 'All categories');

/**
 * The transport office sets every fee. The most specific rule wins:
 * this rider's own fee > route + category > route > category > everyone.
 */
export function FeesPage() {
  const { can } = useAuth();
  const manage = can('fees.manage');
  const qc = useQueryClient();
  const toast = useToast();
  const semesters = useQuery({ queryKey: ['semesters'], queryFn: () => api<Semester[]>('/admin/semesters') });
  const routes = useQuery({ queryKey: ['public-routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const [semesterId, setSemesterId] = useState('');
  useEffect(() => { if (!semesterId && semesters.data) setSemesterId(semesters.data.find((s) => s.isCurrent)?.id ?? semesters.data[0]?.id ?? ''); }, [semesters.data, semesterId]);
  const fees = useQuery({ queryKey: ['fees', semesterId], queryFn: () => api<{ rules: FeeRule[]; riders: RiderFee[] }>('/admin/fees', { query: { semesterId } }), enabled: Boolean(semesterId) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fees', semesterId] }); qc.invalidateQueries({ queryKey: ['fee-preview'] }); };

  const [rule, setRule] = useState({ category: '', routeId: '', amount: '' });
  const saveRule = useMutation({
    mutationFn: (v: { category: string; routeId: string; amount: number; isActive?: boolean }) => api('/admin/fees', { method: 'PUT', body: { semesterId, category: v.category || null, routeId: v.routeId || null, amountBdt: v.amount, isActive: v.isActive ?? true } }),
    onSuccess: () => { refresh(); toast('Fee saved. New payments use it; nothing already paid changes.'); setRule({ category: '', routeId: '', amount: '' }); },
  });
  const removeRule = useMutation({ mutationFn: (id: string) => api(`/admin/fees/${id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); toast('Fee rule removed'); } });

  const [rider, setRider] = useState({ universityId: '', amount: '', reason: '' });
  const saveRider = useMutation({
    mutationFn: () => api<{ name: string }>(`/admin/fees/riders/${encodeURIComponent(rider.universityId.trim())}`, { method: 'PUT', body: { semesterId, amountBdt: Number(rider.amount), reason: rider.reason.trim() } }),
    onSuccess: (r) => { refresh(); toast(`Fee set for ${r.name}`); setRider({ universityId: '', amount: '', reason: '' }); },
  });
  const removeRider = useMutation({
    mutationFn: (uid: string) => api(`/admin/fees/riders/${encodeURIComponent(uid)}`, { method: 'DELETE', query: { semesterId } }),
    onSuccess: () => { refresh(); toast('Rider fee removed; the rules apply again'); },
  });

  const [check, setCheck] = useState({ category: '', routeId: '', universityId: '' });
  const preview = useQuery({
    queryKey: ['fee-preview', semesterId, check],
    queryFn: () => api<Preview>('/admin/fees/preview', { query: { semesterId, category: check.category || undefined, routeId: check.routeId || undefined, universityId: check.universityId.trim() || undefined } }),
    enabled: Boolean(semesterId && (check.category || check.routeId || check.universityId.trim().length >= 6)),
    retry: false,
  });

  if (semesters.isLoading || !semesterId) return <Loading />;
  const rules = fees.data?.rules ?? [];
  const routeOptions = (routes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>);
  const categoryOptions = USER_CATEGORIES.map((c) => <option key={c} value={c}>{USER_CATEGORY_LABELS[c]}</option>);

  return (
    <>
      <Card title="Fees" actions={
        <label className="field" htmlFor="sem">Semester<select id="sem" className="input" value={semesterId} onChange={(e) => setSemesterId(e.target.value)}>
          {(semesters.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}</select></label>
      }>
        <p className="muted text-xs">You set every amount, and can raise or lower it at any time. The most specific fee wins: a rider's own fee, then route + category, then route, then category, then the fee for everyone. A change applies to new payments only.</p>
      </Card>

      <Card title="Fee rules">
        {fees.isLoading ? <Loading /> : fees.error ? <ErrorNote error={fees.error} /> : (
          <div className="overflow-x-auto"><table className="data">
            <thead><tr><th>Category</th><th>Route</th><th>Amount</th><th>Status</th>{manage && <th />}</tr></thead>
            <tbody>
              {!rules.length && <tr><td colSpan={5} className="muted">No fee rules yet. Riders cannot pay until a fee applies to them.</td></tr>}
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{catLabel(r.category)}</td>
                  <td>{r.routeCode ? `${r.routeCode} · ${r.routeName}` : 'All routes'}</td>
                  <td className="num"><b>{taka(r.amountBdt)}</b></td>
                  <td>{r.isActive ? <Pill tone="ok">In use</Pill> : <Pill tone="none">Off</Pill>}</td>
                  {manage && <td><div className="flex gap-1.5">
                    <button className="btn btn-sm" onClick={() => setRule({ category: r.category ?? '', routeId: r.routeId ?? '', amount: String(r.amountBdt) })}>Change</button>
                    <button className="btn btn-sm" onClick={() => saveRule.mutate({ category: r.category ?? '', routeId: r.routeId ?? '', amount: r.amountBdt, isActive: !r.isActive })}>{r.isActive ? 'Turn off' : 'Turn on'}</button>
                    <button className="btn btn-sm btn-danger" onClick={() => removeRule.mutate(r.id)}>Remove</button>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {manage && (
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); saveRule.mutate({ category: rule.category, routeId: rule.routeId, amount: Number(rule.amount) }); }}>
            <label className="field" htmlFor="fr-cat">Category<select id="fr-cat" className="input" value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value })}><option value="">All categories</option>{categoryOptions}</select></label>
            <label className="field" htmlFor="fr-route">Route<select id="fr-route" className="input" value={rule.routeId} onChange={(e) => setRule({ ...rule, routeId: e.target.value })}><option value="">All routes</option>{routeOptions}</select></label>
            <label className="field w-32" htmlFor="fr-amt">Amount (৳)<input id="fr-amt" type="number" min={1} max={100000} required className="input" value={rule.amount} onChange={(e) => setRule({ ...rule, amount: e.target.value })} /></label>
            <button className="btn btn-primary" disabled={saveRule.isPending}>Save fee</button>
            <span className="muted w-full text-xs">Saving a category and route that already has a fee replaces its amount.</span>
          </form>
        )}
        {saveRule.error ? <ErrorNote error={saveRule.error} /> : null}
        {removeRule.error ? <ErrorNote error={removeRule.error} /> : null}
      </Card>

      <Card title="Fee for one rider">
        <p className="muted mb-2 text-xs">A special amount for one person this semester, e.g. a discount the university approved. It beats every rule. Full university ID only; saved with your reason in the audit log.</p>
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>ID</th><th>Name</th><th>Amount</th><th>Reason</th>{manage && <th />}</tr></thead>
          <tbody>
            {!fees.data?.riders.length && <tr><td colSpan={5} className="muted">None.</td></tr>}
            {fees.data?.riders.map((r) => (
              <tr key={r.id}><td className="mono">{r.universityId}</td><td>{r.name}</td><td className="num"><b>{taka(r.amountBdt)}</b></td><td className="text-xs">{r.reason}</td>
                {manage && <td><button className="btn btn-sm btn-danger" onClick={() => removeRider.mutate(r.universityId)}>Remove</button></td>}</tr>
            ))}
          </tbody>
        </table></div>
        {manage && (
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); saveRider.mutate(); }}>
            <label className="field" htmlFor="rf-id">University ID<input id="rf-id" className="input mono" required value={rider.universityId} onChange={(e) => setRider({ ...rider, universityId: e.target.value })} placeholder="232-35-797" /></label>
            <label className="field w-32" htmlFor="rf-amt">Amount (৳)<input id="rf-amt" type="number" min={1} max={100000} required className="input" value={rider.amount} onChange={(e) => setRider({ ...rider, amount: e.target.value })} /></label>
            <label className="field flex-1" htmlFor="rf-reason">Reason<input id="rf-reason" className="input" required minLength={5} value={rider.reason} onChange={(e) => setRider({ ...rider, reason: e.target.value })} placeholder="e.g. 50% waiver, Registrar memo 12/2026" /></label>
            <button className="btn btn-primary" disabled={saveRider.isPending}>Set fee</button>
          </form>
        )}
        {saveRider.error ? <ErrorNote error={saveRider.error} /> : null}
        {removeRider.error ? <ErrorNote error={removeRider.error} /> : null}
      </Card>

      <Card title="What will they pay?">
        <div className="flex flex-wrap items-end gap-2">
          <label className="field" htmlFor="pv-cat">Category<select id="pv-cat" className="input" value={check.category} onChange={(e) => setCheck({ ...check, category: e.target.value })}><option value="">—</option>{categoryOptions}</select></label>
          <label className="field" htmlFor="pv-route">Route<select id="pv-route" className="input" value={check.routeId} onChange={(e) => setCheck({ ...check, routeId: e.target.value })}><option value="">—</option>{routeOptions}</select></label>
          <label className="field" htmlFor="pv-id">or a rider's ID<input id="pv-id" className="input mono" value={check.universityId} onChange={(e) => setCheck({ ...check, universityId: e.target.value })} placeholder="232-35-797" /></label>
        </div>
        <div className="mt-3">
          {preview.isFetching ? <Loading what="Checking" /> : preview.error ? <ErrorNote error={preview.error} /> : preview.data ? (
            preview.data.fee
              ? <p className="text-lg">{preview.data.name ? `${preview.data.name} pays ` : 'Pays '}<b>{taka(preview.data.fee.amountBdt)}</b> <span className="muted text-sm">· {preview.data.fee.label}</span></p>
              : <p><Pill tone="warn">No fee applies</Pill> <span className="muted text-sm">This rider cannot pay until you add a rule that covers them.</span></p>
          ) : <p className="muted text-sm">Pick a category and route, or type a full university ID.</p>}
        </div>
      </Card>
    </>
  );
}
