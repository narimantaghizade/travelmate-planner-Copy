# TravelMate: directions from zero to published site

## Step 1 — Get the project running

1. Install Node.js 22 LTS from the official Node.js website.
2. Unzip the project folder.
3. Open the folder in Codex or VS Code.
4. Open a terminal in the project folder and run:

```bash
npm install
npm run dev
```

5. Open the local address printed by Vite, usually `http://localhost:5173`.
6. Try adding a destination, creating a booking, switching between pages, and opening map directions.

The first version saves demo data in this browser only. This is intentional while we configure the cloud safely.

## Step 2 — Create a GitHub repository

1. Sign in to GitHub.
2. Create a new repository named `travelmate-planner`.
3. Do not add a README or license if you already have them in this project.
4. In the project terminal, run:

```bash
git init
git add .
git commit -m "Create TravelMate starter"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/travelmate-planner.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username. If Git is already initialized or a remote exists, inspect it first and do not repeat `git init` or `git remote add` blindly.

## Step 3 — Turn on GitHub Pages

1. Open your repository on GitHub.
2. Go to **Settings → Pages**.
3. Select **GitHub Actions** as the deployment source.
4. Open the **Actions** tab and inspect the deployment workflow.
5. When it succeeds, GitHub will show the public site URL.

The Vite base path is currently configured for a repository named `travelmate-planner`. If you choose another repository name, update `vite.config.ts` before deploying.

## Step 4 — Connect Supabase data access

1. Create a project in Supabase.
2. Open SQL Editor and review `supabase/migrations/0001_initial_schema.sql`. It is designed for a new, empty project; do not rerun it on an existing database.
3. Apply the migration only after reviewing its RLS policies. The app never applies SQL automatically.
4. Enable Email authentication and add these URLs in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**:
   - Local development: `http://localhost:5173/`.
   - GitHub Pages: `https://<owner>.github.io/travelmate-planner/` (replace `<owner>` with the GitHub repository owner's username).

   The deployed callback must include the `travelmate-planner/` repository path. Add the URL for the site you actually use; this guide does not confirm that the live Supabase allowlist has been configured.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env.local`, then restart Vite. Use only a publishable/anon key in frontend config.
6. Sign in using the email link in the app. Create a trip and verify the row in **Table Editor → public.trips** (or query `select id, name, owner_id from public.trips order by created_at desc;`).
7. **Import local data** explicitly if you want to copy this browser's saved demo records. The import is repeatable without duplicate rows and does not delete local data.
8. Browser-side membership writes remain disabled. The app includes an invitation acceptance UI for links with an `invite` query parameter and accepts through the authenticated `accept_trip_invitation` RPC. Invitation creation/email still depends on deploying the Edge Function and configuring its server-side email provider. Test with an invitation link only after those server-side pieces are available.

## Stage 5.3 — prepare the invitation Edge Function

The function verifies the bearer token with Supabase Auth, checks ownership through the existing `is_trip_owner` RPC, checks whether the normalized recipient email already belongs to a trip member through a service-only boolean RPC, writes invitation metadata with a server-only key, and sends mail through Resend. It expires links after seven days and sends no email for an existing valid pending invitation. Invitation attempts are limited to 10 per verified owner in a fixed one-hour window anchored to that owner's first request. Tokens are never returned to the caller or logged.

Before deploying:

1. Review the existing `supabase/config.toml`, install and authenticate the Supabase CLI, then link this folder with `supabase link --project-ref YOUR_PROJECT_REF`. Do not run `supabase init` over the existing configuration.
2. Configure the Edge Function secrets in **Supabase Dashboard → Edge Functions → Secrets** (or with `supabase secrets set`):
   - `APP_URL`: the exact deployed TravelMate URL, including any GitHub Pages repository path, for example `https://YOUR_USER.github.io/travelmate-planner`.
   - `ALLOWED_ORIGINS`: comma-separated exact browser origins, such as `https://YOUR_USER.github.io,http://localhost:5173`.
   - `RESEND_API_KEY`: a Resend API key with permission to send mail.
   - `EMAIL_FROM`: a sender address verified with Resend, such as `TravelMate <trips@YOUR_VERIFIED_DOMAIN>`.
3. Review and manually apply `supabase/migrations/0007_trip_invitation_server_guards.sql` before deployment. It adds two `SECURITY DEFINER` functions executable only by `service_role` and a private rate-limit table. The member lookup returns only a boolean for the supplied trip/email pair. The limiter allows 10 requests per owner in a fixed one-hour window and serializes concurrent requests with an atomic upsert. It fails closed if the function/table is missing or unavailable. This migration has not been applied or tested against the live project by this code change.
4. Supabase injects `SUPABASE_URL` and its named publishable/secret API-key maps into Edge Functions. This function reads the legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` names or the `default` entries from `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`. Confirm the default keys are configured for the project. Never place the service-role/secret key in `.env.local`, frontend `.env.example`, a `VITE_*` variable, or client code.
5. Deploy only after reviewing the code, applying and verifying migration 0007, and completing email-provider/domain setup:

   ```bash
   supabase functions deploy create-trip-invitation --project-ref YOUR_PROJECT_REF
   ```

6. Keep any local Edge secrets in `supabase/functions/.env`; that file is git-ignored. Do not commit it. Supabase CLI can load it for local serving with `supabase functions serve create-trip-invitation`.

Do not deploy the function until migration 0007 is applied: both the existing-member check and persistent limiter use its service-only RPCs. A valid pending invitation is preserved and duplicate concurrent inserts return a conflict. A provider rejection is reported as confirmed failure; the function attempts to revoke that invitation. If cleanup fails or cannot be confirmed, the response says manual cleanup is required. A timeout, network error, or provider 5xx is treated as uncertain delivery and leaves the invitation pending. In that case, check Resend delivery status before retrying. There is no self-service revocation/recovery endpoint; an authorized operator must revoke an invitation through a trusted server/admin operation before retrying. Do not remove the rate limiter without replacing it with an equivalently durable control.

The endpoint accepts `POST` JSON `{ "tripId": "...", "email": "...", "role": "editor" | "viewer" }` with the signed-in user's Bearer token. It rejects extra fields, including caller IDs and redirect URLs. Success returns `{ "ok": true, "expiresAt": "..." }`; it never returns the token. The invitation acceptance UI is implemented in the frontend; the Share UI and live end-to-end invitation flow remain unverified.

## Step 5 — Ask Codex to continue implementation

Use this prompt in Codex after connecting and verifying the database:

"Continue the existing TravelMate project. Implement a secure owner-only invitation flow for trip_members and private Supabase Storage upload/download/delete with verified Storage RLS. Never expose service-role keys. Add live-project tests for owner/editor/viewer access, non-member isolation, and storage policies. Preserve the current UI and local demo path. Update README and run build, lint, and tests. Do not claim shared trips or secure uploads until verified."

## Safety note

Until the migrations and RLS behavior have been verified against your Supabase project, treat the site as a prototype. The invitation acceptance UI exists, but the invitation creation/email function is not deployed and end-to-end shared-trip behavior is unverified. Private uploads depend on the configured private bucket and Storage policies. Do not enter sensitive ticket QR codes, booking references, accommodation access codes, or private host information.
