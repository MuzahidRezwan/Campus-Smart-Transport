import { and, eq } from 'drizzle-orm';
import { resolveFee, type ResolvedFee } from '@diu/shared';
import type { DB } from '../../db/client.js';
import { feeRules, riderFees, users } from '../../db/schema.js';

/** The fee this rider pays for a route this semester, or null if none is set. */
export async function feeFor(db: DB, semesterId: string, rider: { userId?: string | null; category: string | null; routeId: string | null }): Promise<ResolvedFee | null> {
  const rules = await db.select().from(feeRules).where(eq(feeRules.semesterId, semesterId));
  const [own] = rider.userId
    ? await db.select({ amountBdt: riderFees.amountBdt }).from(riderFees).where(and(eq(riderFees.semesterId, semesterId), eq(riderFees.userId, rider.userId)))
    : [];
  return resolveFee({ category: rider.category, routeId: rider.routeId }, rules, own ?? null);
}

/** Same, by user ID: reads the rider's fee category. */
export async function feeForUser(db: DB, semesterId: string, userId: string, routeId: string | null) {
  const [u] = await db.select({ category: users.category }).from(users).where(eq(users.id, userId));
  return feeFor(db, semesterId, { userId, category: u?.category ?? null, routeId });
}
