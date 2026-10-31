#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The daily cleanup of anonymous drafts nobody came back to, for the bundled backend
# (docker-compose.selfhost.yml); a Supabase project does it with the clean-anonymous Edge
# Function, called by pg_cron (supabase/functions/clean-anonymous, packages/vitryne-docs/content/docs/developers/cloud.md).
# Same steps: the stale users from `stale_anonymous_users()`, their parts through the Storage
# API (SQL can't remove the files), then the user, which takes the draft with it. A user whose
# parts fail to go is kept for the next run. Started by entrypoint.sh when SERVICE_KEY is set;
# `cleanup.sh once` runs a single pass.
set -u

: "${SERVICE_KEY:?}"
REST=${REST_URL:-http://rest:3000}
STORAGE=${STORAGE_URL:-http://storage:5000}
AUTH=${AUTH_URL:-http://auth:9999}
# curl with the service key; -f so an error status fails the call.
api() { curl -fsS -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' "$@"; }

pass() {
  ids=$(api -X POST "$REST/rpc/stale_anonymous_users" -d '{}' | jq -r '.[]') || { echo "cleanup: could not list stale users" >&2; return 1; }
  removed=0 failed=0
  for id in $ids; do
    ok=1
    while :; do
      names=$(api -X POST "$STORAGE/object/list/parts" -d "{\"prefix\":\"$id\",\"limit\":1000}" | jq -c '[.[] | select(.id != null) | "'"$id"'/" + .name]') || { ok=0; break; }
      [ "$names" != "[]" ] || break
      api -X DELETE "$STORAGE/object/parts" -d "{\"prefixes\":$names}" >/dev/null || { ok=0; break; }
    done
    if [ $ok = 1 ] && api -X DELETE "$AUTH/admin/users/$id" >/dev/null; then removed=$((removed + 1)); else failed=$((failed + 1)); fi
  done
  echo "cleanup: removed $removed anonymous users, $failed kept for the next run"
}

if [ "${1:-}" = once ]; then pass; exit; fi
# First pass a minute after start (the services are up by then), then every 24 hours.
sleep 60
while :; do
  pass
  sleep 86400
done
