# API (`@diu/api`)

The server behind the web dashboard and the mobile app. It holds every business rule and is the only part that touches the database.

Node 22, TypeScript, Express 5, Drizzle ORM, PostgreSQL 16 (PGlite, an embedded Postgres, in development and tests), Socket.IO for live bus positions, node-cron for scheduled jobs, pino logs, zod validation.

## Run

```bash
# from the repository root
npm ci && npm run build -w @diu/shared
cp backend/api/.env.example backend/api/.env   # then set JWT_SECRET and DATA_ENCRYPTION_KEY
npm run db:seed -w @diu/api      # DIU timetable, buses, fees; prints the main admin password once
npm run db:demo -w @diu/api      # optional: ~940 sample riders, payments, routines, tickets
npm run dev:api                  # http://localhost:4000
npm run dev:jobs -w @diu/api     # the job worker (optional in development)
npm test -w @diu/api             # all tests on PGlite
```

| Script | What it does |
|---|---|
| `dev` / `dev:jobs` | Run the server / job worker with live reload |
| `build`, `start`, `start:jobs` | Compile to `dist/` and run it (production) |
| `typecheck`, `test` | TypeScript check, Vitest suite |
| `db:generate` | Write a new migration from changes in `src/db/schema.ts` |
| `db:migrate`, `db:seed`, `db:demo` | Apply migrations, add starting data, add sample riders |
| `ml:export` | Export pseudonymised training data for the ML model |

## URL map

| Prefix | Who | Code |
|---|---|---|
| `/auth` | everyone: university SSO for riders, password + 2FA for the office, token refresh, logout | `src/auth/routes.ts` |
| `/` (public) | everyone: routes, stops, departure times (no bus numbers) | `src/modules/public` |
| `/me` | the signed-in rider: profile, card, passes, payments, My Bus, notices, tickets, devices | `src/modules/me` |
| `/boarding` | bus supervisors: scan QR or ID card | `src/modules/boarding` |
| `/devices` | GPS trackers (signed requests) | `src/modules/tracking` |
| `/payments` | payment gateway callbacks (SSLCommerz IPN) | `src/modules/payments` |
| `/admin/...` | transport office, every route guarded by one permission and audited | the other modules below |

Full list of endpoints: [docs/05-api-reference.md](../../docs/05-api-reference.md).

## Files

