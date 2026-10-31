---
title: "Cloud backend"
icon: Cloud
description: "How accounts, projects and storage work in the backend: the design, security, privacy and tests."
---

**In short:** projects live in a Supabase project (accounts, a projects table, a storage bucket)
and the editor is static files in front of it. To run it yourself, read [Self-hosting](/self-hosting);
[Running the editor](#running-the-editor) and [Setting up the backend](#setting-up-the-backend) here
list the files, and [Developing](#developing) is how to work on it locally.

Like Figma or Canva, projects live in the cloud and save by themselves; nothing is saved to disk.
The editor is static files plus a backend, a **Supabase project** (hosted by Supabase, or one you
run), which holds **accounts** and **projects**. Anyone can try the editor without an account: their
work is kept as one draft. A free account keeps every project, opens them anywhere, and exports.
This page covers the design and developing against a backend; running one is in [Self-hosting](/self-hosting).

[The backend](#the-backend) · [Running the editor](#running-the-editor) ·
[Setting up the backend](#setting-up-the-backend) · [Developing](#developing) ·
[Accounts](#accounts) · [Storage](#storage) · [Security](#security) · [Privacy](#privacy) ·
[Checking](#checking) · [Not done yet](#not-done-yet)

## The backend

|                     |                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Where it's named    | `config.json` next to `index.html` (no usable file: the editor says the instance has no backend) |
| Network             | The app and its assets; the backend when the person saves, opens or signs in                     |
| Without an account  | Everything but export; one project, the draft, autosaved                                         |
| With a free account | Every project, on any device; export (glTF, OBJ, DXF); duplicate                                 |
| Telemetry           | None                                                                                             |

**One build serves every instance.** At start the editor fetches `config.json`:

```json
{
  "backend": {
    "url": "https://abcd.supabase.co",
    "publishableKey": "sb_publishable_…"
  },
  "privacyPolicy": "",
  "termsOfService": ""
}
```

Absent, not JSON (a static host answering with `index.html`), or incomplete: the editor shows a page
saying the instance has no backend, and stops there. The web image writes the file from
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; any other static host can serve it itself. The
publishable key (Supabase's replacement for the anon key) only ever goes in the `apikey` header; a
signed-in person's token goes in `Authorization`. The Supabase client
(`packages/vitryne-web/src/cloud/supabase.ts`, 57 KB gzipped) is a separate chunk, loaded at the
first save or open, or at start when the browser has a session from an earlier visit: trying an
example doesn't download it.

The browser talks to Supabase directly (another origin): Supabase answers with CORS headers, and
a CORS fetch is allowed under the editor's cross-origin isolation (COEP).

## Running the editor

How to run Vitryne yourself (the editor with its own backend, five containers, or one container with a
Supabase project of yours), HTTPS, settings, updates and backups: [Self-hosting](/self-hosting). The
files are in `packages/vitryne-cloud/deploy/`:

- `docker-compose.selfhost.yml` and `setup.sh`: the editor with its own backend. `web/Caddyfile.selfhost`
  puts the services under `/auth/v1`, `/rest/v1` and `/storage/v1` behind one address, like the Kong of
  a Supabase project; `web/cleanup.sh` is the daily cleanup of stale drafts (the counterpart of the
  `clean-anonymous` function). `smoke-selfhost.sh` tests it.
- `docker-compose.yml`: the editor alone, with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` of a project
  you name. `smoke.sh` tests it.
- `docker-compose.build.yml`: an override that builds the web image from the checkout.

## Setting up the backend

For a Supabase project (anonymous sign-ins, email and password, SMTP, redirect URLs, limits, the cleanup
function): [With your own Supabase project](/self-hosting/supabase#set-up-the-supabase-project). The
bundled backend of `docker-compose.selfhost.yml` sets all of that itself.

## Developing

Like Twenty's local setup: the app runs natively, its backend in Docker.

```sh
make dev                  # starts the local Supabase stack if needed, then the editor against it
make dev ARGS=--local     # the same, even when packages/vitryne-web/.env.local names another
                          # backend (tests)
make dev-app              # the dev server alone: the bench page, no backend
```

The local stack (`packages/vitryne-cloud/supabase/config.toml`, started by the Supabase CLI pinned
in `packages/vitryne-web/`; run `pnpm run supabase …` there) is Postgres, Auth, the REST API,
Storage and Edge Functions (`packages/vitryne-cloud/supabase/functions/`, served as they are edited;
the cleanup secret is `local-cleanup-secret`), plus:

- **Studio**, the Supabase dashboard: http://127.0.0.1:54323
- **Mailpit**, every email Auth sends (the codes): http://127.0.0.1:54324
- Postgres on `127.0.0.1:54322` (user and password `postgres`) for your own SQL tools.

It applies `packages/vitryne-cloud/supabase/migrations/` on start; `pnpm run supabase db reset`
starts the database over. Realtime and analytics are off (the editor uses neither). The first start
downloads ~4 GB of images. `pnpm run supabase stop` stops it.

Against any other project (your hosted one, say): put `SUPABASE_URL=…` and
`SUPABASE_PUBLISHABLE_KEY=…` in `packages/vitryne-web/.env.local` (git-ignored), then `make dev`; it
uses that one instead of starting the local stack. **Tests never run against it**: use
`ARGS=--local`. The dev server says which backend it serves when it starts.
`packages/vitryne-cloud/deploy/.env` is only for the container. For Google sign-in in development,
add `http://localhost:5173` to the project's redirect URLs.

**A schema change** is a new file in `packages/vitryne-cloud/supabase/migrations/` (`pnpm run
supabase migration new
<name>`), tested locally with `db reset` and `packages/vitryne-cloud/tests/`, then pushed (or applied by the web
container at its next start).

## Accounts

**No sign-up wall.** Anyone can try everything but export. Their first edit (an import counts;
opening an example doesn't) makes an **anonymous user** (rate-limited per IP), and their work is
kept as **one draft**, autosaved, tied to that browser's session. Starting another project asks
first: it replaces the draft as soon as it is changed, unless they create an account.

**A free account** keeps every project, opens them on any device, exports (glTF, OBJ, DXF), and
duplicates. Export and Duplicate open the account dialog with the reason, and go on once there
is an account. The database enforces the draft limit (`max_anonymous_projects`, Security), not
just the editor. An anonymous user nobody came back to is deleted after `anonymous_days` (30),
with their draft.

**Email and password, or Google.**

- **Email first, like most sign-in screens:** Google or an email address, then the password on a
  second screen. The editor never looks up whether an address has an account (that would tell
  anyone which emails are registered), so the person picks _Create account_ or _Sign in_; creating
  with an address that has one moves to signing in.
- **Create an account:** email and password (8 characters or more), both given to the current
  user (anonymous, or a new anonymous one) at once (`updateUser({ email, password })`). Auth
  emails a **link** that confirms the address; until it is opened the user stays anonymous and
  the password doesn't sign in. The dialog says _Check your email_ and waits: every few seconds,
  and whenever the tab comes back to the front, it asks Auth whether the user is an account now
  (`getUser`), then refreshes the session (`watchConfirmation`, for the hour the link works). The
  link can be opened anywhere (another tab, a phone): this tab keeps its work and notices. A tab
  the link opens in this browser is signed in too. The **same user** becomes the account: same
  id, the draft is now one of its projects. _Send it again_ resends the link (`resend` type
  `email_change`).
- **Sign in:** email and password. **Forgot password:** a link by email (`/auth/v1/recover`,
  without PKCE so the link works on any device). The tab asking says _Check your email_ and keeps
  its work; the link opens the editor signed in to the account (the session in the URL, taken
  out before Auth's client sees it), whose account dialog asks for the new password. An anonymous
  user that browser had moves its projects to the account, as at sign-in.
- **The page that asked never leaves:** the links open in another tab or device, so no redirect
  can lose work not saved yet.
- **Google** (when the project has it on): a redirect, PKCE flow. What is waiting is saved first
  (or the person decides, if it can't be). An anonymous user is **linked** to the Google identity
  (same user, same projects); a project that was open reopens on return. If that Google account
  already has a Vitryne account, the editor says so on return and offers to sign in to it
  instead.

**Reaching an existing account from an anonymous session** (signing in, an email already taken, or a
Google account that has one): the editor keeps the anonymous session's token (across the Google
redirect, in `sessionStorage`), signs in, copies the draft to the account (`moveProjects` in
`packages/vitryne-web/src/cloud/projects.ts`; an open draft follows its new id and keeps saving),
then deletes the anonymous user. A draft that fails to copy stays with the anonymous user, which is
then kept.

## Storage

As [File format](/developers/file-format#cloud-storage) planned: **the same format on disk and in the cloud.**

- **A project is a row** in `public.projects`: owner, name, the file's `manifest.json` (as
  `jsonb`), total size, a `revision`, timestamps, and its thumbnail's hash.
- **A thumbnail** is a small image of the drape (480×360 WebP, JPEG where the browser can't
  encode WebP) for the project's card on the start screen. The editor takes it once per drape,
  after a few simulated seconds, from the garment's own camera, and stores it as a part named by
  its hash; the row's `thumbnail` names it. It follows the drape, not the document: naming it is
  not an edit (the revision and `updated_at` stay), and a `.vtry` doesn't carry it. Duplicating
  or moving a project keeps it.
- **Each part is an object** in the private `parts` bucket, named `<owner id>/<sha256>`. Parts
  never change (there is no update policy): a name always means the same bytes.
- **A save** asks the worker for the folder form, checks each part against its hash, uploads the
  parts the backend doesn't have (it asks first, so the avatar shared by all of a person's projects
  is uploaded once), then writes the row. An interrupted save leaves the previous manifest whole.
  A fabric change uploads one small JSON part and the row.
- **A save names the revision it started from.** If the project was saved from another browser
  since, nothing changes and the editor asks: open the other version, or keep this one (an
  account keeps it as a copy).
- **Autosave** (`packages/vitryne-web/src/cloud/autosave.ts`): about 2 s after the last edit Rust
  accepted, and when the tab is hidden. A new project is made at the first edit (an import counts),
  not when an example is merely opened; an anonymous user's new project goes over their draft. A
  failed save is retried (5 s, doubling, up to a minute) while the recovery copy keeps the changes
  in the browser; at the next start a copy nobody saved over since is put back and saved.
- **One tab per project** in a browser (Web Locks, `packages/vitryne-web/src/cloud/lock.ts`): a
  second tab asks before taking the project over, and the first is told.
- **An open** downloads the manifest's parts and checks every hash before the worker sees them.
- **Downloading:** _Export… → Project (.vtry)_, or a card's menu, saves one project as a file (an
  account); _Download all my data_ (Privacy) zips every project as a `.vtry`
  (`packages/vitryne-web/src/cloud/zip.ts`, stored entries, `mimetype` first). Rust opens either
  like any file.
- **Unused parts** (no project of the person's lists them or names them as its thumbnail, and
  older than a day, since another tab may be mid-save) are deleted after each save.

**Deduplication is per person, not across people.** Sharing a part between people by hash would
let anyone who knows (or guesses) a hash read the part, or plant wrong bytes under someone else's
hash. Per-person names cost one avatar (~0.5 MB) per person, and nothing per project.

## Security

Row-level security on everything a client can reach (`packages/vitryne-cloud/supabase/migrations/`):

| What                                               | Who                               | How                                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects` rows                                    | their owner                       | `owner = auth.uid()` for select, insert, update, delete; `owner`, `id`, `revision`, dates are server-kept (column grants and a trigger); `thumbnail` must be a sha256 |
| `parts` objects                                    | their owner                       | the first path segment is `auth.uid()`; names must be `<uuid>/<64 hex>`; no updates                                                                                   |
| `my_usage`, `my_unused_parts`, `delete_my_account` | signed-in users, about themselves | functions on `auth.uid()`, not callable by `anon`                                                                                                                     |
| `stale_anonymous_users`                            | the service role only             | what `clean-anonymous` deletes                                                                                                                                        |
| `clean-anonymous` (Edge Function)                  | pg_cron                           | refuses any call without the `x-cleanup-secret` header                                                                                                                |
| `vitryne_private.*` (limits, helpers)              | nobody                            | not in the API's schemas, no grants                                                                                                                                   |

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

**Tests** (`packages/vitryne-cloud/tests/rls.test.mjs`): with two anonymous users A and B, B can't
read, list, change, delete or forge A's projects, and can't read, list, upload into, overwrite or
delete A's parts; the anon key alone reaches nothing; parts are immutable and must be named by their
hash; the server keeps owner, dates and revision, and a stale revision changes nothing; the quota
and the project limit refuse; an anonymous user keeps one draft and an account several; account
deletion is refused while parts remain, then removes the user and their projects and leaves B alone.
`packages/vitryne-cloud/tests/cleanup.test.mjs`: the cleanup function refuses a call without its
secret, deletes an anonymous user idle for 31 days with their draft and parts, and keeps one idle
for 29 days and an idle account.

## Privacy

- **Network:** the app and its assets (`config.json` included), and the backend only when the
  person saves, opens or signs in (a Google account's picture is loaded from Google when the account
  dialog opens, without a referrer). Never telemetry. Opening an example without changing it sends
  nothing.
- **Without an account:** an anonymous user (an id, no email) and their draft, deleted 30 days
  after their last visit. The privacy page says so.
- **Storage in the browser:** the session (`localStorage`, `vitryne-cloud-session`), from the
  first save or sign-in, and the recovery copy (IndexedDB, what hasn't reached the backend yet).
  Both are needed for the feature the person uses, so they need no consent under ePrivacy art.
  5(3). The SDF cache stays local as before.
- **Growth metrics: none in the browser.** No identifier is stored or sent to count people, so
  nothing needs a consent banner. The operator counts from the database: accounts (anonymous and
  with email), projects, storage used, sign-ups per day. Adding anything that tracks visitors
  would need consent first.
- **GDPR rights in the editor:** _Download all my data_ (every project as a `.vtry` and an
  `account.json`: art. 15 and 20), _Delete my account_ (parts through the storage API so the files
  go too, then the user and their projects: art. 17). Correction or objection: by email to the
  operator.
- **Privacy policy and terms:** the web image serves none: the operator of an instance is the one
  responsible for its users' data, so each publishes their own and sets `PRIVACY_POLICY_URL` and
  `TERMS_URL` on the web container (empty: no link; they show at the foot of the start screen and in the account
  dialog). What the software stores is in this section; `config.json` carries the two links.
  vitryne.app's are in the docs site's _Legal_ section
  (`packages/vitryne-docs/content/docs/legal/`). On hosted Supabase, Supabase processes the data for
  the operator: sign its DPA, and say so in the policy.

## Checking

CI (`make check-ci`) doesn't run these: they need Docker and the local Supabase stack, or a real
browser with a GPU.

```sh
make cloud-test       # the web image (built from this machine's packages/vitryne-web/dist):
                      # refuses to start without a backend, then on the local stack with
                      # migrations at start; then the self-contained stack from its own compose
                      # file (keys, a draft that becomes an account, the stale-draft cleanup);
                      # then the backend tests: RLS, accounts, the cleanup
                      # function and thumbnails (packages/vitryne-cloud/tests/*.test.mjs; on the
                      # local stack, or SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, MAILPIT_URL,
                      # CLEANUP_SECRET)
```

Real Chrome:

```sh
node packages/vitryne-cloud/tests/browser.mjs cloud <url>
    # (`make dev ARGS=--local`): A's edit is autosaved as a draft (offline, then back), a second
    # tab takes it over and back, Export asks for an account, a second example asks before
    # replacing the draft, A creates an account and duplicates; B (a fresh profile) signs in
    # and opens the original
node packages/vitryne-cloud/tests/browser.mjs none <url>
    # a build with no config.json: the no-backend page
```

## Not done yet

- **A refactor before the MVP release**: a trimmed `packages/vitryne-cloud/supabase/config.toml`
  (listed in [PROGRESS.md](https://github.com/H4kken/vitryne/blob/main/docs/PROGRESS.md), under the cloud backend). (The web image is versioned now:
  one image per release, [MAINTAINING.md](https://github.com/H4kken/vitryne/blob/main/docs/MAINTAINING.md#releasing).)
- **A reset button that knows:** an instance without SMTP says "email sent" for a forgotten
  password and sends nothing; the editor should hide the button (or say so) when the instance has
  no mail. Also an invite-only or sign-in-first mode (no anonymous drafts): the editor's account
  creation starts from a draft today.
- **Sharing a project** with someone else, and real-time editing together: the reason projects
  stay in the cloud. Until then one tab edits a project at a time, and another browser's save is
  a conflict the person settles.
- **Changing the account's email** in the editor (Auth supports it; write to the operator for now).
- **Workspaces:** later; nothing in the schema prevents them.
