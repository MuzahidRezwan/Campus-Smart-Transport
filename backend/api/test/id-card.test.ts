import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dhakaDate, dhakaMinutes } from '@diu/shared';
import { allocationBuses, allocations, boardingEvents, idCards, users } from '../src/db/schema.js';
import { signAccessToken } from '../src/auth/tokens.js';
import { makeQrToken } from '../src/lib/qr.js';
import { bearer, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let supervisor = '';
let otherSupervisor = '';
let rider = '';
let card: { id: string; qrSecret: string };
// Distinct trips for the one-boarding-per-trip rule (the bus decides the route; the slot only names the trip).
const slots = () => Object.entries(env.seeded.slotIds).filter(([k]) => k.includes('|student|')).map(([, v]) => v);

/** Publishes a trip for `busCode` on `routeCode` that is running right now. */
async function tripNow(routeCode: string, busCode: string) {
  const slotKey = Object.keys(env.seeded.slotIds).find((k) => k.startsWith(`${routeCode}|student|`))!;
  const now = new Date();
  const [alloc] = await env.ctx.db.insert(allocations)
    .values({ serviceDate: dhakaDate(now), timeSlotId: env.seeded.slotIds[slotKey]!, status: 'published', publishedAt: now }).returning({ id: allocations.id });
  const m = dhakaMinutes(now);
  await env.ctx.db.insert(allocationBuses).values({ allocationId: alloc!.id, busId: env.seeded.busIds[busCode]!, serviceDate: dhakaDate(now), windowStart: m - 10, windowEnd: m + 60 });
}

/** Scan with an explicit trip, so one test can board several trips of the day. */
const scanId = (code: string, opts: { kind?: 'barcode' | 'chip'; slot?: number; bus?: string; as?: string } = {}) =>
  request(env.app).post('/boarding/scan-id').set(bearer(opts.as ?? supervisor))
    .send({ code, kind: opts.kind ?? 'barcode', busId: env.seeded.busIds[opts.bus ?? 'H-12'], timeSlotId: slots()[opts.slot ?? 0], scannedAt: new Date().toISOString() }).expect(200);
const scanQr = (slot: number, as = supervisor) => {
  const now = new Date();
  return request(env.app).post('/boarding/scan').set(bearer(as))
    .send({ qrToken: makeQrToken(card.qrSecret, 'c', card.id, now), busId: env.seeded.busIds['H-12'], timeSlotId: slots()[slot], scannedAt: now.toISOString() }).expect(200);
};
const link = (boardingId: string, code: string, kind: 'barcode' | 'chip', as = supervisor) =>
  request(env.app).post('/boarding/link-card').set(bearer(as)).send({ boardingId, code, kind });

beforeAll(async () => {
  env = await setup();
  rider = (await riderLogin(env, '232-35-798')).accessToken; // Uttara (R-02) in the demo; the directory gives a registration number
  const started = await request(env.app).post('/me/card').set(bearer(rider)).send({ routeId: env.seeded.routeIds['R-02'] }).expect(201);
  await request(env.app).post('/payments/sslcommerz/ipn').type('form').send({ tran_id: started.body.tranId, status: 'VALID', val_id: `mock-${started.body.tranId}-bKash` }).expect(200);
  card = (await request(env.app).get('/me/card').set(bearer(rider)).expect(200)).body.card;
  const sups = await env.ctx.db.insert(users).values([{ universityId: '710557', name: 'Supervisor A', role: 'supervisor' }, { universityId: '710558', name: 'Supervisor B', role: 'supervisor' }]).returning();
  supervisor = await signAccessToken(env.ctx, { sub: sups[0]!.id, role: 'supervisor', uid: '710557' });
  otherSupervisor = await signAccessToken(env.ctx, { sub: sups[1]!.id, role: 'supervisor', uid: '710558' });
  await tripNow('R-02', 'H-12');
  expect(slots().length).toBeGreaterThanOrEqual(10);
});
afterAll(async () => { await env?.close(); });

describe('boarding with the university ID card', () => {
  it('reads the ID in the barcode, with or without dashes', async () => {
    expect((await scanId('232-35-798', { slot: 0 })).body).toMatchObject({ valid: true, name: 'Muzahidul Islam' });
    expect((await scanId('23235798', { slot: 1 })).body).toMatchObject({ valid: true, name: 'Muzahidul Islam' });
  });

  it('allows one boarding per rider per trip, whatever they show', async () => {
    const again = (await scanId('232-35-798', { slot: 0 })).body;
    expect(again.valid).toBe(false);
    expect(again.reason).toMatch(/^Already boarded this trip at .+ on H-12$/);
    expect((await scanQr(0)).body.reason).toContain('Already boarded');
  });

  it('reads the registration number the directory linked at sign-in', async () => {
    expect((await scanId('DEMO-41-0798', { slot: 2 })).body).toMatchObject({ valid: true, name: 'Muzahidul Islam' });
    const rows = await env.ctx.db.select().from(idCards);
    expect(JSON.stringify(rows)).not.toContain('0798'); // only the HMAC is stored
  });

  it('links an unknown card number after a valid app-QR scan, then the card alone works', async () => {
    const unknown = (await scanId('RG-5501-77', { slot: 3 })).body;
    expect(unknown).toMatchObject({ valid: false });
    expect(unknown.reason).toContain('not recognised');
    const qr = (await scanQr(3)).body;
    expect(qr.valid).toBe(true);
    await link(qr.boardingId, 'RG-5501-77', 'barcode', otherSupervisor).expect(404); // only the supervisor who scanned
    const res = await link(qr.boardingId, 'RG-5501-77', 'barcode').expect(200);
    expect(res.body).toMatchObject({ linked: true, name: 'Muzahidul Islam' });
    const byBarcode = await env.ctx.db.select().from(boardingEvents).where(eq(boardingEvents.method, 'barcode'));
    expect(byBarcode.length).toBeGreaterThan(0);
  });

  it('links a chip through a reader the same way', async () => {
    const before = (await scanId('0004567890', { kind: 'chip', slot: 4 })).body;
    expect(before.reason).toContain('chip is not linked');
    const qr = (await scanQr(4)).body;
    await link(qr.boardingId, '0004567890', 'chip').expect(200);
    const after = (await scanId('0004567890', { kind: 'chip', slot: 5 })).body;
    expect(after).toMatchObject({ valid: true, name: 'Muzahidul Islam' });
    const [ev] = await env.ctx.db.select().from(boardingEvents).where(eq(boardingEvents.timeSlotId, slots()[5]!));
    expect(ev!.method).toBe('nfc');
  });

  it('refuses to link a card that already belongs to someone else', async () => {
    const other = (await riderLogin(env, '232-35-797')).accessToken;
    const started = await request(env.app).post('/me/card').set(bearer(other)).send({ routeId: env.seeded.routeIds['R-02'] }).expect(201);
    await request(env.app).post('/payments/sslcommerz/ipn').type('form').send({ tran_id: started.body.tranId, status: 'VALID', val_id: `mock-${started.body.tranId}-bKash` }).expect(200);
    const theirs = (await scanId('232-35-797', { slot: 6 })).body;
    expect(theirs.valid).toBe(true);
    await link(theirs.boardingId, '0004567890', 'chip').expect(409);
    await link(theirs.boardingId, '232-35-798', 'barcode').expect(409);
  });

  it('lets the rider switch ID card boarding off when the card is lost, and on again', async () => {
    await request(env.app).put('/me/id-card').set(bearer(rider)).send({ enabled: false }).expect(200);
    const off = (await scanId('232-35-798', { slot: 7 })).body;
    expect(off.valid).toBe(false);
    expect(off.reason).toContain('switched off');
    const mine = await request(env.app).get('/me/id-card').set(bearer(rider)).expect(200);
    expect(mine.body.enabled).toBe(false);
    expect(mine.body.linked.every((l: { status: string }) => l.status === 'blocked')).toBe(true);
    expect(JSON.stringify(mine.body)).not.toContain('valueHash');

    await request(env.app).put('/me/id-card').set(bearer(rider)).send({ enabled: true }).expect(200);
    expect((await scanId('RG550177', { slot: 7 })).body.valid).toBe(true); // barcode links come back
    const chip = (await scanId('0004567890', { kind: 'chip', slot: 8 })).body; // the lost card's chip stays blocked
    expect(chip.reason).toContain('reported lost');
  });

  it('refuses a number that matches two different riders instead of guessing', async () => {
    await env.ctx.db.insert(users).values({ universityId: '23235798', name: 'Staff With Same Digits', role: 'staff', category: 'admin_staff' });
    const res = (await scanId('232-35-798', { slot: 9 })).body;
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('more than one rider');
  });
});
