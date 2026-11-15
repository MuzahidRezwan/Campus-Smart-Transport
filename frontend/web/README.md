# Web app (`@diu/web`)

One React app with two faces:

- **`/admin`: transport office dashboard.** Predictions, bus allocation, fleet, card and day-pass requests, payments, fees, routines, notices, live map, co-admins.
- **`/app`: rider portal.** The browser version of the mobile app for students and faculty: My Bus, schedule, transport card, notices, help.

Built with React 19, Vite, Tailwind CSS 4, TanStack Query, React Router, Leaflet (OpenStreetMap) and Socket.IO.

## Run

```bash
# from the repository root
npm run build -w @diu/shared
npm run dev:api                 # the API must be running (http://localhost:4000)
npm run dev:web                 # http://localhost:5173
npm run build -w @diu/web       # production build in frontend/web/dist
```

Set `VITE_API_URL` (see [`.env.example`](.env.example)) when the API is on another address.

## Screens (URL → file)

| URL | Who | File |
|---|---|---|
| `/login` | everyone | `src/pages/auth/LoginPage.tsx` |
| `/auth/callback` | riders back from university sign-in | `src/pages/auth/SsoCallbackPage.tsx` |
| `/about` | everyone (public) | `src/pages/AboutPage.tsx` |
| `/admin` | office: prediction panel, 7-day view, route-wise allocation, bottom tabs | `src/pages/authority/DashboardPage.tsx` + `src/components/Workspace.tsx` |
| `/admin/fleet` | office: bus companies and buses | `src/pages/authority/FleetPage.tsx` |
| `/admin/availability` | office: next 7 days availability and allocation | `src/pages/authority/AvailabilityPage.tsx` |
| `/admin/access` | office: find a rider by full ID, give or revoke access | `src/pages/authority/AccessLookupPage.tsx` |
| `/admin/tickets/complaint`, `/admin/tickets/help` | office: complaints and help requests | `src/pages/authority/TicketsPage.tsx` |
| `/admin/payments` | office: daily payments, Excel/CSV export | `src/pages/authority/PaymentsPage.tsx` |
| `/admin/fees` | office: fee rules and per-rider fees | `src/pages/authority/FeesPage.tsx` |
| `/admin/admins` | main admin: co-admins and permissions | `src/pages/authority/AdminsPage.tsx` |
| `/admin/routines` | office: class routine sources and uploads | `src/pages/authority/RoutinesPage.tsx` |
| `/admin/settings` | office: day-pass limit, buffers, attendance factor | `src/pages/authority/SettingsPage.tsx` |
| `/admin/profile` | office: own profile, password, 2FA | `src/pages/authority/ProfilePage.tsx` |
| `/admin/preview` | office: what riders see (sample account, read-only) | `src/pages/authority/PreviewPage.tsx` |
| `/app` | riders: My Bus | `src/pages/rider/MyBusPage.tsx` |
| `/app/schedule` | riders: today's schedule and buses | `src/pages/rider/SchedulePage.tsx` |
| `/app/card` | riders: transport card with rotating QR, pay, day pass | `src/pages/rider/CardPage.tsx` |
| `/app/notices` | riders: notices from the office | `src/pages/rider/NoticesPage.tsx` |
| `/app/support` | riders: complaints and help | `src/pages/rider/SupportPage.tsx` |
| `/payment/result` | riders back from the payment gateway | `src/pages/rider/PaymentResultPage.tsx` |

## Files

```
frontend/web/
├── index.html                  HTML shell Vite fills in
├── public/favicon.svg          Tab icon
├── vite.config.ts              Vite + React + Tailwind setup, dev server port
├── tsconfig.json               TypeScript project references
├── tsconfig.app.json           TypeScript settings for src/
├── tsconfig.node.json          TypeScript settings for vite.config.ts
├── Dockerfile                  Production image: build, then serve dist/ with Caddy
├── .env.example                VITE_API_URL placeholder
└── src/
    ├── main.tsx                Starts React, the router and the query cache
    ├── App.tsx                 All routes; role guard (office vs rider)
    ├── index.css               Theme: DIU blue, company colours, status colours, light/dark
    ├── components/
    │   ├── ui.tsx              Cards, bus chips, toggles, modals, reason dialog, toasts, loading/error states
    │   ├── Workspace.tsx       Dashboard bottom tabs: Feed, Card requests, Day passes, Live, Notice, Preview
    │   ├── AllocationDrawer.tsx  Pick buses for one trip, save draft or publish
    │   ├── LiveMap.tsx         OpenStreetMap with live bus positions
    │   └── RiderHome.tsx       "My Bus" card shared by the rider portal and the preview
    ├── lib/
    │   ├── api.ts              API client: access token in memory, one automatic refresh on 401
    │   ├── auth.tsx            Signed-in person, permissions (can()), login/2FA/logout
    │   ├── demand.ts           Groups departures into waves for the prediction panel
    │   ├── tripDays.ts         Trips per day for the next 7 days
    │   ├── format.ts           Clock, taka and number formatting
    │   ├── qr.ts               Rotating boarding QR token (same algorithm as the API)
    │   └── types.ts            Response shapes the pages read
    └── pages/
        ├── AboutPage.tsx       Public "who built this" page
        ├── auth/               Login and SSO callback
        ├── authority/          Transport office screens (AuthorityLayout.tsx = sidebar + header)
        └── rider/              Rider portal screens (RiderLayout.tsx = header + bottom nav)
```

## Rules this app follows

- The office never sees a rider's profile: authority pages only call `/admin` endpoints, which return transport data only.
- Buttons are hidden when the signed-in admin lacks the permission (`can('fleet.manage')` …), and the API refuses the request anyway.
- The rotating QR shown on the card page is derived in the browser every 30 seconds, so it works with a weak connection.
