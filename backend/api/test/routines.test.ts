import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIU_DEPARTMENTS } from '@diu/shared';
import { routineVersions } from '../src/db/schema.js';
import type { ParsedRoutine } from '../src/modules/predictions/ml-client.js';
import { adminLogin, bearer, fakeMl, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
/** What the fake ML service answers per URL. */
const answers = new Map<string, ParsedRoutine | Error>();
const session = (batch: string) => ({ department: 'Software Engineering', batch, section: 'G', teacherInitial: 'RI', weekday: 0, startMinutes: 510, endMinutes: 600 });

beforeAll(async () => {
  env = await setup({
    ml: {
      ...fakeMl,
      async fetchRoutine(url, department) {
        const a = answers.get(url);
        if (a instanceof Error) throw a;
        return a ?? { contentHash: 'empty', department, sessions: [], warnings: ['No classes found.'], foundUrl: url };
      },
    },
  });
  admin = await adminLogin(env);
});
afterAll(async () => { await env?.close(); });

type Source = { id: string; department: string; url: string; isActive: boolean; lastStatus: string | null; lastError: string | null; lastFoundUrl: string | null };
const sources = async () => (await request(env.app).get('/admin/routines/sources').set(bearer(admin)).expect(200)).body as Source[];
const swe = async () => (await sources()).find((s) => s.department === 'Software Engineering')!;

describe('routine sources for every department', () => {
  it('comes with every DIU department\'s notice page', async () => {
    const list = await sources();
    expect(list).toHaveLength(DIU_DEPARTMENTS.length);
    expect((await swe()).url).toBe('https://webbackend.daffodilvarsity.edu.bd/department/swe/notice');
    const again = await request(env.app).post('/admin/routines/sources/diu-departments').set(bearer(admin)).expect(200);
    expect(again.body.added).toBe(0);
  });

  it('checks a source now: a new routine waits for review, and the file used is shown', async () => {
    const s = await swe();
    answers.set(s.url, { contentHash: 'v1', department: s.department, sessions: [session('41')], warnings: [], foundUrl: 'https://daffodilvarsity.edu.bd/download-file/4100' });
    const res = await request(env.app).post(`/admin/routines/sources/${s.id}/check`).set(bearer(admin)).expect(200);
    expect(res.body).toMatchObject({ status: 'new_version', foundUrl: 'https://daffodilvarsity.edu.bd/download-file/4100' });
    const versions = await env.ctx.db.select().from(routineVersions).where(eq(routineVersions.sourceId, s.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ status: 'pending_review', sessionCount: 1, fileName: 'https://daffodilvarsity.edu.bd/download-file/4100' });
    expect((await swe()).lastStatus).toBe('new_version');
    const same = await request(env.app).post(`/admin/routines/sources/${s.id}/check`).set(bearer(admin)).expect(200);
    expect(same.body.status).toBe('unchanged');
  });

  it('records a page with no classes and a failed download without storing a routine', async () => {
    const all = await sources();
    const cse = all.find((x) => x.department === 'Computer Science and Engineering')!;
    const eee = all.find((x) => x.department === 'Electrical and Electronic Engineering')!;
    answers.set(eee.url, new Error('ML service /v1/routines/fetch failed: 422 {"detail":"Download failed with HTTP 404"}'));
    expect((await request(env.app).post(`/admin/routines/sources/${cse.id}/check`).set(bearer(admin)).expect(200)).body).toMatchObject({ status: 'no_classes' });
    const bad = await request(env.app).post(`/admin/routines/sources/${eee.id}/check`).set(bearer(admin)).expect(200);
    expect(bad.body.status).toBe('error');
    expect(bad.body.error).toContain('HTTP 404');
    expect(await env.ctx.db.select().from(routineVersions).where(eq(routineVersions.sourceId, cse.id))).toHaveLength(0);
  });

  it('edits a link (starting its status fresh), switches sources off, and checks all switched-on ones', async () => {
    const s = await swe();
    const edited = await request(env.app).patch(`/admin/routines/sources/${s.id}`).set(bearer(admin))
      .send({ url: 'https://daffodilvarsity.edu.bd/download-file/4200' }).expect(200);
    expect(edited.body).toMatchObject({ lastStatus: null, lastFoundUrl: null });
    await request(env.app).patch(`/admin/routines/sources/${s.id}`).set(bearer(admin)).send({ url: 'http://insecure.example/x' }).expect(400);
    for (const x of (await sources()).filter((x) => x.department !== 'Software Engineering')) {
      await request(env.app).patch(`/admin/routines/sources/${x.id}`).set(bearer(admin)).send({ isActive: false }).expect(200);
    }
    const all = await request(env.app).post('/admin/routines/sources/check-all').set(bearer(admin)).expect(200);
    expect(all.body).toHaveLength(1);
    expect(all.body[0].department).toBe('Software Engineering');
  });

  it('adds and deletes a source; routines read from it stay', async () => {
    const added = await request(env.app).post('/admin/routines/sources').set(bearer(admin))
      .send({ department: 'Software Engineering (MSc)', url: 'https://drive.google.com/file/d/abc/view' }).expect(201);
    expect(added.body.kind).toBe('html');
    const s = await swe();
    await request(env.app).delete(`/admin/routines/sources/${s.id}`).set(bearer(admin)).expect(200);
    const kept = await env.ctx.db.select().from(routineVersions).where(eq(routineVersions.department, 'Software Engineering'));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0]!.sourceId).toBeNull();
  });
});
