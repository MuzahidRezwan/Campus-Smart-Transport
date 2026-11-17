/**
 * Fees, set by the transport office: rules per category, per route, per route and
 * category, or for everyone, plus a fee for one rider. The most specific wins
 * (see resolveFee). Changes apply to new payments only; nothing already paid changes.
 */
import { Router } from 'express';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { FEE_SOURCE_LABELS, feePreviewSchema, feeRuleSchema, riderFeeSchema, universityId } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { feeRules, riderFees, routes, users } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound, parse } from '../../lib/errors.js';
import { actorId } from '../common.js';
import { ensureRiderIdentity } from '../cards/service.js';
import { feeFor } from './service.js';

export function feesRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  /** Rules and rider fees for a semester. */
  r.get('/fees', requirePermission('payments.view'), async (req, res) => {
    const q = parse(z.object({ semesterId: z.string().uuid() }), req.query);
    const rules = await db.select({
      id: feeRules.id, category: feeRules.category, routeId: feeRules.routeId, routeCode: routes.code, routeName: routes.name,
      amountBdt: feeRules.amountBdt, isActive: feeRules.isActive, updatedAt: feeRules.updatedAt,
    }).from(feeRules).leftJoin(routes, eq(routes.id, feeRules.routeId)).where(eq(feeRules.semesterId, q.semesterId)).orderBy(asc(routes.code), asc(feeRules.category));
    const riders = await db.select({
      id: riderFees.id, universityId: users.universityId, name: users.name, amountBdt: riderFees.amountBdt, reason: riderFees.reason, updatedAt: riderFees.updatedAt,
    }).from(riderFees).innerJoin(users, eq(users.id, riderFees.userId)).where(eq(riderFees.semesterId, q.semesterId)).orderBy(asc(users.universityId));
    res.json({ rules, riders });
  });

  /** Creates or replaces the rule for one scope (category and/or route, or everyone). */
  r.put('/fees', requirePermission('fees.manage'), async (req, res) => {
    const body = parse(feeRuleSchema, req.body);
    if (body.routeId) {
      const [route] = await db.select({ id: routes.id }).from(routes).where(eq(routes.id, body.routeId));
      if (!route) throw notFound('Route');
    }
    const scope = and(
      eq(feeRules.semesterId, body.semesterId),
      body.category ? eq(feeRules.category, body.category) : isNull(feeRules.category),
      body.routeId ? eq(feeRules.routeId, body.routeId) : isNull(feeRules.routeId),
    );
    const [before] = await db.select().from(feeRules).where(scope);
    const values = { amountBdt: body.amountBdt, isActive: body.isActive, updatedBy: actorId(req), updatedAt: new Date() };
    const [row] = before
      ? await db.update(feeRules).set(values).where(eq(feeRules.id, before.id)).returning()
      : await db.insert(feeRules).values({ semesterId: body.semesterId, category: body.category, routeId: body.routeId, ...values }).returning();
    await audit(db, { actorId: actorId(req), action: 'fees.set', entity: 'fee_rule', entityId: row!.id, before: before ?? null, after: row, req });
    res.json(row);
  });

  r.delete('/fees/:id', requirePermission('fees.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [before] = await db.delete(feeRules).where(eq(feeRules.id, id)).returning();
    if (!before) throw notFound('Fee rule');
    await audit(db, { actorId: actorId(req), action: 'fees.removed', entity: 'fee_rule', entityId: id, before, req });
    res.json({ ok: true });
  });

  /** A fee for one rider (full university ID only), e.g. a discount. */
  r.put('/fees/riders/:universityId', requirePermission('fees.manage'), async (req, res) => {
    const uid = parse(universityId, req.params.universityId);
    const body = parse(riderFeeSchema, req.body);
    const user = await ensureRiderIdentity(ctx, db, uid);
    const [before] = await db.select().from(riderFees).where(and(eq(riderFees.semesterId, body.semesterId), eq(riderFees.userId, user.id)));
    const values = { amountBdt: body.amountBdt, reason: body.reason, setBy: actorId(req), updatedAt: new Date() };
    const [row] = before
      ? await db.update(riderFees).set(values).where(eq(riderFees.id, before.id)).returning()
      : await db.insert(riderFees).values({ semesterId: body.semesterId, userId: user.id, ...values }).returning();
    await audit(db, { actorId: actorId(req), action: 'fees.rider_set', entity: 'rider_fee', entityId: row!.id, subjectUserId: user.id, before: before ?? null, after: row, reason: body.reason, req });
    res.json({ universityId: uid, name: user.name, amountBdt: row!.amountBdt, reason: row!.reason });
  });

  r.delete('/fees/riders/:universityId', requirePermission('fees.manage'), async (req, res) => {
    const uid = parse(universityId, req.params.universityId);
    const q = parse(z.object({ semesterId: z.string().uuid() }), req.query);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.universityId, uid));
    if (!user) throw notFound('Rider');
    const [before] = await db.delete(riderFees).where(and(eq(riderFees.semesterId, q.semesterId), eq(riderFees.userId, user.id))).returning();
    if (!before) throw notFound('Fee for this rider');
    await audit(db, { actorId: actorId(req), action: 'fees.rider_removed', entity: 'rider_fee', entityId: before.id, subjectUserId: user.id, before, req });
    res.json({ ok: true });
  });

  /** "What will this rider pay?": by category and route, or by a full university ID. */
  r.get('/fees/preview', requirePermission('payments.view'), async (req, res) => {
    const q = parse(feePreviewSchema, req.query);
    let rider: { userId: string | null; category: string | null; routeId: string | null; name?: string } = { userId: null, category: q.category ?? null, routeId: q.routeId ?? null };
    if (q.universityId) {
      const uid = parse(universityId, q.universityId);
      const [u] = await db.select({ id: users.id, name: users.name, category: users.category, homeRouteId: users.homeRouteId }).from(users).where(eq(users.universityId, uid));
      if (!u) throw notFound('Rider');
      rider = { userId: u.id, name: u.name, category: q.category ?? u.category, routeId: q.routeId ?? u.homeRouteId };
    }
    if (!rider.category && !rider.routeId && !rider.userId) throw badRequest('Choose a category, a route or a rider');
    const fee = await feeFor(db, q.semesterId, rider);
    res.json({ ...(rider.name ? { name: rider.name } : {}), category: rider.category, routeId: rider.routeId, fee: fee ? { ...fee, label: FEE_SOURCE_LABELS[fee.source] } : null });
  });

  return r;
}
