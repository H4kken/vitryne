# vitryne-cloud

Where Vitryne projects live and how it is served: the Supabase backend and the web image.

| Folder | What |
|---|---|
| [supabase/](supabase/) | The schema (`migrations/`: projects, parts bucket, row-level security, limits, anonymous drafts), the `clean-anonymous` Edge Function, the email templates, and `config.toml` for the local stack. |
| [deploy/](deploy/) | The `web` image (Caddy serving the editor, migrations at start), published with each release as `ghcr.io/h4kken/vitryne-web`; the plug-and-go `docker-compose.yml` that runs it, and `docker-compose.build.yml` to build it from a checkout; `smoke.sh` checks the image. |
| [dev/](dev/) | Everything in Docker for contributors: the editor built from the checkout and a local Supabase (the CLI's images and settings, a Caddy gateway in place of Kong, Mailpit, Studio); `make stack`. Demo keys, localhost only. |
| [tests/](tests/) | Backend tests (RLS, accounts, cleanup, thumbnails) and `browser.mjs`, which drives real Chrome. |

How it fits together, privacy and self-hosting: [docs/CLOUD.md](../../docs/CLOUD.md).

## Run and check

From the repository root:

```sh
make dev                     # the editor against the local Supabase stack (Docker), started if needed
make cloud-test              # the web image's smoke test, then the backend tests (Docker)
make stack                   # everything in Docker: the editor from this checkout + a local Supabase
make stack-test              # the backend tests against it
docker compose -f packages/vitryne-cloud/deploy/docker-compose.yml up -d           # self-host the latest release
docker compose -f packages/vitryne-cloud/deploy/docker-compose.yml \
  -f packages/vitryne-cloud/deploy/docker-compose.build.yml up -d --build          # ... or this checkout
```

The Supabase CLI is pinned in [vitryne-web](../vitryne-web/): `pnpm run supabase …` there uses
this folder as its workdir (Studio on :54323, emails on :54324). A schema change is a new file
in `supabase/migrations/` (`pnpm run supabase migration new <name>`), tested with
`pnpm run supabase db reset` and `make cloud-test`.

Never send telemetry or an identifier that counts people (docs/CLOUD.md, Privacy).

## Who to ask

Mathis Grimberg, the maintainer; open an issue on [GitHub](https://github.com/H4kken/vitryne/issues).
