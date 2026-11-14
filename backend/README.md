# Backend

Everything that runs on the server: business rules, the database, scheduled jobs and the prediction model.

| Folder | What it is | Built with | Port |
|---|---|---|---|
| [`api/`](api) | REST API + Socket.IO + job worker. Sign-in, cards, passes, fees, payments, allocation, boarding scans, notices, tickets, live tracking, audit log. Owns the database. | Node 22, TypeScript, Express 5, Drizzle ORM, PostgreSQL 16 (PGlite in development) | 4000 |
| [`ml/`](ml) | Internal prediction service: reads class routines, counts expected riders, forecasts real ridership, plans buses. Stateless; only the API calls it. | Python 3.12, FastAPI, scikit-learn, pandas, PuLP | 8000 |

```
backend/
├── api/    The API server and the job worker (the only part that talks to the database)
└── ml/     The ML service (routine parser, ridership model, bus allocation optimizer)
```

## How the pieces fit

```
frontend/web, frontend/mobile ──HTTPS──▶ api ──▶ PostgreSQL
                                          │
                                          ├──internal token──▶ ml  (forecast, allocation plan, routine parsing)
                                          ├──▶ DIU SSO / directory, SSLCommerz, Expo push
GPS trackers on buses ──signed HTTPS──────┘
```

- The API sends the ML service everything it needs in one request and stores the answer; the ML service keeps only trained model files.
- What leaves the API for the ML service is pseudonymous (each rider is a salted hash, no names or profiles), and what comes back is only counts per trip.
- The job worker (inside `api/`) runs the nightly routine sync and forecast, card expiry, reminders and GPS clean-up. Run exactly one copy.

## Run both

```bash
# from the repository root
npm ci && npm run build -w @diu/shared
cp backend/api/.env.example backend/api/.env     # set JWT_SECRET and DATA_ENCRYPTION_KEY
npm run db:seed -w @diu/api
npm run dev:api                                   # http://localhost:4000

cd backend/ml
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.train --synthetic
.venv/bin/uvicorn app.main:app --port 8000
```

Without the ML service the API still works: it uses the routine count and a simple allocation.

Design details: [architecture](../docs/02-architecture.md), [database schema](../docs/04-database-schema.md), [API reference](../docs/05-api-reference.md), [ML design](../docs/06-ml-design.md), [security](../docs/07-security.md).
