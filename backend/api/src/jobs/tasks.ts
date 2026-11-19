/** Scheduled work. Each task is a plain function so it can be tested and run by hand. */
import { and, eq, lt, lte } from 'drizzle-orm';
import { addDays, dhakaDate } from '@diu/shared';
import type { AppContext } from '../context.js';
import { authHandoffs, dayPasses, gpsPings, refreshTokens, semesters, transportCards } from '../db/schema.js';
import { notify } from '../notifications/push.js';
import { refreshForecast } from '../modules/predictions/routes.js';
import { syncRoutineSources } from '../modules/routines/routes.js';

/** 05:00 — look for new routines on department websites. */
export async function routineSyncTask(ctx: AppContext) {
  return syncRoutineSources(ctx);
}

/** 05:30 — predict today and the next 7 days. */
export async function forecastTask(ctx: AppContext) {
  return refreshForecast(ctx, dhakaDate(), 8);
}

/** 00:10 — expire cards and day passes, and delete old one-time codes and refresh tokens. */
export async function expiryTask(ctx: AppContext) {
  const today = dhakaDate();
  const cards = await ctx.db.update(transportCards).set({ status: 'expired', updatedAt: new Date() })
    .where(and(eq(transportCards.status, 'active'), lt(transportCards.expiresOn, today))).returning({ id: transportCards.id, userId: transportCards.userId, payBy: transportCards.payBy });
  // Pay-later access that ran out unpaid: tell the rider how to get back on.
  const unpaid = cards.filter((c) => c.payBy);
  if (unpaid.length) {
    await notify(ctx.db, ctx.push, { kind: 'users', userIds: unpaid.map((c) => c.userId) }, {
      title: 'Your transport access has ended',
      body: 'The fee was not paid by the date agreed with the transport office. Pay in the app to ride again.',
    });
  }
  const passes = await ctx.db.update(dayPasses).set({ status: 'expired' })
    .where(and(eq(dayPasses.status, 'approved'), lt(dayPasses.travelDate, today))).returning({ id: dayPasses.id });
  await ctx.db.delete(authHandoffs).where(lt(authHandoffs.expiresAt, new Date(Date.now() - 86_400_000)));
  // A week of grace keeps reuse detection working for tokens that just expired.
  const tokens = await ctx.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date(Date.now() - 7 * 86_400_000)))
    .returning({ id: refreshTokens.id });
  return { cardsExpired: cards.length, unpaidPayLater: unpaid.length, passesExpired: passes.length, refreshTokensDeleted: tokens.length };
}

/** 10:05 — riders on pay-later access: remind 3 days and 1 day before the pay-by date, and on the day. */
export async function payByReminderTask(ctx: AppContext) {
  const today = dhakaDate();
  let sent = 0;
  for (const [days, when] of [[3, 'in 3 days'], [1, 'tomorrow'], [0, 'today']] as const) {
    const due = await ctx.db.select({ userId: transportCards.userId }).from(transportCards)
      .where(and(eq(transportCards.status, 'active'), eq(transportCards.payBy, addDays(today, days))));
    if (!due.length) continue;
    sent += await notify(ctx.db, ctx.push, { kind: 'users', userIds: due.map((d) => d.userId) }, {
      title: `Pay your transport fee by ${when === 'today' ? 'today' : addDays(today, days)}`,
      body: `Your access from the transport office ends ${when === 'today' ? 'after today' : when} unless the fee is paid. Pay from My Card.`,
    });
  }
  return { sent };
}

/** 10:00 — remind card holders 14, 7 and 1 days before the semester ends. */
export async function renewalReminderTask(ctx: AppContext) {
  const today = dhakaDate();
  const [sem] = await ctx.db.select().from(semesters).where(eq(semesters.isCurrent, true));
  if (!sem) return { sent: 0 };
  const daysLeft = Math.round((Date.parse(sem.endsOn) - Date.parse(today)) / 86_400_000);
  if (![14, 7, 1].includes(daysLeft)) return { sent: 0 };
  const holders = await ctx.db.select({ userId: transportCards.userId }).from(transportCards)
    .where(and(eq(transportCards.semesterId, sem.id), eq(transportCards.status, 'active')));
  const sent = await notify(ctx.db, ctx.push, { kind: 'users', userIds: holders.map((h) => h.userId) }, {
    title: `Your transport card ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    body: 'Renew for next semester from the app to keep riding.',
  });
  return { sent };
}

/** 03:00 — keep 90 days of raw GPS pings (privacy and storage). */
export async function gpsRetentionTask(ctx: AppContext) {
  const cutoff = new Date(`${addDays(dhakaDate(), -90)}T00:00:00+06:00`);
  const deleted = await ctx.db.delete(gpsPings).where(lte(gpsPings.recordedAt, cutoff)).returning({ id: gpsPings.id });
  return { deleted: deleted.length, cutoff: cutoff.toISOString() };
}
