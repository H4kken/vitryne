#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# The smoke test of the web image (not in CI: it needs Docker and the local Supabase stack;
# docs/CLOUD.md, "Checking"): builds the image
# from the editor built here (`pnpm run build`, then target from-dist, quick), checks that it
# refuses to start without a backend, then starts it from docker-compose.yml against the
# local Supabase stack (started if needed) and checks the isolation headers,
# /config.json, that the migrations at start agree with the CLI's, and runs the backend tests
# (packages/vitryne-cloud/tests/).
set -euo pipefail
cd "$(dirname "$0")/../../.."

# The image built here (vitryne-web:latest), not the release the compose file names.
# The override lets the container reach the host's database (host.docker.internal), on Linux too.
override=$(mktemp)
printf 'services:\n  web:\n    extra_hosts:\n      - host.docker.internal:host-gateway\n' >"$override"
compose() { VITRYNE_IMAGE=vitryne-web VITRYNE_VERSION=latest docker compose -f packages/vitryne-cloud/deploy/docker-compose.yml -f "$override" -p vitryne-smoke "$@"; }
url=http://localhost:${HTTP_PORT:-8000}
fail() {
  echo "smoke: FAIL: $*" >&2
  compose logs --tail 20 >&2 || true
  exit 1
}
wait_up() {
  for _ in $(seq 1 60); do curl -fs "$url/" >/dev/null 2>&1 && return 0; sleep 1; done
  fail "the web container didn't answer"
}
trap 'compose down >/dev/null 2>&1 || true; rm -f "$override"' EXIT

echo "smoke: building the image"
(cd packages/vitryne-web && pnpm run build >/dev/null)
docker build -q -f packages/vitryne-cloud/deploy/web/Dockerfile --target from-dist -t vitryne-web . >/dev/null

echo "smoke: no backend"
out=$(docker run --rm -e SUPABASE_URL= -e SUPABASE_PUBLISHABLE_KEY= vitryne-web 2>&1) && fail "the image started without a backend"
grep -q 'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are needed' <<<"$out" || fail "no clear message without a backend: $out"

echo "smoke: against the local Supabase stack"
cli=packages/vitryne-web/node_modules/.bin/supabase
status() { "$cli" status -o env --workdir packages/vitryne-cloud 2>/dev/null | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }
[[ -n $(status API_URL) ]] || "$cli" start --workdir packages/vitryne-cloud -x imgproxy,supavisor,vector,logflare
api=$(status API_URL)
key=$(status PUBLISHABLE_KEY)
# The container reaches the host's database through host.docker.internal.
db=$(status DB_URL | sed 's/127\.0\.0\.1/host.docker.internal/')
SUPABASE_URL=$api SUPABASE_PUBLISHABLE_KEY=$key SUPABASE_DB_URL=$db compose up -d --no-build >/dev/null 2>&1
wait_up
headers=$(curl -fsI "$url/")
grep -qi '^cross-origin-opener-policy: same-origin' <<<"$headers" || fail "no COOP header"
grep -qi '^cross-origin-embedder-policy: require-corp' <<<"$headers" || fail "no COEP header"
curl -fs "$url/" | grep -q '<div id="root">' || fail "no editor at /"
curl -fs "$url/design/some-project" | grep -q '<div id="root">' || fail "a project's address doesn't open the editor"
curl -fs "$url/config.json" | grep -q "\"url\":\"$api\"" || fail "config.json doesn't name the backend"
logs=$(compose logs web)
grep -q 'migrate: up to date' <<<"$logs" || fail "the migrations at start didn't run"
if grep -q 'migrate: applying' <<<"$logs"; then fail "the migrations at start re-applied what the CLI had applied"; fi

node --test packages/vitryne-cloud/tests/rls.test.mjs packages/vitryne-cloud/tests/accounts.test.mjs packages/vitryne-cloud/tests/cleanup.test.mjs
echo "smoke: ok"
