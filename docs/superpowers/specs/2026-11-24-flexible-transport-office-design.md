# Flexible transport office: operators, allocation, pay-later access, fees, routines, ID card boarding

Date: 2026-11-24 · Status: agreed in chat, building

## Why

The transport office must be able to run the system without asking a developer
to change code: bus companies change, fees change per route or per person, some
riders are let in before they pay, routines come from every department, and
riders should be able to board with the university ID card they already carry.
Two people built this project, and the demo should show them.

## Goals

1. **Bus companies (operators) are data, not code.** Add a company, rename it,
   change its short code, contact or colour, retire it, delete it if it never had
   buses. Every screen (dashboard "Only X" rows, allocation drawer, rider My Bus,
   mobile app, scanner filter) lists whatever companies exist.
2. **Manual allocation has no artificial limits.** The office can allocate any
   trip in the timetable, even with no prediction; can pick buses from the other
   pool (a staff bus for a student trip); and can allocate a bus whose estimated
   busy window overlaps another trip, after confirming and giving a reason
   (audited). Out-of-service and retired buses stay blocked: the office marks
   those itself and can undo it.
3. **Pay-later access.** The office can give a rider access until a pay-by date.
   Reminders go 3 days and 1 day before, and on the day. Paying before the date
   turns it into a normal card until semester end. Not paying stops access the day
   after the date; boarding says "Payment due date passed". The office can move
   the date or turn it into full free access. Paying late brings the card back.
   Full free access (no date) stays as before.
4. **Fees are set by the office.** A fee can be set per category, per route, per
   route and category, or for one rider. The most specific rule wins:
   rider > route + category > route > category. Rules can change at any time;
   only new payments use the new amount. A Fees screen shows the rules and a
   "what will this rider pay" check. Riders see their amount before paying.
5. **Routines from every department.** A Routine sources screen to add, edit,
   switch off, delete and "Check now" each department's link, with the last
   check's result. DIU's departments are pre-filled. The fetcher follows the
   routine link on a department page (one level), and accepts Google Drive and
   Google Sheets links safely. New routines still wait for review.
6. **Board with the university ID card.** The supervisor scanner reads the ID
   card barcode with the camera, or from a barcode gun / card reader that types
   like a keyboard. A card chip can be linked to a rider by scanning the barcode
   first and then the chip. One boarding per rider per trip. A rider can block
   their own ID card from the app (lost card). The rotating app QR stays.
7. **Demo people:** faculty 710410 is Rashidul Islam, Lecturer, Software
   Engineering. Students 232-35-797 Khalilur Rahman (Mirpur) and 232-35-798
   Muzahidul Islam (Uttara), both SWE batch 41 section G.
8. **Credits:** "Created by Muzahidul Islam and Khalilur Rahman, Department of
   Software Engineering, DIU" on the login pages, dashboard, rider portal and
   mobile app.

## Non-goals

- Reading the chip with the phone's own NFC. It needs a native module and
  depends on the chip type (13.56 MHz or 125 kHz), which we are still checking.
  The keyboard-style reader input works with either chip type today.
- Offline boarding (scanner with no internet). Separate change.
- Extra one-off trips outside the timetable.

## Anti-goals (would make this a failure even if it works)

- Any change that lets the transport office read a rider's profile, sign in as a
  rider or edit a rider's account (privacy boundary). Rider fees and pay-by dates
  are transport data and live in transport tables.
- Storing chip numbers in plain text (they work like a key): store an HMAC.
- Silent overrides: every conflict override, fee change, pay-by change and chip
  link is in the audit log.

## Approaches considered

- **ID card:** (A) phone camera only; (B) barcode gun at the door only;
  (C) camera now plus keyboard-style input so a gun or chip reader works later
  with no code change. Picked **C**.
- **Fees:** (A) per-rider override only; (B) adjustments (+/-) on top of a base;
  (C) absolute amounts with "most specific wins" and a preview. Picked **C**:
  easy to read, and the preview removes ambiguity.
- **Pay-later state:** (A) new card status; (B) `pay_by` date with the card's
  `expires_on` set to it, reusing the nightly expiry job. Picked **B**: no enum
  change, expiry and boarding checks already exist.
- **Trips without prediction:** (A) separate "slots" endpoint merged in the
  browser; (B) the predictions endpoint can include every running trip with
  empty numbers. Picked **B**: one list, one place.

## Design notes

- `operators`: add `is_active`, `color`. Bus chips are coloured by operator
  colour, not by the first letter of the bus code. A retired operator's buses
  cannot be allocated.
- Allocation: `PUT /admin/allocations` takes `overrideConflicts` and
  `overrideReason` (required with override). Without override a clash is 409 as
  before, now with the clashing trips listed so the drawer can ask.
- `transport_cards.pay_by` (date, null = normal). Grant takes optional `payBy`.
  New `PATCH /admin/access/:id/pay-by`. Paying while active-with-pay-by keeps the
  card active during checkout.
- `fee_rules`: `category` becomes nullable, new nullable `route_id`, unique on
  (semester, category, route) with NULLS NOT DISTINCT. New `rider_fees`
  (semester, user, amount, reason). `GET /admin/fees/preview`, `GET /me/fee`.
- `routine_sources`: add `last_status`, `last_error`, `last_found_url`.
  `PATCH`, `DELETE`, `POST /:id/check`, `POST /check-all`.
- `id_cards` (user, kind `barcode`|`chip`, value_hash, status `active`|`blocked`,
  linked_by, timestamps), unique (kind, value_hash). Boarding method gains
  `barcode`. `POST /boarding/scan-id`, `POST /boarding/link-chip` (only within 5
  minutes of a valid scan by the same supervisor). Barcode text is read as a
  university ID (with or without dashes); anything else is looked up as a
  registered barcode. If the barcode is just the ID number, a blocked card cannot
  be told apart from its replacement; the rider unblocks when they have a card
  again (documented).
- One boarding per trip: same rider, same trip (or within 45 minutes when the
  trip is unknown) is rejected with "Already boarded at 7:02 on H-10".

## Left to the builder

Exact screen layout, colour palette, messages, test cases.
