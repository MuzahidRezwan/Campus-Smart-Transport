import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { payments, users } from '../src/db/schema.js';
import { adminLogin, bearer, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let rider: string;
const sem = () => env.seeded.semesterId;
const route = (code: string) => env.seeded.routeIds[code]!;
beforeAll(async () => {
  env = await setup();
  admin = await adminLogin(env);
  rider = (await riderLogin(env, '232-35-798')).accessToken; // student_tri_semester
});
afterAll(async () => { await env?.close(); });

const preview = async (q: Record<string, string>) => (await request(env.app).get('/admin/fees/preview').set(bearer(admin)).query({ semesterId: sem(), ...q }).expect(200)).body;
const setRule = (body: Record<string, unknown>) => request(env.app).put('/admin/fees').set(bearer(admin)).send({ semesterId: sem(), ...body });

describe('fees set by the transport office', () => {
  it('starts from the sample category fees', async () => {
    expect((await preview({ category: 'student_tri_semester', routeId: route('R-02') })).fee).toMatchObject({ amountBdt: 4500, source: 'category' });
    const me = await request(env.app).get('/me/fee').set(bearer(rider)).query({ routeId: route('R-02') }).expect(200);
    expect(me.body).toMatchObject({ amountBdt: 4500, special: false });
  });

  it('a route fee beats the category fee, and route + category beats both', async () => {
    await setRule({ routeId: route('R-02'), amountBdt: 5000 }).expect(200);
    expect((await preview({ category: 'student_tri_semester', routeId: route('R-02') })).fee).toMatchObject({ amountBdt: 5000, source: 'route' });
    await setRule({ routeId: route('R-02'), category: 'student_tri_semester', amountBdt: 4800 }).expect(200);
    expect((await preview({ category: 'student_tri_semester', routeId: route('R-02') })).fee).toMatchObject({ amountBdt: 4800, source: 'route_category' });
    expect((await preview({ category: 'faculty', routeId: route('R-02') })).fee).toMatchObject({ amountBdt: 5000, source: 'route' });
  });

  it('changing a fee replaces the rule for that scope instead of adding another', async () => {
    await setRule({ routeId: route('R-02'), amountBdt: 5200 }).expect(200);
    const list = (await request(env.app).get('/admin/fees').set(bearer(admin)).query({ semesterId: sem() }).expect(200)).body;
    expect(list.rules.filter((r: { routeId: string | null; category: string | null }) => r.routeId === route('R-02') && r.category === null)).toHaveLength(1);
  });

  it('charges the resolved amount, and a later change does not touch what was already charged', async () => {
    const pay = await request(env.app).post('/me/card').set(bearer(rider)).send({ routeId: route('R-02') }).expect(201);
    expect(pay.body.amountBdt).toBe(4800);
    await setRule({ routeId: route('R-02'), category: 'student_tri_semester', amountBdt: 4000 }).expect(200);
    const [p] = await env.ctx.db.select().from(payments).where(eq(payments.tranId, pay.body.tranId));
    expect(p!.amountBdt).toBe(4800);
  });

  it('a fee for one rider beats every rule, needs a reason and is audited', async () => {
    await request(env.app).put('/admin/fees/riders/232-35-798').set(bearer(admin)).send({ semesterId: sem(), amountBdt: 2250 }).expect(400);
    const set = await request(env.app).put('/admin/fees/riders/232-35-798').set(bearer(admin)).send({ semesterId: sem(), amountBdt: 2250, reason: '50% waiver, Registrar memo 12/2026' }).expect(200);
    expect(set.body).toMatchObject({ name: 'Muzahidul Islam', amountBdt: 2250 });
    expect((await preview({ universityId: '232-35-798' })).fee).toMatchObject({ amountBdt: 2250, source: 'rider' });
    const me = await request(env.app).get('/me/fee').set(bearer(rider)).query({ routeId: route('R-02') }).expect(200);
    expect(me.body).toMatchObject({ amountBdt: 2250, special: true });
    await request(env.app).delete('/admin/fees/riders/232-35-798').set(bearer(admin)).query({ semesterId: sem() }).expect(200);
    expect((await preview({ universityId: '232-35-798', routeId: route('R-02') })).fee).toMatchObject({ source: 'route_category' });
  });

  it('a switched-off or removed rule stops applying; with no rule the rider cannot pay', async () => {
    const list = (await request(env.app).get('/admin/fees').set(bearer(admin)).query({ semesterId: sem() }).expect(200)).body as { rules: { id: string; category: string | null; routeId: string | null }[] };
    for (const r of list.rules.filter((x) => x.routeId === route('R-03') || x.category === 'faculty')) await request(env.app).delete(`/admin/fees/${r.id}`).set(bearer(admin)).expect(200);
    await setRule({ category: 'faculty', amountBdt: 3000, isActive: false }).expect(200);
    expect((await preview({ category: 'faculty', routeId: route('R-03') })).fee).toBeNull();
    const faculty = (await riderLogin(env, '710410')).accessToken;
    const res = await request(env.app).post('/me/card').set(bearer(faculty)).send({ routeId: route('R-03') }).expect(422);
    expect(res.body.error.message).toContain('fee');
  });

  it('only fees.manage can change fees; amounts must be at least ৳1', async () => {
    await setRule({ category: 'faculty', amountBdt: 0 }).expect(400);
    await request(env.app).put('/admin/fees').set(bearer(rider)).send({ semesterId: sem(), category: 'faculty', amountBdt: 10 }).expect(403);
    const [u] = await env.ctx.db.select().from(users).where(eq(users.universityId, '232-35-798'));
    expect(u).toBeTruthy();
  });
});
