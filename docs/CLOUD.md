# Cloud storage and self-hosting

Vitryne works with no backend at all: the editor is static files, and projects live on the
person's disk. A backend adds **accounts** and **cloud storage** for projects. The backend is a
**Supabase project**: hosted by Supabase, or one you run. This page covers both modes, the design,
running the editor, and developing against a backend.

[Two modes](#two-modes) · [Running the editor](#running-the-editor) ·
[Setting up the backend](#setting-up-the-backend) · [Developing](#developing) ·
[Accounts](#accounts) · [Storage](#storage) · [Security](#security) · [Privacy](#privacy) ·
[Checking](#checking) · [Not done yet](#not-done-yet)

## Two modes

| | Local mode | Cloud mode |
|---|---|---|
| When | No `config.json` next to `index.html` | `config.json` names a Supabase project |
| Network | The app and its assets only | Also sign-in and cloud storage, **only when the person uses them** |
| Accounts | None | Optional; never needed to design, save to disk or export |
| Telemetry | None | None |

**One build serves both.** At start the editor fetches `config.json`:

```json
{ "backend": { "url": "https://abcd.supabase.co", "publishableKey": "sb_publishable_…" }, "privacyPolicy": "/privacy.html" }
```

Absent, not JSON (a static host answering with `index.html`), or incomplete: local mode. The web
image writes it from `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; any other static host can
serve the file itself. The publishable key (Supabase's replacement for the anon key) only ever
goes in the `apikey` header; a signed-in person's token goes in `Authorization`. In cloud mode the Supabase client (`app/src/cloud/supabase.ts`, 57 KB gzipped) is a
separate chunk, loaded only when the person uses a cloud feature or already has a session from an
earlier visit; local mode never downloads it.

The browser talks to Supabase directly (another origin): Supabase answers with CORS headers, and
a CORS fetch is allowed under the editor's cross-origin isolation (COEP).

## Running the editor

Plug and go, like Twenty's self-hosting: one container.

```sh
docker compose -f deploy/docker-compose.yml up -d --build    # then open http://localhost:8000
```

`deploy/docker-compose.yml` runs one service, `web`: Caddy serving the editor with its isolation
headers (`deploy/web/`). It builds the editor from this checkout (target `from-source`: wasm, the
examples and their SDFs on the CPU, the Vite build): ~10 GB of Docker disk, ~4 GB of memory and
10-20 minutes the first time; later builds reuse what didn't change. **To update:** `git pull`,
then the same command.

With no settings it is local mode. Settings go in `deploy/.env` (copy `.env.example`; every line
is optional):

| Setting | What |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Cloud mode: the project's URL and publishable key (`sb_publishable_…`, Project Settings, API Keys). **Never a secret key**: the browser gets these. |
| `SUPABASE_DB_URL` | Optional: the container applies `supabase/migrations/` at start, like Twenty's server does. Use the project's *Session pooler* connection string (on the free plan the direct one is IPv6 only). Without it, run `pnpm run supabase db push` after a schema change. |
| `SITE_ADDRESS`, `HTTP_PORT`, `HTTPS_PORT` | `:80` behind a proxy (Coolify, Traefik, nginx) or locally; a domain name (`vitryne.example.org`, with ports 80 and 443) and Caddy gets the HTTPS certificate itself. |
| `OPERATOR_NAME`, `OPERATOR_CONTACT`, `OPERATOR_HOSTING` | Shown in the privacy policy at `/privacy.html` (GDPR: who runs the service, how to reach them, where the data is). |

The migrations at start record what they applied where the Supabase CLI does
(`supabase_migrations.schema_migrations`), so they and `supabase db push` never apply anything
twice.

**A server too small to build:** build on your machine and copy the image over, no registry:

```sh
(cd app && pnpm run build) && docker build --platform linux/amd64 -f deploy/web/Dockerfile --target from-dist -t vitryne-web .
docker save vitryne-web | ssh you@server docker load
ssh you@server 'cd vitryne && docker compose -f deploy/docker-compose.yml up -d --no-build'
```

**On Coolify:** create a *Docker Compose* resource from this repository's
`deploy/docker-compose.yml`, give the `web` service your domain (port 80), keep
`SITE_ADDRESS=:80` (Coolify's proxy does HTTPS), and set the variables above.

## Setting up the backend

On a hosted Supabase project (pick an EU region; the free plan pauses an inactive project and
has no backups, so use Pro for a public instance):

1. **Schema:** set `SUPABASE_DB_URL` for the web container, or from `app/`:
   `pnpm run supabase link --project-ref <ref>` then `pnpm run supabase db push`.
2. **Authentication, Sign In / Providers:** allow anonymous sign-ins and manual linking (an
   anonymous user becomes an account); Email on with *Confirm email* on; minimum password
   length 8. **Google** (optional): an OAuth client in the Google Cloud console (*Web
   application*, authorized redirect URI `https://<ref>.supabase.co/auth/v1/callback`), its ID and
   secret here. The editor shows *Continue with Google* only when it is on.
3. **Authentication, Emails:** connect an SMTP provider (Supabase's own sender only reaches the
   project's team, a few emails an hour; Resend or Brevo have free tiers), and paste
   `supabase/templates/*.html` into *Confirm signup*, *Change email address* and *Reset password*
   (subject: "Your Vitryne code"). They show the 6-digit code; the defaults show a link.
4. **Authentication, URL configuration:** the site URL and the redirect URLs are the editor's
   address (Google comes back there).
5. **Limits** (optional): `update vitryne_private.limits set quota_bytes = …, max_projects = …,
   max_anonymous_projects = …, anonymous_days = …;` in the SQL editor. Parts are capped at 50 MB
   each, the free plan's file limit.
6. **Stale anonymous users:** deploy the cleanup function and give pg_cron its address and a
   secret (the migration schedules the daily call; it does nothing until both are in Vault):

   ```sh
   secret=$(openssl rand -hex 32)
   pnpm run supabase functions deploy clean-anonymous --no-verify-jwt
   pnpm run supabase secrets set CLEANUP_SECRET=$secret
   ```

   then in the SQL editor:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'vitryne_functions_url');
   select vault.create_secret('<the same secret>', 'vitryne_cleanup_secret');
   ```

   Check it with `select vitryne_private.clean_anonymous();` and the function's logs.

Self-hosting Supabase too: Supabase's own Docker setup or Coolify's Supabase template, then the
same steps (the settings are environment variables there, `GOTRUE_*`).

## Developing

Like Twenty's local setup: the app runs natively, its backend in Docker.

```sh
cd app
pnpm run dev:cloud        # starts the local Supabase stack if needed, then the editor in cloud mode
```

The local stack (`supabase/config.toml`, started by the Supabase CLI pinned in `app/`) is
Postgres, Auth, the REST API, Storage and Edge Functions (`supabase/functions/`, served as they are
edited; the cleanup secret is `local-cleanup-secret`), plus:

- **Studio**, the Supabase dashboard: http://127.0.0.1:54323
- **Mailpit**, every email Auth sends (the codes): http://127.0.0.1:54324
- Postgres on `127.0.0.1:54322` (user and password `postgres`) for your own SQL tools.

It applies `supabase/migrations/` on start; `pnpm run supabase db reset` starts the database over.
Realtime and analytics are off (the editor uses neither). The first start
downloads ~4 GB of images. `pnpm run supabase stop` stops it.

Against any other project (your hosted one, say): put `SUPABASE_URL=…` and
`SUPABASE_PUBLISHABLE_KEY=…` in `app/.env.local` (git-ignored), then `pnpm run dev`. The dev
server says `cloud: on` or `cloud: off` when it starts. `deploy/.env` is only for the container.
For Google sign-in in development, add `http://localhost:5173` to the project's redirect URLs.

**A schema change** is a new file in `supabase/migrations/` (`pnpm run supabase migration new
<name>`), tested locally with `db reset` and `tests/cloud/`, then pushed (or applied by the web
container at its next start).

## Accounts

**No sign-up wall.** The first time someone chooses *Save to the cloud*, Auth creates an
**anonymous user** (rate-limited per IP). Their projects are tied to that browser's session. The
editor then offers an account, for what it adds: opening the projects on another device, and
keeping them if the browser's data is cleared.

**Email and password, or Google.**

- **Create an account:** email and password (8 characters or more). The email gets the current
  user (anonymous, or a new anonymous one), confirmed by a **6-digit code** sent to it
  (`updateUser({ email })` → `verifyOtp` type `email_change`), then the password is set. The
  **same user** becomes the account: same id, same projects.
- **Sign in:** email and password. **Forgot password:** a code by email (`resetPasswordForEmail`
  → `verifyOtp` type `recovery`), then a new password.
- **Codes, not links,** in every email: a link opens another tab or a redirect, and could lose
  unsaved work. The code is typed in the dialog.
- **Google** (when the project has it on): a redirect, PKCE flow. Unsaved changes are asked
  about first (the usual *Save your changes?*). An anonymous user is **linked** to the Google
  identity (same user, same projects); a cloud project that was open reopens on return. If that
  Google account already has a Vitryne account, the editor says so on return and offers to sign
  in to it instead.

**Reaching an existing account from an anonymous session** (signing in, an email already taken,
or a Google account that has one): the editor keeps the anonymous session's token (across the
Google redirect, in `sessionStorage`), signs in, copies each anonymous project to the account
(`moveProjects` in `app/src/cloud/projects.ts`), then deletes the anonymous user. A project that
fails to copy stays with the anonymous user, which is then kept.

## Storage

As [FORMAT.md](FORMAT.md#cloud-storage) planned: **the same format on disk and in the cloud.**

- **A project is a row** in `public.projects`: owner, name, the file's `manifest.json` (as
  `jsonb`), total size, a `revision`, timestamps.
- **Each part is an object** in the private `parts` bucket, named `<owner id>/<sha256>`. Parts
  never change (there is no update policy): a name always means the same bytes.
- **A save** asks the worker for the folder form, checks each part against its hash, uploads the
  parts the backend doesn't have (it asks first, so the avatar shared by all of a person's projects
  is uploaded once), then writes the row. An interrupted save leaves the previous manifest whole.
  A fabric change uploads one small JSON part and the row.
- **A save names the revision it started from.** If the project was saved from another tab or
  browser since, nothing changes and the editor says so (*Save a copy to the cloud* keeps both).
- **An open** downloads the manifest's parts and checks every hash before the worker sees them.
- **A download is an export:** the parts zipped as a `.vtry` (`app/src/cloud/zip.ts`, stored
  entries, `mimetype` first), which Rust opens like any file.
- **Unused parts** (no project of the person's lists them, and older than a day, since another
  tab may be mid-save) are deleted after each save.

**Deduplication is per person, not across people.** Sharing a part between people by hash would
let anyone who knows (or guesses) a hash read the part, or plant wrong bytes under someone else's
hash. Per-person names cost one avatar (~0.5 MB) per person, and nothing per project.

## Security

Row-level security on everything a client can reach (`supabase/migrations/`):

| What | Who | How |
|---|---|---|
| `projects` rows | their owner | `owner = auth.uid()` for select, insert, update, delete; `owner`, `id`, `revision`, dates are server-kept (column grants and a trigger) |
| `parts` objects | their owner | the first path segment is `auth.uid()`; names must be `<uuid>/<64 hex>`; no updates |
| `my_usage`, `my_unused_parts`, `delete_my_account` | signed-in users, about themselves | functions on `auth.uid()`, not callable by `anon` |
| `stale_anonymous_users` | the service role only | what `clean-anonymous` deletes |
| `clean-anonymous` (Edge Function) | pg_cron | refuses any call without the `x-cleanup-secret` header |
| `vitryne_private.*` (limits, helpers) | nobody | not in the API's schemas, no grants |

**Limits** (`vitryne_private.limits`): bytes per person (a new part is refused once the quota is
reached, so the overshoot is at most one part) and projects per person: `max_projects` for an
account, `max_anonymous_projects` (1, their draft) for an anonymous user. The trigger checks the
user's state, not the token's, so a user who just became an account gets the account's limit. The
bucket caps each part at 50 MB. The quota counts the person's objects, not what the client
reports.

**Stale anonymous users** (no sign-in, token refresh or save for `anonymous_days`, 30 by default)
are deleted once a day: pg_cron calls `vitryne_private.clean_anonymous()`, which posts to the
`clean-anonymous` Edge Function with the secret kept in Vault; the function deletes their parts
through the Storage API (SQL can't remove the files), then the user, which takes the draft with
it. A user whose parts fail to go is kept for the next run.

**Keys:** the editor only ever gets the anon (publishable) key, which grants nothing without a
user. The service-role key and the database password stay with the operator.

**Tests** (`tests/cloud/rls.test.mjs`): with two anonymous users A and B, B can't read, list,
change, delete or forge A's projects, and can't read, list, upload into, overwrite or delete A's
parts; the anon key alone reaches nothing; parts are immutable and must be named by their hash;
the server keeps owner, dates and revision, and a stale revision changes nothing; the quota and
the project limit refuse; an anonymous user keeps one draft and an account several; account deletion is refused while parts remain, then removes the user
and their projects and leaves B alone. `tests/cloud/cleanup.test.mjs`: the cleanup function
refuses a call without its secret, deletes an anonymous user idle for 31 days with their draft
and parts, and keeps one idle for 29 days and an idle account.

## Privacy

- **Local mode:** no accounts, no telemetry, no network calls except loading the app and its
  assets (`config.json` included).
- **Cloud mode:** network calls only for features the person uses (cloud save and open, sign-in),
  never telemetry. Saving to disk and exporting never need an account.
- **Storage in the browser:** the cloud session (`localStorage`, `vitryne-cloud-session`), only
  once the person used a cloud feature. It is needed for the feature they asked for, so it needs
  no consent under ePrivacy art. 5(3). The recovery copy and the SDF cache stay local as before.
- **Growth metrics: none in the browser.** No identifier is stored or sent to count people, so
  nothing needs a consent banner. The operator counts from the database: accounts (anonymous and
  with email), projects, storage used, sign-ups per day. Adding anything that tracks visitors
  would need consent first.
- **GDPR rights in the editor:** *Download all my data* (every project as a `.vtry` and an
  `account.json`: art. 15 and 20), *Delete my account* (parts through the storage API so the files
  go too, then the user and their projects: art. 17). Correction or objection: by email to the
  operator.
- **Privacy policy:** `deploy/web/privacy.html`, at `/privacy.html` with the operator's details,
  linked from the account dialog. A draft to review for each instance. On hosted Supabase,
  Supabase processes the data for the operator: sign its DPA, and say so in the policy.

## Checking

No CI, so documented checks instead:

```sh
node --test 'tests/cloud/*.test.mjs'     # the backend: RLS, accounts and the cleanup function, on
                                         # the local stack (or SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
                                         # MAILPIT_URL, CLEANUP_SECRET)
deploy/smoke.sh                          # the web image (built from this machine's app/dist):
                                         # local mode, then cloud mode on the local stack with
                                         # migrations at start, then the tests above
node tests/cloud/browser.mjs cloud <url> # real Chrome: A saves anonymously and creates an account;
                                         # B (a fresh profile) signs in and opens the project
node tests/cloud/browser.mjs local <url> # no backend: every request stays on the app's origin
```

## Not done yet

- **A refactor before the MVP release** (see PROGRESS.md, M12): the account emails (codes or
  links), a trimmed `supabase/config.toml`, versioning the web image.
- **Google sign-in is untested end to end:** it needs an OAuth client; the redirect, the linking
  of an anonymous user and the return handling were written against Supabase's API but not run.
- **Changing the account's email** in the editor (Auth supports it; write to the operator for now).
- **Sharing and workspaces:** later; nothing in the schema prevents them.
