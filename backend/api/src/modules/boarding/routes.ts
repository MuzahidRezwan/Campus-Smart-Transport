/**
 * Boarding scans by bus supervisors. Each scan is ground truth for the
 * prediction model (who actually rode which trip) and marks day passes used.
 *
 * Riders board with the rotating app QR, or with their university ID card
 * (barcode, or chip through a reader). One boarding per rider per trip.
 */
import { Router, type Request } from 'express';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { boardingScanSchema, dhakaDate, formatClock, dhakaMinutes, idCardLinkSchema, idCardScanSchema, operatorColor } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { boardingEvents, buses, dayPasses, operators, routes, semesters, transportCards, users } from '../../db/schema.js';
import { authenticate, requireRoles } from '../../auth/middleware.js';
import { decrypt } from '../../lib/crypto.js';
import { conflict, notFound, parse, unprocessable } from '../../lib/errors.js';
import { findRiderByCard, linkCard } from '../../lib/id-card.js';
import { parseQrToken, verifyQrToken } from '../../lib/qr.js';
import { currentTrip } from '../tracking/routes.js';

type Trip = Awaited<ReturnType<typeof currentTrip>>;
type CardRow = typeof transportCards.$inferSelect;
type PassRow = typeof dayPasses.$inferSelect;

/** Why this card cannot ride this trip, or null if it can. */
async function cardProblem(db: DB, card: CardRow, current: boolean, trip: Trip, serviceDate: string): Promise<string | null> {
  const overdue = card.payBy && card.payBy < serviceDate && ['active', 'expired', 'pending_payment'].includes(card.status);
  if (overdue) return `Payment due date passed (${card.payBy}): the rider must pay in the app`;
  if (card.status !== 'active' || !current) return `Card is ${card.status.replace('_', ' ')}`;
  if (card.expiresOn && card.expiresOn < serviceDate) return 'Card expired';
  // A card is for its home route; the shuttle is open to every card holder.
  if (trip && trip.routeKind !== 'shuttle' && trip.routeId !== card.routeId) {
    const [home] = await db.select({ name: routes.name }).from(routes).where(eq(routes.id, card.routeId));
    return `Card is for the ${home?.name ?? 'another'} route`;
  }
  return null;
}

function passProblem(pass: PassRow, trip: Trip, serviceDate: string): string | null {
  if (!['approved', 'used'].includes(pass.status)) return `Pass is ${pass.status}`;
  if (pass.travelDate !== serviceDate) return `Pass is for ${pass.travelDate}`;
  if (trip && trip.routeKind !== 'shuttle' && trip.routeId !== pass.routeId) return 'Pass is for another route';
  return null;
}

