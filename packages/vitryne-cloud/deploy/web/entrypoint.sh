#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The web image's start: refuse without a backend (projects are saved there); when
# SUPABASE_DB_URL is set, apply the migrations in
# packages/vitryne-cloud/supabase/migrations that the database doesn't have yet (each in one
# transaction), recording them where the Supabase CLI does, so `supabase db push` and this
# agree. Then serve.
set -eu

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  echo "web: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are needed: projects are saved to that backend (docs/CLOUD.md)" >&2
  exit 1
fi

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  psql_() { psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc -q "$@"; }
  psql_ -c "create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
  for f in /srv/migrations/*.sql; do
    [ -e "$f" ] || continue
    base=$(basename "$f" .sql)
    version=${base%%_*}
    name=${base#*_}
    case "$version" in *[!0-9]*) echo "migrate: skipping $f (no version)" >&2; continue ;; esac
    if [ "$(psql_ -tAc "select 1 from supabase_migrations.schema_migrations where version = '$version'")" = 1 ]; then continue; fi
    echo "migrate: applying $base"
    psql_ --single-transaction -f "$f" -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  done
  echo "migrate: up to date"
fi

echo "web: backend $SUPABASE_URL"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
