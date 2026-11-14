/**
 * University ID cards at the bus door.
 *
 * A barcode may carry the university ID (with or without dashes) or another
 * number such as a registration number; a chip reader gives the chip's serial
 * number. We never store those other numbers in plain text: only an HMAC of the
 * normalised value, which is how they are looked up.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { IdCardKind } from '@diu/shared';
import type { DB } from '../db/client.js';
import { idCards, users } from '../db/schema.js';
import { hmacHex } from './crypto.js';

/** Same key for "232-35-798", "23235798" and " 232 35 798 ". */
export function cardKey(raw: string): string {
  return raw.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase();
}

export function cardHash(dataKey: Buffer, kind: IdCardKind, raw: string): string {
  return hmacHex(dataKey, `idcard:${kind}:${cardKey(raw)}`);
}

export type CardMatch =
  | { status: 'found'; userId: string; via: 'university_id' | 'linked' }
  | { status: 'unreadable' | 'unknown' | 'ambiguous' | 'blocked' };

/**
 * Who does this card belong to? A barcode matches the university ID (dashes
 * ignored) or a linked number; a chip matches a linked serial number. Two
 * different riders matching is refused rather than guessed.
 */
export async function findRiderByCard(db: DB, dataKey: Buffer, kind: IdCardKind, raw: string): Promise<CardMatch> {
  const key = cardKey(raw);
  if (key.length < 4 || key.length > 64) return { status: 'unreadable' };
  const linked = await db.select({ userId: idCards.userId, status: idCards.status }).from(idCards)
    .where(and(eq(idCards.kind, kind), eq(idCards.valueHash, cardHash(dataKey, kind, raw))));
  const byId = kind === 'barcode'
    ? await db.select({ id: users.id }).from(users)
      .where(and(sql`replace(${users.universityId}, '-', '') = ${key}`, inArray(users.role, ['student', 'faculty', 'staff'])))
    : [];
  const ids = new Set([...linked.map((l) => l.userId), ...byId.map((u) => u.id)]);
  if (ids.size === 0) return { status: 'unknown' };
  if (ids.size > 1) return { status: 'ambiguous' };
  const userId = [...ids][0]!;
  if (byId.length) return { status: 'found', userId, via: 'university_id' };
  return linked.some((l) => l.status === 'active') ? { status: 'found', userId, via: 'linked' } : { status: 'blocked' };
}

/**
 * Links a card number to a rider. Returns 'linked', 'already' (same rider), or
 * 'taken' (linked to someone else, left unchanged).
 */
export async function linkCard(db: DB, dataKey: Buffer, input: { userId: string; kind: IdCardKind; raw: string; source: 'directory' | 'supervisor'; linkedBy?: string | null }): Promise<'linked' | 'already' | 'taken'> {
  const valueHash = cardHash(dataKey, input.kind, input.raw);
  const [existing] = await db.select().from(idCards).where(and(eq(idCards.kind, input.kind), eq(idCards.valueHash, valueHash)));
  if (existing) {
    if (existing.userId !== input.userId) return 'taken';
    if (existing.status !== 'active' && input.source === 'directory') return 'already'; // a lost card stays blocked until the rider says otherwise
    if (existing.status !== 'active') await db.update(idCards).set({ status: 'active', linkedBy: input.linkedBy ?? null, updatedAt: new Date() }).where(eq(idCards.id, existing.id));
    return existing.status === 'active' ? 'already' : 'linked';
  }
  await db.insert(idCards).values({ userId: input.userId, kind: input.kind, valueHash, source: input.source, linkedBy: input.linkedBy ?? null }).onConflictDoNothing();
  return 'linked';
}
