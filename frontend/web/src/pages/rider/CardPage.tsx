import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { USER_CATEGORY_LABELS, type UserCategory } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dayLabel, taka, todayDhaka } from '../../lib/format';
import { qrToken, secondsLeft } from '../../lib/qr';
import type { RouteInfo } from '../../lib/types';
import { ErrorNote, Loading, Pill, useToast } from '../../components/ui';

interface MyCard {
  card: { id: string; status: string; source: string | null; semester: string; route: { id: string; name: string }; issuedAt: string | null; expiresOn: string | null; payBy: string | null; qrSecret: string | null } | null;
  dayPasses: { id: string; travelDate: string; route: string; status: string; qrSecret: string | null }[];
  dayPassesLeft: number;
}

function RotatingQr({ secret, kind, id }: { secret: string; kind: 'c' | 'p'; id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [left, setLeft] = useState(secondsLeft());
  useEffect(() => {
    let alive = true;
    const draw = async () => {
      const token = await qrToken(secret, kind, id);
      const url = await QRCode.toDataURL(token, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
      if (alive) setSrc(url);
    };
    draw();
    const t = setInterval(() => { const s = secondsLeft(); setLeft(s); if (s === 30) draw(); }, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [secret, kind, id]);
  return (
    <div className="grid justify-items-center gap-1.5 pb-4">
      {src ? <img src={src} alt="Boarding QR code" width={200} height={200} className="rounded-lg bg-white p-2" /> : <Loading what="Making QR" />}
      <span className="muted text-xs">Show this when boarding · refreshes in <b>{left}</b>s · works offline</span>
    </div>
  );
}

export function CardPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['my-card'], queryFn: () => api<MyCard>('/me/card') });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const [routeId, setRouteId] = useState('');
  const [note, setNote] = useState('');
  const [passDate, setPassDate] = useState(todayDhaka);
  // Pay-later riders pay for the route the transport office gave them.
  const chosen = (q.data?.card?.payBy ? q.data.card.route.id : '') || routeId || me?.homeRouteId || routes.data?.[0]?.id || '';
  const fee = useQuery({ queryKey: ['my-fee', chosen], queryFn: () => api<{ semester: string; amountBdt: number | null; special: boolean }>('/me/fee', { query: { routeId: chosen } }), enabled: Boolean(chosen) });

  const pay = useMutation({
    mutationFn: () => api<{ redirectUrl: string }>('/me/card', { body: { routeId: chosen } }),
    onSuccess: (r) => window.location.assign(r.redirectUrl),
  });
  const free = useMutation({
    mutationFn: () => api('/me/card/free-request', { body: { routeId: chosen, note } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-card'] }); toast('Request sent to the transport office'); },
  });
  const pass = useMutation({
    mutationFn: () => api<{ status: string }>('/me/day-passes', { body: { travelDate: passDate, routeId: chosen } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['my-card'] }); toast(r.status === 'approved' ? 'Day pass approved' : 'Request sent for approval'); },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const { card, dayPasses, dayPassesLeft } = q.data!;
  const active = card?.status === 'active' && card.qrSecret;

  const payLater = card?.payBy && card.status === 'active';
  const overdue = card?.payBy && card.status !== 'active' && card.payBy < todayDhaka();

  return (
    <>
      {payLater && (
        <div className="card grid gap-2" style={{ borderColor: 'var(--warn)' }}>
          <b>Access from the transport office until {dayLabel(card.payBy!)}</b>
          <span className="text-sm">Pay {fee.data?.amountBdt ? <b>{taka(fee.data.amountBdt)}</b> : 'the fee'} before then to keep riding for the rest of {card.semester}. You can ride while you pay.</span>
          <button className="btn btn-primary justify-center" disabled={pay.isPending || !fee.data?.amountBdt} onClick={() => pay.mutate()}>Pay now</button>
          {pay.error ? <ErrorNote error={pay.error} /> : null}
        </div>
      )}
      {overdue && <p className="rounded-lg px-3 py-2.5 font-semibold" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>Your access ended because the fee was not paid by {dayLabel(card.payBy!)}. Pay below to ride again, or contact the transport office.</p>}
      {active ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-3 p-4 text-white" style={{ background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--op-m)))' }}>
            <div className="grid h-[76px] w-16 place-items-center rounded-lg border-2 border-white/50 bg-white/20 text-xl font-bold">{me?.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</div>
            <div><div className="text-xs font-bold opacity-85">DAFFODIL INTERNATIONAL UNIVERSITY</div><b className="text-lg">{me?.name}</b><div className="text-xs">{me?.profile.department}</div></div>
          </div>
          <dl className="grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 p-4 text-sm">
            <dt className="muted font-bold">ID</dt><dd className="mono">{me?.universityId}</dd>
            <dt className="muted font-bold">Card</dt><dd>{card.semester} · {USER_CATEGORY_LABELS[me?.category as UserCategory] ?? ''}</dd>
            <dt className="muted font-bold">Route</dt><dd>{card.route.name} ⇄ DSC</dd>
            <dt className="muted font-bold">Expires</dt><dd>{card.expiresOn}{card.payBy ? ' (unless paid)' : ''}</dd>
            <dt className="muted font-bold">Status</dt><dd><Pill tone="ok">Active</Pill></dd>
          </dl>
          <RotatingQr secret={card.qrSecret!} kind="c" id={card.id} />
        </div>
      ) : (
        <div className="card grid gap-3">
          <b>Transport card {card ? <Pill tone="warn">{card.status.replace('_', ' ')}</Pill> : null}</b>
          <label className="field" htmlFor="route">Your route<select id="route" className="input" value={chosen} onChange={(e) => setRouteId(e.target.value)}>{(routes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          {fee.data && (fee.data.amountBdt !== null
            ? <p className="m-0">Fee for {fee.data.semester}: <b>{taka(fee.data.amountBdt)}</b>{fee.data.special ? <span className="muted text-xs"> · your own fee, set by the transport office</span> : null}</p>
            : <p className="m-0"><Pill tone="warn">Fee not set yet</Pill> <span className="muted text-xs">The transport office has not set a fee for this route and your category.</span></p>)}
          <p className="muted m-0 text-xs">Fees are set by the transport office. Pay with bKash, Nagad, Rocket or card through SSLCommerz. The card turns active as soon as the payment is confirmed.</p>
          <button className="btn btn-primary justify-center" disabled={!chosen || pay.isPending || fee.data?.amountBdt === null} onClick={() => pay.mutate()}>{fee.data?.amountBdt ? `Pay ${taka(fee.data.amountBdt)} and get card` : 'Pay and get card'}</button>
          {pay.error ? <ErrorNote error={pay.error} /> : null}
          <details><summary className="cursor-pointer text-sm font-bold">Ask for free access instead</summary>
            <div className="mt-2 grid gap-2"><textarea className="input" rows={2} placeholder="Why (e.g. scholarship, sports quota)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn" disabled={note.trim().length < 10 || free.isPending} onClick={() => free.mutate()}>Send request</button>{free.error ? <ErrorNote error={free.error} /> : null}</div>
          </details>
        </div>
      )}

      <IdCardBoarding />

      {dayPasses.map((p) => (
        <div key={p.id} className="card">
          <div className="flex items-center gap-2"><b className="flex-1">One Day Pass · {dayLabel(p.travelDate)}</b><Pill tone={p.status === 'approved' ? 'ok' : 'none'}>{p.status}</Pill></div>
          <div className="muted text-xs">{p.route}, both directions</div>
          {p.qrSecret && p.travelDate === todayDhaka() && <RotatingQr secret={p.qrSecret} kind="p" id={p.id} />}
        </div>
      ))}

      {!active && (
        <div className="card grid gap-2">
          <b>One Day Pass · {dayPassesLeft} left this semester</b>
          <div className="flex flex-wrap items-end gap-2">
            <label className="field" htmlFor="pd">Date<input id="pd" type="date" className="input" min={todayDhaka()} value={passDate} onChange={(e) => setPassDate(e.target.value)} /></label>
            <button className="btn" disabled={!chosen || pass.isPending} onClick={() => pass.mutate()}>Request pass</button>
          </div>
          {pass.error ? <ErrorNote error={pass.error} /> : null}
        </div>
      )}
    </>
  );
}

/** Boarding with the university ID card: on/off (lost card) and which numbers are linked. */
function IdCardBoarding() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['my-id-card'], queryFn: () => api<{ enabled: boolean; linked: { kind: string; source: string; status: string; linkedAt: string }[] }>('/me/id-card') });
  const set = useMutation({
    mutationFn: (enabled: boolean) => api('/me/id-card', { method: 'PUT', body: { enabled } }),
    onSuccess: (_r, enabled) => { qc.invalidateQueries({ queryKey: ['my-id-card'] }); toast(enabled ? 'ID card boarding is on' : 'ID card boarding is off. Board with the app QR.'); },
  });
  if (!q.data) return null;
  const chips = q.data.linked.filter((l) => l.kind === 'chip');
  return (
    <div className="card grid gap-2">
      <div className="flex items-center gap-2"><b className="flex-1">Board with your university ID card</b>{q.data.enabled ? <Pill tone="ok">On</Pill> : <Pill tone="none">Off</Pill>}</div>
      <p className="muted m-0 text-xs">The supervisor scans your ID card's barcode{chips.length ? ' or taps its chip' : ''}, or your QR above. If your card is not recognised the first time, show your QR and the supervisor links the card.</p>
      {q.data.linked.length > 0 && <p className="muted m-0 text-xs">Linked: {q.data.linked.map((l) => `${l.kind === 'chip' ? 'chip' : 'card number'}${l.status === 'blocked' ? ' (blocked)' : ''}`).join(', ')}.</p>}
      {q.data.enabled
        ? <button className="btn btn-danger" disabled={set.isPending} onClick={() => set.mutate(false)}>My ID card is lost: switch off</button>
        : <button className="btn" disabled={set.isPending} onClick={() => set.mutate(true)}>I have my ID card again: switch on</button>}
      {!q.data.enabled && chips.length > 0 && <p className="muted m-0 text-xs">A lost card's chip stays blocked. A new card's chip is linked at the bus door.</p>}
      {set.error ? <ErrorNote error={set.error} /> : null}
    </div>
  );
}
