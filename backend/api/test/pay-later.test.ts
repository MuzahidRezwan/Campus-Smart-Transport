import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dhakaDate } from '@diu/shared';
import { deviceTokens, semesters, transportCards, users } from '../src/db/schema.js';
import { signAccessToken } from '../src/auth/tokens.js';
import { makeQrToken } from '../src/lib/qr.js';
import { expiryTask, payByReminderTask } from '../src/jobs/tasks.js';
import { adminLogin, bearer, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let rider: string;
let supervisor: string;
const today = () => dhakaDate();
const ID = '232-35-798';
const cardRow = async () => {
  const [u] = await env.ctx.db.select({ id: users.id }).from(users).where(eq(users.universityId, ID));
  const [c] = await env.ctx.db.select().from(transportCards).where(eq(transportCards.userId, u!.id));
  return c!;
};
const grant = (body: Record<string, unknown>) => request(env.app).post(`/admin/access/${ID}/grant`).set(bearer(admin)).send({ routeId: env.seeded.routeIds['R-02'], reason: 'Will pay after the scholarship arrives', ...body });

beforeAll(async () => {
  env = await setup();
  admin = await adminLogin(env);
  rider = (await riderLogin(env, ID)).accessToken;
  const [sup] = await env.ctx.db.insert(users).values({ universityId: '710556', name: 'Bus Supervisor', role: 'supervisor' }).returning();
  supervisor = await signAccessToken(env.ctx, { sub: sup!.id, role: 'supervisor', uid: '710556' });
  await env.ctx.db.insert(deviceTokens).values({ userId: (await env.ctx.db.select({ id: users.id }).from(users).where(eq(users.universityId, ID)))[0]!.id, token: 'pay-later-test-device-token', platform: 'android' });
});
afterAll(async () => { await env?.close(); });

describe('pay-later access', () => {
  it('refuses a pay-by date in the past or after the semester', async () => {
    await grant({ payBy: addDays(today(), -1) }).expect(400);
    const [sem] = await env.ctx.db.select().from(semesters).where(eq(semesters.isCurrent, true));
    await grant({ payBy: addDays(sem!.endsOn, 1) }).expect(400);
  });

  it('gives access until the pay-by date, and the rider sees it', async () => {
    const payBy = addDays(today(), 3);
    const res = await grant({ payBy }).expect(200);
    expect(res.body).toMatchObject({ status: 'active', expiresOn: payBy, payBy });
    const me = await request(env.app).get('/me/card').set(bearer(rider)).expect(200);
    expect(me.body.card).toMatchObject({ status: 'active', payBy, expiresOn: payBy, source: 'authority_grant' });
    expect(me.body.card.qrSecret).toBeTruthy();
  });

  it('reminds the rider before the date', async () => {
    const before = env.push.sent.length;
    expect((await payByReminderTask(env.ctx)).sent).toBe(1); // 3 days before
    expect(env.push.sent.length).toBe(before + 1);
    expect(env.push.sent.at(-1)!.message.title).toContain('Pay your transport fee');
  });

  it('lets the office move the date; a normal active card cannot be granted again', async () => {
    const later = addDays(today(), 5);
    const res = await request(env.app).patch(`/admin/access/${ID}/pay-by`).set(bearer(admin)).send({ payBy: later, reason: 'Scholarship delayed a few days' }).expect(200);
    expect(res.body).toMatchObject({ status: 'active', payBy: later, expiresOn: later });
    // Granting again on pay-later access is allowed (changes the terms).
    await grant({ payBy: addDays(today(), 4) }).expect(200);
  });

  it('stops access the day after an unpaid date; boarding says why; the office can bring it back', async () => {
    const card = await cardRow();
    const yesterday = addDays(today(), -1);
    await env.ctx.db.update(transportCards).set({ payBy: yesterday, expiresOn: yesterday }).where(eq(transportCards.id, card.id));
    const result = await expiryTask(env.ctx);
    expect(result.unpaidPayLater).toBe(1);
    expect((await cardRow()).status).toBe('expired');
    expect(env.push.sent.at(-1)!.message.title).toBe('Your transport access has ended');

    const me = (await request(env.app).get('/me/card').set(bearer(rider)).expect(200)).body.card;
    expect(me).toMatchObject({ status: 'expired', payBy: yesterday, qrSecret: null });
    const sched = await request(env.app).get('/me/schedule').set(bearer(rider)).expect(200);
    expect(sched.body.canSeeBuses).toBe(false);

    const now = new Date();
    const qr = makeQrToken((await import('../src/lib/crypto.js')).decrypt(env.ctx.config.dataKey, (await cardRow()).qrSecretEnc!), 'c', card.id, now);
    const scan = await request(env.app).post('/boarding/scan').set(bearer(supervisor)).send({ qrToken: qr, busId: env.seeded.busIds['H-12'], scannedAt: now.toISOString() }).expect(200);
    expect(scan.body).toMatchObject({ valid: false });
    expect(scan.body.reason).toContain('Payment due date passed');

    const back = await request(env.app).patch(`/admin/access/${ID}/pay-by`).set(bearer(admin)).send({ payBy: addDays(today(), 2), reason: 'Paid in cash at the office, receipt 2231' }).expect(200);
    expect(back.body.status).toBe('active');
  });

  it('paying keeps access during checkout and turns it into a normal card to semester end', async () => {
    const pay = await request(env.app).post('/me/card').set(bearer(rider)).send({ routeId: env.seeded.routeIds['R-05'] }).expect(201);
    expect((await cardRow()).status).toBe('active'); // still riding while paying
    expect((await cardRow()).routeId).toBe(env.seeded.routeIds['R-02']); // pays for the route the office gave
    await request(env.app).post('/payments/sslcommerz/ipn').type('form').send({ tran_id: pay.body.tranId, status: 'VALID', val_id: `mock-${pay.body.tranId}-bKash` }).expect(200);
    const [sem] = await env.ctx.db.select().from(semesters).where(eq(semesters.isCurrent, true));
    expect(await cardRow()).toMatchObject({ status: 'active', payBy: null, expiresOn: sem!.endsOn, source: 'payment' });
    await request(env.app).patch(`/admin/access/${ID}/pay-by`).set(bearer(admin)).send({ payBy: null, reason: 'nothing to change' }).expect(409);
    await grant({}).expect(409);
  });

  it('a free-access request can be approved until a pay-by date', async () => {
    const asker = (await riderLogin(env, '233-15-020')).accessToken;
    const req = await request(env.app).post('/me/card/free-request').set(bearer(asker)).send({ routeId: env.seeded.routeIds['R-03'], note: 'Can I pay after my tuition instalment next week?' }).expect(201);
    const payBy = addDays(today(), 6);
    const res = await request(env.app).post(`/admin/cards/${req.body.id}/decision`).set(bearer(admin)).send({ decision: 'approve', reason: 'Pays after the tuition instalment', payBy }).expect(200);
    expect(res.body).toMatchObject({ status: 'active', payBy, expiresOn: payBy, source: 'manual_approval' });
  });

  it('pay-by null turns pay-later access into full free access', async () => {
    const other = '221-15-443';
    await request(env.app).post(`/admin/access/${other}/grant`).set(bearer(admin)).send({ routeId: env.seeded.routeIds['R-01'], reason: 'Will pay next week', payBy: addDays(today(), 7) }).expect(200);
    const res = await request(env.app).patch(`/admin/access/${other}/pay-by`).set(bearer(admin)).send({ payBy: null, reason: 'Fee waived by the Registrar' }).expect(200);
    const [sem] = await env.ctx.db.select().from(semesters).where(eq(semesters.isCurrent, true));
    expect(res.body).toMatchObject({ status: 'active', payBy: null, expiresOn: sem!.endsOn });
    const [u] = await env.ctx.db.select({ id: users.id }).from(users).where(eq(users.universityId, other));
    const [c] = await env.ctx.db.select().from(transportCards).where(and(eq(transportCards.userId, u!.id), eq(transportCards.semesterId, sem!.id)));
    expect(c!.payBy).toBeNull();
  });
});
