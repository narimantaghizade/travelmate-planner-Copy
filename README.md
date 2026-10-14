# TravelMate

A responsive travel-planning starter built with React, TypeScript, Vite, Leaflet, OpenStreetMap, and optional Supabase integration.

## Current status

TravelMate supports a **local demo** and a first Supabase data-access path. Without Supabase configuration it includes a dashboard, multiple trips, destination and booking forms, itinerary grouping, map markers and route lines, Google Maps direction links, and an estimated-cost summary. The demo is saved in this browser using `localStorage`.

When Supabase variables are present, the app uses Supabase as its data source and does not write cloud-mode changes to `localStorage`. Email magic-link sign-in uses Supabase Auth; database reads and trip/destination/booking writes go through the typed repository and are subject to RLS. An invitation acceptance UI is implemented and calls the authenticated acceptance RPC, but live acceptance has not been verified end to end. The invitation-creation Edge Function is prepared but not deployed. Private Storage uploads are implemented in the app; verify your project's policies before relying on them. Do not store sensitive booking details until you have verified your own project's policies.

## Requirements

- Node.js 22 or newer
- npm
- Git (for version control)
- A Supabase project only when enabling cloud persistence

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the local URL printed by Vite. You can run the demo without Supabase credentials.

## Build and checks

```bash
npm run build
npm run lint
npm test
```

The test suite covers database conversion, missing-session behavior, and browser-key safety. It does not replace testing against a real Supabase project.

## Supabase database setup

1. Create a new Supabase project.
2. Review `supabase/migrations/0001_initial_schema.sql`. It is for a **new, empty Supabase project**; do not rerun it against an existing database or one where an earlier version was already applied. Prepare a separate upgrade migration for an existing schema.
3. Apply the reviewed migration in the Supabase SQL Editor or with the Supabase CLI. It is not applied by this app.
4. Enable Email authentication and add `http://localhost:5173` (and your deployed origin) to Supabase Auth's allowed redirect URLs.
5. Create `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then restart Vite. Use the project URL and browser-safe publishable/anon key only. Never use a service-role key or database password in a `VITE_*` variable.
6. Sign in with the email link in the app. Create a trip, then verify it in Supabase **Table Editor → public.trips** or with `select id, name, owner_id, created_at from public.trips order by created_at desc;` in SQL Editor.
7. If you have data in this browser's demo, use **Import local data** after signing in. Import is explicit; stable `(owner_id, client_id)` and `(trip_id, client_id)` keys make retries skip rows already imported. The local records remain in the browser.
8. Test with a second, non-member account before treating access controls as production-ready. The migration intentionally disables browser-side membership writes until a secure invitation flow is added.
9. Create a **private** `trip-documents` bucket and implement/test Storage RLS separately before uploading files. The migration creates document metadata only.

Only the Supabase publishable/anon key belongs in browser configuration. Never put a service-role key or database password in `VITE_*` variables.

## GitHub Pages deployment

1. Create a GitHub repository named `travelmate-planner` (or update the base path in `vite.config.ts` to match the exact repository name).
2. Commit and push the project to the `main` branch.
3. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the build and deployment source.
4. In repository **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only after the cloud integration is ready. These are public frontend configuration values, not service-role secrets.
5. Push to `main` or manually run the workflow under **Actions**.
6. Open the Pages URL shown by GitHub Actions.

For email-link sign-in and invitation acceptance, add the app callback URLs to **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**. For the GitHub Pages project site, use `https://<owner>.github.io/travelmate-planner/` (replace `<owner>` with the repository owner's GitHub username). For local development, allow `http://localhost:5173/` as well. The deployed URL must match the repository Pages path; this documentation does not mean the live allowlist is configured.

GitHub Pages hosts static frontend files only. It does not provide a database, authentication backend, or private file storage.

## Maps and routing

- Map tiles use OpenStreetMap contributors and require attribution.
- Current route lines connect saved markers in order; they are **not** road directions or verified driving routes.
- Google Maps buttons open a destination using its address. The initial demo coordinates are illustrative and should be checked.
- Configure a suitable routing and geocoding provider before relying on road distance, travel time, or automated address lookup. Respect provider usage policies.

## Known limitations

- Trips, destinations, and bookings still use local browser storage until Supabase is configured and the user signs in.
- Invitation acceptance UI is implemented and calls the authenticated `accept_trip_invitation` RPC. Invitation creation and email delivery still require the Edge Function, database prerequisites, and email provider to be deployed/configured. The GitHub Pages and local callback URLs above must be added to the Supabase Auth redirect allowlist. Neither the live allowlist nor end-to-end invitation acceptance is verified by this repository documentation.
- Private document operations require the configured private Storage bucket and policies; verify them against the live project before relying on them.
- Booking records are basic notes, not a complete airline or ticketing integration.
- Flight status, live opening hours, and live exchange rates are not connected.
- Cost display uses EUR as a demo currency.
- Some Paris entries are sample data; replace them with verified addresses and booking details.