export function boardingRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.db;
  r.use(authenticate(ctx), requireRoles('supervisor'));

  /** Buses a supervisor can pick for their trip, with their company for the filter. */
  r.get('/buses', async (_req, res) => {
    const rows = await db.select({ id: buses.id, code: buses.code, operatorCode: operators.code, operatorName: operators.name, savedColor: operators.color })
      .from(buses).innerJoin(operators, eq(operators.id, buses.operatorId))
      .where(and(eq(buses.isActive, true), eq(operators.isActive, true))).orderBy(asc(buses.code));
    res.json(rows.map(({ savedColor, ...b }) => ({ ...b, operatorColor: operatorColor({ code: b.operatorCode, color: savedColor }) })));
  });

  /** Common to every scan: the bus, its current trip, and how to record the result. */
  async function scanContext(req: Request, input: { busId: string; timeSlotId?: string; scannedAt: string; method: typeof boardingEvents.$inferInsert['method'] }) {
    const scannedAt = new Date(input.scannedAt);
    const serviceDate = dhakaDate(scannedAt);
    const [bus] = await db.select({ id: buses.id }).from(buses).where(eq(buses.id, input.busId));
    if (!bus) throw notFound('Bus');
    const trip = await currentTrip(db, bus.id, scannedAt);
    const timeSlotId = input.timeSlotId ?? trip?.timeSlotId ?? null;

    /** Already boarded this trip (or, with no known trip, in the last 45 minutes)? */
    const alreadyBoarded = async (userId: string) => {
      const [prev] = await db.select({ scannedAt: boardingEvents.scannedAt, busCode: buses.code }).from(boardingEvents)
        .innerJoin(buses, eq(buses.id, boardingEvents.busId))
        .where(and(
          eq(boardingEvents.userId, userId), eq(boardingEvents.serviceDate, serviceDate), eq(boardingEvents.valid, true),
          timeSlotId ? eq(boardingEvents.timeSlotId, timeSlotId)
            : and(gte(boardingEvents.scannedAt, new Date(scannedAt.getTime() - 45 * 60_000)), lte(boardingEvents.scannedAt, scannedAt)),
        )).orderBy(desc(boardingEvents.scannedAt)).limit(1);
      return prev ? `Already boarded this trip at ${formatClock(dhakaMinutes(prev.scannedAt))} on ${prev.busCode}` : null;
    };

    /** Saves the scan. The supervisor sees only what is needed at the door: valid or not, and the name to match the card photo. */
    const record = async (valid: boolean, reason: string | null, ids: { userId?: string; cardId?: string; dayPassId?: string; name?: string }) => {
      if (valid && ids.userId) {
        const dup = await alreadyBoarded(ids.userId);
        if (dup) { valid = false; reason = dup; }
      }
      const [ev] = await db.insert(boardingEvents).values({
        userId: ids.userId ?? null, cardId: ids.cardId ?? null, dayPassId: ids.dayPassId ?? null, busId: bus.id,
        timeSlotId, serviceDate, scannedAt, method: input.method, scannedBy: req.auth!.userId, valid, rejectReason: reason,
      }).returning({ id: boardingEvents.id });
      if (valid && ids.dayPassId) {
        await db.update(dayPasses).set({ status: 'used', usedAt: scannedAt }).where(and(eq(dayPasses.id, ids.dayPassId), eq(dayPasses.status, 'approved'), sql`${dayPasses.usedAt} is null`));
      }
      return { valid, reason, name: ids.name ?? null, boardingId: ev!.id };
    };
    return { serviceDate, trip, record };
  }

  r.post('/scan', async (req, res) => {
    const body = parse(boardingScanSchema, req.body);
    const { serviceDate, trip, record } = await scanContext(req, body);
    const scannedAt = new Date(body.scannedAt);

    const parsed = parseQrToken(body.qrToken);
    if (!parsed) { res.json(await record(false, 'Not a DIU transport QR', {})); return; }

    if (parsed.kind === 'c') {
      const [row] = await db.select({ card: transportCards, name: users.name, current: semesters.isCurrent })
        .from(transportCards).innerJoin(users, eq(users.id, transportCards.userId)).innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
        .where(eq(transportCards.id, parsed.id));
      if (!row?.card.qrSecretEnc) { res.json(await record(false, 'Unknown card', {})); return; }
      if (!verifyQrToken(body.qrToken, decrypt(ctx.config.dataKey, row.card.qrSecretEnc), scannedAt)) {
        res.json(await record(false, 'QR expired or copied: ask the rider to open the app again', { userId: row.card.userId }));
        return;
      }
      const ids = { userId: row.card.userId, cardId: row.card.id, name: row.name };
      const problem = await cardProblem(db, row.card, row.current, trip, serviceDate);
      res.json(await record(!problem, problem, ids));
      return;
    }

    const [row] = await db.select({ pass: dayPasses, name: users.name }).from(dayPasses).innerJoin(users, eq(users.id, dayPasses.userId)).where(eq(dayPasses.id, parsed.id));
    if (!row?.pass.qrSecretEnc) { res.json(await record(false, 'Unknown pass', {})); return; }
    if (!verifyQrToken(body.qrToken, decrypt(ctx.config.dataKey, row.pass.qrSecretEnc), scannedAt)) {
      res.json(await record(false, 'QR expired or copied', { userId: row.pass.userId }));
      return;
    }
    const problem = passProblem(row.pass, trip, serviceDate);
    res.json(await record(!problem, problem, { userId: row.pass.userId, dayPassId: row.pass.id, name: row.name }));
  });

  /** The rider's university ID card: barcode text, or a chip reader's serial number. */
  r.post('/scan-id', async (req, res) => {
    const body = parse(idCardScanSchema, req.body);
    const { serviceDate, trip, record } = await scanContext(req, { ...body, method: body.kind === 'chip' ? 'nfc' : 'barcode' });
    const match = await findRiderByCard(db, ctx.config.dataKey, body.kind, body.code);
    if (match.status !== 'found') {
      const why = {
        unreadable: 'Could not read this card. Try again, or scan the app QR',
        unknown: body.kind === 'chip'
          ? 'This chip is not linked yet. Scan the rider\'s app QR, then link the chip'
          : 'Card number not recognised. Scan the rider\'s app QR, then link this card',
        ambiguous: 'This number matches more than one rider. Use the app QR',
        blocked: 'This card was reported lost. Use the app QR',
      }[match.status];
      res.json(await record(false, why, {}));
      return;
    }
    const [user] = await db.select({ id: users.id, name: users.name, idCardBoarding: users.idCardBoarding }).from(users).where(eq(users.id, match.userId));
    const ids = { userId: user!.id, name: user!.name };
    if (!user!.idCardBoarding) { res.json(await record(false, 'The rider switched off ID card boarding (card lost?). Use the app QR', ids)); return; }

    const [card] = await db.select({ card: transportCards, current: semesters.isCurrent }).from(transportCards)
      .innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
      .where(and(eq(transportCards.userId, user!.id), eq(semesters.isCurrent, true)));
    const cardIssue = card ? await cardProblem(db, card.card, card.current, trip, serviceDate) : 'No transport card this semester';
    if (card && !cardIssue) { res.json(await record(true, null, { ...ids, cardId: card.card.id })); return; }

    // No usable card: a One Day Pass for today still lets them ride.
    const [pass] = await db.select().from(dayPasses)
      .where(and(eq(dayPasses.userId, user!.id), eq(dayPasses.travelDate, serviceDate), inArray(dayPasses.status, ['approved', 'used'])));
    if (pass) {
      const problem = passProblem(pass, trip, serviceDate);
      res.json(await record(!problem, problem, { ...ids, dayPassId: pass.id }));
      return;
    }
    res.json(await record(false, cardIssue, { ...ids, ...(card ? { cardId: card.card.id } : {}) }));
  });

  /**
   * Link a university ID card (another number in its barcode, or its chip) to
   * the rider just scanned. Only right after a valid scan by the same supervisor,
   * so the rider and their app are standing at the door.
   */
  r.post('/link-card', async (req, res) => {
    const body = parse(idCardLinkSchema, req.body);
    if (parseQrToken(body.code)) throw unprocessable('That is the app QR. Scan the university ID card to link it.');
    const [ev] = await db.select({ ev: boardingEvents, name: users.name }).from(boardingEvents)
      .innerJoin(users, eq(users.id, boardingEvents.userId)).where(eq(boardingEvents.id, body.boardingId));
    if (!ev || !ev.ev.valid || ev.ev.scannedBy !== req.auth!.userId) throw notFound('A valid scan of yours to link this card to');
    if (Date.now() - ev.ev.scannedAt.getTime() > 5 * 60_000) throw unprocessable('Link the card within 5 minutes of scanning the rider. Scan their app QR again.');
    const match = await findRiderByCard(db, ctx.config.dataKey, body.kind, body.code);
    if (match.status === 'found' && match.userId !== ev.ev.userId) throw conflict('This card already belongs to another rider');
    if (match.status === 'found' && match.via === 'university_id') { res.json({ linked: false, name: ev.name, note: 'This card already works: its barcode is the rider\'s ID' }); return; }
    const out = await linkCard(db, ctx.config.dataKey, { userId: ev.ev.userId!, kind: body.kind, raw: body.code, source: 'supervisor', linkedBy: req.auth!.userId });
    if (out === 'taken') throw conflict('This card already belongs to another rider');
    res.json({ linked: true, name: ev.name, note: out === 'already' ? 'Already linked' : `Linked to ${ev.name}. Next time the card alone is enough.` });
  });

  return r;
}
