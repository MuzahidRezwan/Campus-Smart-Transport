# Documentation

The project specification, written before and kept up to date with the code. Read them in order the first time; later, jump to the one you need.

| File | What it answers |
|---|---|
| [01-requirements.md](01-requirements.md) | What the system must do for the office, students, faculty and supervisors (functional and non-functional requirements) |
| [02-architecture.md](02-architecture.md) | The parts (web, mobile, API, jobs, ML, database), how data flows between them, repository layout |
| [03-tech-stack.md](03-tech-stack.md) | Which language, framework and service was chosen for each part, and why |
| [04-database-schema.md](04-database-schema.md) | Every table and relationship, the privacy roles, indexes, data retention |
| [05-api-reference.md](05-api-reference.md) | Every endpoint with its permission, error codes and realtime events |
| [06-ml-design.md](06-ml-design.md) | Demand prediction: data, features, model, evaluation, retraining, bus allocation optimizer |
| [07-security.md](07-security.md) | Sign-in, permissions, the office ↔ rider privacy boundary, payments, backups |
| [08-missing-features.md](08-missing-features.md) | Features the original idea did not mention and why they matter |
| [09-roadmap.md](09-roadmap.md) | Phases (MVP first), team roles and timeline |
| [10-risks-and-assumptions.md](10-risks-and-assumptions.md) | What to get from the university before going live; assumptions made |
| [11-ui-ux.md](11-ui-ux.md) | Screen layouts and the improvements over the hand-drawn sketches |
| [12-deployment-and-ops.md](12-deployment-and-ops.md) | Running, configuring, monitoring, backing up and recovering the system; the public demo |

## superpowers/specs/

Design notes for larger changes, one file per change, dated:

| File | About |
|---|---|
| [2026-11-24-flexible-transport-office-design.md](superpowers/specs/2026-11-24-flexible-transport-office-design.md) | Bus companies as data, fully manual allocation, pay-later access, flexible fees, routines from every department, ID card boarding |

## Where the code for each document lives

| Topic | Code |
|---|---|
| Screens (11) | [`frontend/web`](../frontend/web), [`frontend/mobile`](../frontend/mobile), prototype in [`design`](../design) |
| API, database, security (04, 05, 07) | [`backend/api`](../backend/api), rules shared with the apps in [`shared`](../shared) |
| ML (06) | [`backend/ml`](../backend/ml) |
| Deployment (12) | [`devops`](../devops), [`docker-compose.yml`](../docker-compose.yml) |
