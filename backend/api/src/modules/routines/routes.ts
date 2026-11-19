/**
 * Class routines. A new routine (uploaded, or found by the daily scraper)
 * waits as "pending_review" until someone checks it, because one wrong routine
 * silently breaks every prediction.
 */
import { Router } from 'express';
import multer from 'multer';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { addDiuDepartmentSources } from './diu-sources.js';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { classSessions, routineSources, routineVersions } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound, parse, unprocessable } from '../../lib/errors.js';
import { actorId } from '../common.js';
import type { ParsedRoutine } from '../predictions/ml-client.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(pdf|xlsx|csv|docx|html?)$/i.test(file.originalname)),
});

export async function storeParsedRoutine(ctx: AppContext, parsed: ParsedRoutine, meta: { sourceId?: string; fileName?: string; uploadedBy?: string }) {
  const db = ctx.adminDb;
  const [dup] = await db.select({ id: routineVersions.id }).from(routineVersions).where(and(eq(routineVersions.contentHash, parsed.contentHash), eq(routineVersions.department, parsed.department)));
  if (dup) return { id: dup.id, duplicate: true };
  const version = await db.transaction(async (tx) => {
    const [v] = await tx.insert(routineVersions).values({
      sourceId: meta.sourceId ?? null, department: parsed.department, fileName: meta.fileName ?? null, contentHash: parsed.contentHash,
      sessionCount: parsed.sessions.length, warnings: parsed.warnings, uploadedBy: meta.uploadedBy ?? null,
    }).returning({ id: routineVersions.id });
    if (parsed.sessions.length) {
      await tx.insert(classSessions).values(parsed.sessions.map((s) => ({ routineVersionId: v!.id, department: s.department, batch: s.batch, section: s.section, teacherInitial: s.teacherInitial, weekday: s.weekday, startMinutes: s.startMinutes, endMinutes: s.endMinutes, courseCode: s.courseCode ?? null, room: s.room ?? null })));
    }
    return v!;
  });
  return { id: version.id, duplicate: false };
}

type Source = typeof routineSources.$inferSelect;

/**
 * Checks one source: fetches it (following the department page to its newest
 * class routine), and stores a changed routine for review. Records the outcome
 * on the source so the dashboard can show it.
 */
export async function checkRoutineSource(ctx: AppContext, s: Source) {
  const db = ctx.adminDb;
  const done = async (status: 'new_version' | 'unchanged' | 'no_classes' | 'error', extra: { lastHash?: string; lastError?: string | null; lastFoundUrl?: string | null } = {}) => {
    await db.update(routineSources).set({ lastCheckedAt: new Date(), lastStatus: status, lastError: extra.lastError ?? null, ...(extra.lastHash ? { lastHash: extra.lastHash } : {}), ...(extra.lastFoundUrl !== undefined ? { lastFoundUrl: extra.lastFoundUrl } : {}) })
      .where(eq(routineSources.id, s.id));
    return { id: s.id, department: s.department, status, error: extra.lastError ?? null, foundUrl: extra.lastFoundUrl ?? null };
  };
  try {
    const parsed = await ctx.ml.fetchRoutine(s.url, s.department);
    const foundUrl = parsed.foundUrl ?? null;
    if (!parsed.sessions.length) return done('no_classes', { lastFoundUrl: foundUrl, lastError: parsed.warnings[0] ?? 'No classes found in the routine' });
    if (parsed.contentHash === s.lastHash) return done('unchanged', { lastFoundUrl: foundUrl });
    const stored = await storeParsedRoutine(ctx, parsed, { sourceId: s.id, fileName: foundUrl ?? s.url });
    if (!stored.duplicate) await audit(db, { actorId: null, action: 'routines.uploaded', entity: 'routine_version', entityId: stored.id, after: { department: s.department, sessions: parsed.sessions.length, from: foundUrl ?? s.url } });
    return done(stored.duplicate ? 'unchanged' : 'new_version', { lastHash: parsed.contentHash, lastFoundUrl: foundUrl });
  } catch (err) {
    return done('error', { lastError: (err as Error).message.replace(/^ML service \/v1\/routines\/fetch failed: /, '').slice(0, 300) });
  }
}

/** Daily job (and "Check all now"): check every switched-on source, store anything new for review. */
export async function syncRoutineSources(ctx: AppContext) {
  const sources = await ctx.adminDb.select().from(routineSources).where(eq(routineSources.isActive, true));
  const results = [];
  for (const s of sources) results.push(await checkRoutineSource(ctx, s));
  return results;
}

