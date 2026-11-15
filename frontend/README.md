# Frontend

Everything people see and tap. Two apps, both talking to the same API in [`backend/api`](../backend/api) and both using the shared types and rules in [`shared`](../shared).

| Folder | What it is | Who uses it | Built with |
|---|---|---|---|
| [`web/`](web) | Transport office dashboard **and** the browser version of the rider portal | Transport office (authority), students, faculty | React 19, Vite, Tailwind CSS, TanStack Query, Leaflet |
| [`mobile/`](mobile) | Android/iOS app for riders, plus scanner mode for bus supervisors | Students, faculty, staff, supervisors | Expo (React Native), Expo Router |

```
frontend/
├── web/       Authority dashboard (/admin) + rider portal (/app), one React app
└── mobile/    Rider app (My Bus, Live Route, My Card, Notification) + supervisor scanner
```

## How the frontend talks to the backend

- All data comes from the REST API (`/auth`, `/me`, `/admin`, public `/routes` …) and live bus positions from Socket.IO. See [docs/05-api-reference.md](../docs/05-api-reference.md).
- Request shapes, permission names, time helpers and the bus calculator are imported from `@diu/shared`, so the screens and the API never disagree on a field.
- No business rule is trusted to the frontend: the API checks every permission and every fee again.
- Sign-in: riders use the university account (SSO), the office uses ID + password + 2FA. Access tokens stay in memory; the refresh token is an HttpOnly cookie (web) or in the phone's secure keystore (mobile).

## Run

```bash
# from the repository root
npm ci && npm run build -w @diu/shared
npm run dev:api        # backend on http://localhost:4000
npm run dev:web        # web on http://localhost:5173

cd frontend/mobile && npm ci && EXPO_PUBLIC_API_URL=http://<your LAN IP>:4000 npx expo start
```

Each app's own README lists every file inside it.