```
backend/api/
├── package.json, tsconfig*.json   Scripts, dependencies, TypeScript settings
├── vitest.config.ts               Test runner settings
├── drizzle.config.ts              Where the schema and migrations are, for drizzle-kit
├── Dockerfile                     Production image (used for both the API and the job worker)
├── .env.example                   Every setting, with placeholders and how to generate secrets
├── drizzle/                       Database migrations, applied in order at start
│   ├── 0000_init.sql … 0008_routine_source_status.sql
│   ├── roles.sql                  Least-privilege database roles (app, transport admin, reporting, migrator)
│   ├── grants.sql                 What each role may read/write; re-applied after every migration
│   └── meta/                      drizzle-kit snapshots and journal
├── src/
│   ├── server.ts                  Starts HTTP + Socket.IO; can also serve the built web app
│   ├── app.ts                     Express app: security headers, CORS, rate limit, all routers
│   ├── bootstrap.ts               Builds the real context (database, SSO, payments, ML, push)
│   ├── context.ts                 What every handler receives; tests swap in fakes
│   ├── config.ts                  Reads and checks environment variables; refuses unsafe production settings
│   ├── logger.ts                  pino logger that hides passwords, tokens and cookies
│   ├── web-static.ts              Serves frontend/web/dist when the web and API share one address
│   ├── auth/
│   │   ├── routes.ts              /auth endpoints
│   │   ├── providers.ts           University SSO (OIDC) and directory, or mocks in development
│   │   ├── tokens.ts              15-minute access tokens, rotating refresh tokens
│   │   ├── middleware.ts          authenticate(), requireRoles(), requireRider(), requirePermission()
│   │   └── handoffs.ts            One-time codes (OAuth state, login code, 2FA challenge), stored hashed
│   ├── db/
│   │   ├── schema.ts              Every table (source of truth for the database)
│   │   ├── client.ts              Connects to PostgreSQL or PGlite, runs migrations and grants
│   │   ├── migrate.ts             npm run db:migrate
│   │   ├── seed.ts, seed-data.ts  npm run db:seed and its starting data
│   │   ├── diu-timetable.ts       DIU's published bus timetable (13 routes, Friday trips)
│   │   ├── demo.ts                npm run db:demo sample riders
│   │   ├── export-training.ts     npm run ml:export
│   │   └── reset-admin.ts         Break-glass reset for a locked-out admin (audited)
│   ├── jobs/
│   │   ├── worker.ts              Schedule (Asia/Dhaka): expiry, GPS clean-up, routine sync, forecasts, reminders
│   │   └── tasks.ts               Each job as a plain, testable function
│   ├── lib/
│   │   ├── audit.ts               Writes the audit log
│   │   ├── crypto.ts              Hashing, random tokens, encryption helpers
│   │   ├── errors.ts              HTTP errors, request parsing, the error handler
│   │   ├── id-card.ts             Matching university ID card barcodes/chips to riders
│   │   ├── qr.ts                  Rotating boarding QR tokens: make, parse, verify
│   │   └── settings.ts            Office-adjustable settings and their defaults
│   ├── notifications/
│   │   └── push.ts                Push notifications through Expo (FCM/APNs)
│   └── modules/                   One folder per feature; routes.ts = endpoints, service.ts = rules
│       ├── common.ts              Shared helpers (current semester, today in Dhaka, actor)
│       ├── academic/              Semesters and academic calendar (holidays, exams)
│       ├── admins/                Co-admins and their permissions
│       ├── allocations/           Bus allocation per trip: draft, publish, overlap rules
│       ├── boarding/              Supervisor scans (ground truth for the model)
│       ├── cards/                 Transport card requests, approval, access lookup
│       ├── day-passes/            One Day Pass requests and limits
│       ├── feed/                  Dashboard activity feed
│       ├── fees/                  Fee rules (category, route, everyone, one rider)
│       ├── fleet/                 Bus companies, buses, availability, GPS device keys
│       ├── me/                    The rider's own data (the only place profiles are returned)
│       ├── notices/               Notices to everyone or one route, with push
│       ├── payments/              SSLCommerz checkout, IPN validation, payment list
│       ├── predictions/           Forecast request to the ML service, 7-day predictions
│       ├── public/                Routes, stops and times for everyone
│       ├── reports/               Aggregated reports (never individual riders)
│       ├── routes/                Routes, stops and time slots (office side)
│       ├── routines/              Class routine sources, uploads, review; all DIU departments
│       ├── settings/              Settings endpoints
│       ├── tickets/               Complaints, suggestions and help requests
│       └── tracking/              GPS pings in, live bus positions out
└── test/                          Vitest tests, one file per feature
    ├── helpers.ts                 Test app with fakes for SSO, payments, ML and push
    ├── privacy.test.ts            The office can never see rider profiles
    ├── auth, allocation, boarding, day-pass, fees, fleet, id-card, jobs, my-bus,
    │   pay-later, payments, routines, tickets, timetable, tracking, unit, upstream
    └── (set TEST_PG_URL to run the same tests on real PostgreSQL with production roles)
```

## Rules you will meet in the code

- **Privacy boundary.** Profile fields live only in `user_profiles`, read only by `/me`. The office's database role cannot read that table at all.
- **Permissions.** Every `/admin` route names one permission from `shared/src/permissions.ts`; every write is in the audit log.
- **Payments.** The amount comes from the server's fee rules; a card turns active only after the gateway's IPN is validated server-side.
- **Allocation.** The office decides; an overlapping bus needs a written reason, out-of-service or retired buses are blocked.