export function routinesRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/routines', requirePermission('routines.manage'), async (_req, res) => {
    res.json(await db.select().from(routineVersions).orderBy(desc(routineVersions.createdAt)).limit(100));
  });

  r.get('/routines/:id/sessions', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    res.json(await db.select().from(classSessions).where(eq(classSessions.routineVersionId, id)));
  });

  r.post('/routines/upload', requirePermission('routines.manage'), upload.single('file'), async (req, res) => {
    const department = parse(z.string().trim().min(2).max(80), req.body?.department);
    if (!req.file) throw badRequest('Attach a routine file (PDF, Word, XLSX, CSV or HTML, up to 5 MB)');
    const parsed = await ctx.ml.parseRoutine({ name: req.file.originalname, bytes: req.file.buffer }, department);
    if (!parsed.sessions.length) throw unprocessable('No classes were found in this file. Use the CSV template in docs/routine-template.csv.', parsed.warnings);
    const stored = await storeParsedRoutine(ctx, parsed, { fileName: req.file.originalname, uploadedBy: actorId(req) });
    await audit(db, { actorId: actorId(req), action: 'routines.uploaded', entity: 'routine_version', entityId: stored.id, after: { department, sessions: parsed.sessions.length, warnings: parsed.warnings.length }, req });
    res.status(stored.duplicate ? 200 : 201).json({ id: stored.id, duplicate: stored.duplicate, sessions: parsed.sessions.length, warnings: parsed.warnings });
  });

  r.post('/routines/:id/activate', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [v] = await db.select().from(routineVersions).where(eq(routineVersions.id, id));
    if (!v) throw notFound('Routine');
    await db.transaction(async (tx) => {
      await tx.update(routineVersions).set({ status: 'superseded' }).where(and(eq(routineVersions.department, v.department), eq(routineVersions.status, 'active'), ne(routineVersions.id, id)));
      await tx.update(routineVersions).set({ status: 'active', reviewedBy: actorId(req), activatedAt: new Date() }).where(eq(routineVersions.id, id));
    });
    await audit(db, { actorId: actorId(req), action: 'routines.activated', entity: 'routine_version', entityId: id, after: { department: v.department }, req });
    res.json({ ok: true, note: 'Re-run the forecast to use this routine.' });
  });

  r.post('/routines/:id/reject', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [v] = await db.update(routineVersions).set({ status: 'rejected', reviewedBy: actorId(req) }).where(eq(routineVersions.id, id)).returning();
    if (!v) throw notFound('Routine');
    await audit(db, { actorId: actorId(req), action: 'routines.rejected', entity: 'routine_version', entityId: id, req });
    res.json({ ok: true });
  });

  r.get('/routines/sources', requirePermission('routines.manage'), async (_req, res) => {
    res.json(await db.select().from(routineSources).orderBy(asc(routineSources.department)));
  });

  const sourceSchema = z.object({
    department: z.string().trim().min(2).max(80),
    url: z.string().trim().url().startsWith('https://', 'Use an https:// link'),
    kind: z.enum(['html', 'pdf', 'xlsx', 'csv']).default('html'),
    isActive: z.boolean().default(true),
  });

  r.post('/routines/sources', requirePermission('routines.manage'), async (req, res) => {
    const body = parse(sourceSchema, req.body);
    const [row] = await db.insert(routineSources).values(body).returning();
    await audit(db, { actorId: actorId(req), action: 'routines.source_added', entity: 'routine_source', entityId: row!.id, after: row, req });
    res.status(201).json(row);
  });

  /** One click: every DIU department's notice page. */
  r.post('/routines/sources/diu-departments', requirePermission('routines.manage'), async (req, res) => {
    const added = await addDiuDepartmentSources(db);
    await audit(db, { actorId: actorId(req), action: 'routines.sources_added', entity: 'routine_source', entityId: null, after: { added }, req });
    res.json({ added });
  });

  r.patch('/routines/sources/:id', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(sourceSchema.partial().strict(), req.body);
    const [before] = await db.select().from(routineSources).where(eq(routineSources.id, id));
    if (!before) throw notFound('Routine source');
    // A new link starts fresh: the next check reports on it.
    const reset = body.url && body.url !== before.url ? { lastHash: null, lastStatus: null, lastError: null, lastFoundUrl: null } : {};
    const [after] = await db.update(routineSources).set({ ...body, ...reset }).where(eq(routineSources.id, id)).returning();
    await audit(db, { actorId: actorId(req), action: 'routines.source_updated', entity: 'routine_source', entityId: id, before, after, req });
    res.json(after);
  });

  r.delete('/routines/sources/:id', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [before] = await db.select().from(routineSources).where(eq(routineSources.id, id));
    if (!before) throw notFound('Routine source');
    await db.transaction(async (tx) => {
      // Routines already read from it stay; they just no longer point at the source.
      await tx.update(routineVersions).set({ sourceId: null }).where(eq(routineVersions.sourceId, id));
      await tx.delete(routineSources).where(eq(routineSources.id, id));
    });
    await audit(db, { actorId: actorId(req), action: 'routines.source_removed', entity: 'routine_source', entityId: id, before, req });
    res.json({ ok: true });
  });

  /** Check one source now (works even when it is switched off, to test a link). */
  r.post('/routines/sources/:id/check', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [source] = await db.select().from(routineSources).where(eq(routineSources.id, id));
    if (!source) throw notFound('Routine source');
    res.json(await checkRoutineSource(ctx, source));
  });

  /** Check every switched-on source now, instead of waiting for 05:00. */
  r.post('/routines/sources/check-all', requirePermission('routines.manage'), async (req, res) => {
    const results = await syncRoutineSources(ctx);
    await audit(db, { actorId: actorId(req), action: 'routines.checked_all', entity: 'routine_source', entityId: null, after: { checked: results.length, newVersions: results.filter((r) => r.status === 'new_version').length }, req });
    res.json(results);
  });

  return r;
}
