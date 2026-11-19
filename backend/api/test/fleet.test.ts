import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operatorColor } from '@diu/shared';
import { adminLogin, bearer, nextServiceDate, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
const date = nextServiceDate(2);
beforeAll(async () => {
  env = await setup();
  admin = await adminLogin(env);
});
afterAll(async () => { await env?.close(); });

const slot = (k: string) => env.seeded.slotIds[k]!;
const company = async (code: string) => {
  const list = (await request(env.app).get('/admin/fleet/operators').set(bearer(admin)).expect(200)).body as { id: string; code: string; name: string; isActive: boolean; displayColor: string; buses: number }[];
  return list.find((o) => o.code === code)!;
};

describe('bus companies are data, not code', () => {
  it('lists the seeded companies with their colours and bus counts', async () => {
    const h = await company('H');
    expect(h).toMatchObject({ name: 'Hanif', isActive: true, displayColor: '#4f46e5' });
    expect(h.buses).toBeGreaterThan(0);
  });

  it('adds a new company with its buses, and riders see its name and colour', async () => {
    const op = await request(env.app).post('/admin/fleet/operators').set(bearer(admin)).send({ code: 'G', name: 'Green Line', contactPhone: '01711000000' }).expect(201);
    const created = await request(env.app).post('/admin/fleet/buses').set(bearer(admin)).send({ code: 'G-01', operatorId: op.body.id, seatCapacity: 44 }).expect(201);
    const buses = (await request(env.app).get('/admin/fleet/buses').set(bearer(admin)).expect(200)).body as { code: string; operatorName: string; operatorColor: string }[];
    expect(buses.find((b) => b.code === 'G-01')).toMatchObject({ operatorName: 'Green Line', operatorColor: operatorColor({ code: 'G' }) });

    await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: date, timeSlotId: slot('R-01|student|to_campus|07:00'), busIds: [created.body.id], status: 'published' }).expect(200);
    await request(env.app).post('/admin/access/232-35-797/grant').set(bearer(admin)).send({ routeId: env.seeded.routeIds['R-01'], reason: 'Card for the company test' }).expect(200);
    const rider = (await riderLogin(env, '232-35-797')).accessToken;
    const sched = await request(env.app).get('/me/schedule').set(bearer(rider)).query({ date }).expect(200);
    const trip = sched.body.slots.find((s: { timeSlotId: string }) => s.timeSlotId === slot('R-01|student|to_campus|07:00'));
    expect(trip.buses).toEqual([expect.objectContaining({ code: 'G-01', operatorName: 'Green Line', operatorCode: 'G' })]);
  });

  it('renames a company and changes its code and colour; a taken code is refused', async () => {
    const g = await company('G');
    await request(env.app).patch(`/admin/fleet/operators/${g.id}`).set(bearer(admin)).send({ code: 'H' }).expect(409);
    const res = await request(env.app).patch(`/admin/fleet/operators/${g.id}`).set(bearer(admin)).send({ name: 'Green Line Paribahan', code: 'GL', color: '#be185d' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Green Line Paribahan', code: 'GL', color: '#be185d' });
    await request(env.app).patch(`/admin/fleet/operators/${g.id}`).set(bearer(admin)).send({ color: 'red' }).expect(400);
  });

  it('a retired company\'s buses cannot be allocated, and come back with the company', async () => {
    const s = await company('S');
    await request(env.app).patch(`/admin/fleet/operators/${s.id}`).set(bearer(admin)).send({ isActive: false }).expect(200);
    const opts = await request(env.app).get('/admin/allocations/options').set(bearer(admin)).query({ date, timeSlotId: slot('R-02|student|to_campus|07:00') }).expect(200);
    expect(opts.body.buses.some((b: { code: string }) => b.code.startsWith('S-'))).toBe(false);
    const res = await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: date, timeSlotId: slot('R-02|student|to_campus|07:00'), busIds: [env.seeded.busIds['S-01']], status: 'draft' }).expect(422);
    expect(res.body.error.message).toContain('retired company');
    await request(env.app).post('/admin/fleet/buses').set(bearer(admin)).send({ code: 'S-99', operatorId: s.id, seatCapacity: 30 }).expect(409);

    await request(env.app).patch(`/admin/fleet/operators/${s.id}`).set(bearer(admin)).send({ isActive: true }).expect(200);
    await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: date, timeSlotId: slot('R-02|student|to_campus|07:00'), busIds: [env.seeded.busIds['S-01']], status: 'draft' }).expect(200);
  });

  it('deletes only a company that never had buses', async () => {
    const h = await company('H');
    const res = await request(env.app).delete(`/admin/fleet/operators/${h.id}`).set(bearer(admin)).expect(409);
    expect(res.body.error.message).toContain('Retire');
    const tmp = await request(env.app).post('/admin/fleet/operators').set(bearer(admin)).send({ code: 'TMP', name: 'Typo company' }).expect(201);
    await request(env.app).delete(`/admin/fleet/operators/${tmp.body.id}`).set(bearer(admin)).expect(200);
    expect(await company('TMP')).toBeUndefined();
  });

  it('only fleet.manage can change companies', async () => {
    const rider = (await riderLogin(env, '232-35-798')).accessToken;
    await request(env.app).post('/admin/fleet/operators').set(bearer(rider)).send({ code: 'X', name: 'Nope' }).expect(403);
  });
});
