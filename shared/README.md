# Shared code (`@diu/shared`)

Code that the **backend** (`backend/api`) and the **frontend** (`frontend/web`, `frontend/mobile`) both import, so a rule or a field is written once. If a field changes here, every app that uses it fails to build instead of breaking in production.

TypeScript only, one dependency (zod). The ML service is Python and keeps its own copy of the department list (`backend/ml/app/demand.py`); keep the two in step.

## Build and test

```bash
# from the repository root
npm run build -w @diu/shared     # writes dist/, which the other apps import
npm test -w @diu/shared
```

Build it once after `npm ci` and after every change here, before running the API, web or mobile app.

## Files

```
shared/
├── package.json, tsconfig*.json   Package name @diu/shared, build settings (output in dist/)
├── src/
│   ├── index.ts           Exports everything below
│   ├── enums.ts           Roles, rider categories, directions, card/pass/payment statuses …
│   ├── types.ts           Response shapes the web and mobile apps read from the API
│   ├── schemas.ts         zod request schemas: the API validates with them, the forms reuse them
│   ├── permissions.ts     Permission list for office accounts, labels, presets, hasPermission()
│   ├── time.ts            Asia/Dhaka dates, "07:30" ↔ minutes, a bus's busy window, overlap check
│   ├── bus-calculator.ts  Riders → buses needed: only one company, or a mixed set, by real seat counts
│   ├── fees.ts            Which fee a rider pays (most specific rule wins)
│   ├── operators.ts       Bus company colours and grouping (companies are data, not hard-coded)
│   ├── departments.ts     DIU departments and their notice pages (routine sources)
│   ├── messages.ts        Sign-in error texts shown by both web and mobile
│   └── about.ts           Project name and creators for the About screens
└── test/
    ├── bus-calculator.test.ts
    ├── fees.test.ts
    ├── operators.test.ts
    └── time-and-permissions.test.ts
```

## Who uses what

| File | API (`backend/api`) | Web (`frontend/web`) | Mobile (`frontend/mobile`) |
|---|---|---|---|
| `schemas.ts` | validates every request body | university ID check on sign-in | – |
| `enums.ts`, `types.ts` | database enums, response types | labels, response types | labels, response types |
| `permissions.ts` | `hasPermission()` guards every `/admin` route | permission labels and presets on the Admins page | – |
| `time.ts` | Dhaka dates, busy windows, overlap rule | clock formatting | clock formatting |
| `bus-calculator.ts` | `pickBuses()` for suggestions | "only H / only M / mixed" numbers on the dashboard | – |
| `fees.ts` | `resolveFee()`: the amount a rider pays | – | – |
| `operators.ts` | company colours | colour palette, buses grouped by company | buses grouped by company |
| `departments.ts` | a routine source for every department | department list | – |
| `messages.ts`, `about.ts` | – | sign-in errors, About page | sign-in errors, About screen |
