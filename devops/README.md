# DevOps

Everything for running, demoing, protecting and recovering the system. No app code lives here.

```
devops/
├── infra/       Server setup used by docker-compose.yml (Postgres roles, Caddy web server / HTTPS)
├── deploy/      The one-container public demo (Docker, Hugging Face Space, GitHub Codespaces)
└── scripts/     Laptop demo, secret guard, database backup and restore
```

Related files at the repository root: [`docker-compose.yml`](../docker-compose.yml) (production on one machine), [`.env.example`](../.env.example) and [`.env.api.example`](../.env.api.example) (its settings), [`.github/workflows`](../.github/workflows) (CI and demo deploy), [`.githooks`](../.githooks) (secret guard before commit/push), [`.devcontainer`](../.devcontainer) (Codespaces). Full guide: [docs/12-deployment-and-ops.md](../docs/12-deployment-and-ops.md).

## infra/

| File | What it does |
|---|---|
| `postgres/10-roles.sh` | Runs once when the Postgres volume is created: makes the least-privilege roles from `backend/api/drizzle/roles.sql` and sets their passwords from `.env` |
| `caddy/web.Caddyfile` | Serves the built dashboard inside the `web` container (SPA fallback, caching, security headers) |
| `caddy/edge.Caddyfile` | Optional public entry point (`docker compose --profile edge up -d`): automatic HTTPS for the web and API domains |

## deploy/

| File | What it does |
|---|---|
| `demo/Dockerfile` | Builds the demo image: ML model trained on synthetic data, API and web built once, everything on port 7860 |
| `demo/start.sh` | Container start: ML service, fresh sample data, 7-day forecast, API + web, published buses, GPS simulator |
| `demo/wait-for.mjs` | Waits until a URL answers (used by `start.sh`) |
| `demo/warmup.mjs` | Publishes the optimizer's suggested buses for today and the next days, so riders see bus numbers at once |
| `demo/gps-sim.mjs` | Pretend GPS trackers that drive the allocated buses along their routes, so the live map moves |
| `huggingface/README.md` | The Hugging Face Space's own page (settings block on top); copied there by the Deploy demo workflow |

```bash
docker build -f devops/deploy/demo/Dockerfile -t diu-demo . && docker run -p 7860:7860 diu-demo   # http://localhost:7860
```

The demo uses mock sign-in and payments and resets its data on every start. Never put real data in it.

## scripts/

| File | What it does | How to run |
|---|---|---|
| `demo.mjs` | Whole system on a laptop (Windows/macOS/Linux) with sample data, one port | `npm run demo` or `npm run demo -- --public` (adds a temporary public link) |
| `check-secrets.mjs` | Refuses `.env` files, keys, dumps and real-looking secrets | runs by itself before every commit and push; `npm run secrets:check` checks the whole tree and history |
| `backup-db.sh` | Encrypted nightly backup of the docker-compose database (GPG public key), keeps 14 days | `BACKUP_GPG_RECIPIENT=<key> devops/scripts/backup-db.sh` (from cron) |
| `restore-db.sh` | Restores a backup into a scratch database (monthly drill) or, with `--live`, over the live one | `devops/scripts/restore-db.sh backups/<file>.dump.gpg [--live]` |

Run the scripts from the repository root; `backup-db.sh` and `restore-db.sh` move there by themselves.
