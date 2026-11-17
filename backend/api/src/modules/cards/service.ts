import { and, desc, eq, sql } from 'drizzle-orm';
import { dhakaDate } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { auditLogs, dayPasses, payments, routes, semesters, transportCards, users } from '../../db/schema.js';
import { encrypt, randomToken } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';

export type ActivationSource = 'payment' | 'authority_grant' | 'manual_approval';

/**
 * Makes a card usable and creates its QR secret. Valid to the semester end, or,
 * for pay-later access (`payBy`), until that date. A payment always clears the
 * pay-by date.
 */
export async function activateCard(ctx: AppContext, db: DB, cardId: string, source: ActivationSource, actor: string | null, reason?: string | null, opts: { payBy?: string | null } = {}) {
  const [row] = await db.select({ card: transportCards, semester: semesters }).from(transportCards)
    .innerJoin(semesters, eq(semesters.id, transportCards.semesterId)).where(eq(transportCards.id, cardId));
  if (!row) throw notFound('Card');
  const payBy = source === 'payment' ? null : opts.payBy ?? null;
  if (payBy) assertPayBy(payBy, row.semester);
  const [after] = await db.update(transportCards).set({
    status: 'active',
    source,
    decidedBy: actor,
    reason: reason ?? row.card.reason,
    // A payment while on pay-later keeps the original issue date.
    issuedAt: source === 'payment' && row.card.status === 'active' && row.card.issuedAt ? row.card.issuedAt : new Date(),
    expiresOn: payBy ?? row.semester.endsOn,
    payBy,
    qrSecretEnc: row.card.qrSecretEnc ?? encrypt(ctx.config.dataKey, randomToken(32)),
    updatedAt: new Date(),
  }).where(eq(transportCards.id, cardId)).returning();
  return { before: row.card, after: after! };
}

/** A pay-by date must be today or later, and inside the card's semester. */
export function assertPayBy(payBy: string, semester: { endsOn: string; name: string }) {
  if (payBy < dhakaDate()) throw badRequest('The pay-by date has already passed');
  if (payBy > semester.endsOn) throw badRequest(`The pay-by date must be on or before the end of ${semester.name} (${semester.endsOn})`);
}

/** Transport-only view of a rider (the privacy view: no profile fields). */
export async function riderView(db: DB, universityId: string) {
  const result = await db.execute(sql`
    select user_id as "userId", university_id as "universityId", name, rider_type as "riderType", category, home_route as "homeRoute", card_status as "cardStatus"
    from transport_riders where university_id = ${universityId}`);
  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
  return (rows[0] as { userId: string; universityId: string; name: string; riderType: string; category: string | null; homeRoute: string | null; cardStatus: string } | undefined) ?? null;
}

/** Everything transport-related about one rider, for the access lookup. */
export async function riderHistory(db: DB, userId: string) {
  const cards = await db.select({
    id: transportCards.id, semester: semesters.code, semesterName: semesters.name, route: routes.name, status: transportCards.status, source: transportCards.source,
    reason: transportCards.reason, issuedAt: transportCards.issuedAt, expiresOn: transportCards.expiresOn, payBy: transportCards.payBy, createdAt: transportCards.createdAt,
  }).from(transportCards).innerJoin(semesters, eq(semesters.id, transportCards.semesterId)).innerJoin(routes, eq(routes.id, transportCards.routeId))
    .where(eq(transportCards.userId, userId)).orderBy(desc(semesters.startsOn));

  const pays = await db.select({
    tranId: payments.tranId, semester: semesters.code, amountBdt: payments.amountBdt, method: payments.method, status: payments.status,
    failureReason: payments.failureReason, createdAt: payments.createdAt, paidAt: payments.paidAt, refundedAt: payments.refundedAt,
  }).from(payments).innerJoin(semesters, eq(semesters.id, payments.semesterId))
    .where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt));

  const passes = await db.select({
    travelDate: dayPasses.travelDate, route: routes.name, status: dayPasses.status, autoApproved: dayPasses.autoApproved, reason: dayPasses.reason, usedAt: dayPasses.usedAt,
  }).from(dayPasses).innerJoin(routes, eq(routes.id, dayPasses.routeId)).where(eq(dayPasses.userId, userId)).orderBy(desc(dayPasses.travelDate));

  const changes = await db.select({ at: auditLogs.createdAt, action: auditLogs.action, reason: auditLogs.reason, actorName: users.name })
    .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.subjectUserId, userId), sql`${auditLogs.action} in ('access.granted','access.revoked','access.pay_by_changed','cards.approved_without_payment','cards.rejected','daypass.approved','daypass.rejected','fees.rider_set','fees.rider_removed')`))
    .orderBy(desc(auditLogs.createdAt));

  const paid = pays.filter((p) => p.status === 'success');
  return {
    summary: {
      totalPaidBdt: paid.reduce((t, p) => t + p.amountBdt, 0),
      payments: paid.length,
      semestersPaid: new Set(paid.map((p) => p.semester)).size,
      lastPaid: paid[0] ? { at: paid[0].paidAt ?? paid[0].createdAt, amountBdt: paid[0].amountBdt, method: paid[0].method, semester: paid[0].semester } : null,
    },
    cards, payments: pays, dayPasses: passes, accessChanges: changes,
  };
}

/**
 * The rider's identity row for a full university ID. Someone the system has not
 * seen yet is added with identity only (no profile); their profile arrives when
 * they sign in themselves.
 */
export async function ensureRiderIdentity(ctx: AppContext, db: DB, universityId: string) {
  let [user] = await db.select({ id: users.id, name: users.name, role: users.role, category: users.category, homeRouteId: users.homeRouteId })
    .from(users).where(eq(users.universityId, universityId));
  if (!user) {
    const person = await ctx.directory.lookup(universityId);
    if (!person) throw notFound('This ID in the university directory');
    [user] = await db.insert(users).values({ universityId, name: person.name, role: person.role, category: person.category })
      .returning({ id: users.id, name: users.name, role: users.role, category: users.category, homeRouteId: users.homeRouteId });
  }
  if (user!.role === 'authority' || user!.role === 'supervisor') throw badRequest('Transport access is for riders');
  return user!;
}
