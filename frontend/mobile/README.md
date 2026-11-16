# Mobile app (DIU Transport)

The Android/iOS app for students, faculty and staff, built with Expo (React Native) and Expo Router. Signed-in supervisors get **scanner mode** instead, to check riders at the bus door.

This folder has its own `package.json` and lockfile (it is not an npm workspace, because Expo pins React Native and its native modules per SDK). It links the shared code with `"@diu/shared": "file:../../shared"`.

## Run

```bash
# from the repository root, once
npm ci && npm run build -w @diu/shared
npm run dev:api                                   # the API on port 4000

cd frontend/mobile
npm ci
EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:4000 npx expo start   # open in Expo Go
npm run typecheck                                 # TypeScript check
npm run bundle:android                            # production JS bundle (what CI builds)
```

To sign in from Expo Go, set `MOBILE_REDIRECT_URI` in `backend/api/.env` to the `exp://<LAN IP>:8081/--/auth` address. Installed builds use `diutransport://auth`. Store builds: [docs/12-deployment-and-ops.md](../../docs/12-deployment-and-ops.md).

## Screens

Expo Router turns each file in `app/` into a screen. The bottom tabs follow the paid student sketch.

| Screen | File | What it shows |
|---|---|---|
| **My Bus** (tab 1, home) | `app/(tabs)/index.tsx` | Next bus for the rider's route with the published bus numbers and the route's stops |
| **Live Route** (tab 2) | `app/(tabs)/live.tsx` | Map of the rider's route buses while they are on a trip |
| **My Card** (tab 3) | `app/(tabs)/card.tsx` | Transport card with rotating QR (works offline), day passes, pay |
| **Notification** (tab 4) | `app/(tabs)/notifications.tsx` | Notices from the transport office |
| Today's schedule | `app/schedule.tsx` | Every trip today for the route, with buses |
| Help | `app/support.tsx` | Complaints, suggestions and help requests with replies |
| About | `app/about.tsx` | What the app is and who built it |
| Login | `app/login.tsx` | University sign-in (SSO) |
| Scanner (supervisors) | `app/scan.tsx` | Scan app QR or university ID card; every scan is ridership data for the model |

## Files

```
frontend/mobile/
├── app.json             App name, URL scheme, bundle IDs (bd.edu.diu.transport), camera/notification permissions
├── eas.json             Expo build profiles: preview (APK) and production
├── metro.config.js      Lets the bundler read ../../shared, which sits outside this folder
├── tsconfig.json        TypeScript settings (extends Expo's)
├── package.json         Dependencies and scripts (start, android, ios, typecheck, bundle:android)
├── package-lock.json    Exact dependency versions for this app
├── .env.example         EXPO_PUBLIC_API_URL placeholder
├── app/
│   ├── _layout.tsx      Root: query cache, theme; sends signed-out people to login, supervisors to the scanner
│   ├── (tabs)/
│   │   ├── _layout.tsx  Bottom tab bar: My Bus, Live Route, My Card, Notification
│   │   ├── index.tsx    My Bus
│   │   ├── live.tsx     Live Route
│   │   ├── card.tsx     My Card
│   │   └── notifications.tsx  Notification
│   ├── schedule.tsx     Today's bus schedule
│   ├── support.tsx      Help / complaints
│   ├── about.tsx        About
│   ├── login.tsx        Sign-in
│   └── scan.tsx         Supervisor scanner
└── src/
    ├── components/ui.tsx  Theme (light/dark), text, card, button, bus chip, segmented toggle
    └── lib/
        ├── api.ts       API client; refresh token in the phone's secure keystore, access token in memory
        ├── auth.tsx     Signed-in person, sign-in/sign-out
        ├── push.ts      Registers for push notifications (Expo push → FCM/APNs)
        └── qr.ts        Rotating boarding QR token (same algorithm as the API)
```

## Privacy

The rider's own location never leaves the phone: the live map only downloads bus positions. Riders see buses on their route only while a trip is running.
