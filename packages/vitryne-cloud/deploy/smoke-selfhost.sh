#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# The smoke test of the compose file with its own backend (docker-compose.selfhost.yml; not in
# CI: it needs Docker; packages/vitryne-docs/content/docs/developers/cloud.md). From a
# folder with only the compose file and setup.sh, as a person has it: setup.sh makes the keys,
# the stack starts, and through the one address it checks the editor's headers and config.json,
# that anonymous sign-in, turning that user into an account (no email), sign-in, a stored part
# and a project work, that an anonymous user may keep one project only, and that the daily
# cleanup removes a stale draft with its files.
#
#   packages/vitryne-cloud/deploy/smoke-selfhost.sh            builds the image from the editor built here
#   SMOKE_IMAGE=name:tag packages/vitryne-cloud/deploy/smoke-selfhost.sh   runs an image you already have
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)

image=${SMOKE_IMAGE:-vitryne-web:smoke-selfhost}
if [[ -z ${SMOKE_IMAGE:-} ]]; then
  echo "smoke-selfhost: building the image"
  (cd "$root/packages/vitryne-web" && pnpm run build >/dev/null)
  docker build -q -f "$root/packages/vitryne-cloud/deploy/web/Dockerfile" --target from-dist -t "$image" "$root" >/dev/null
fi

work=$(mktemp -d)
cp "$here/docker-compose.selfhost.yml" "$here/setup.sh" "$work/"
cd "$work"
port=${HTTP_PORT:-8100}
export VITRYNE_IMAGE=${image%:*} VITRYNE_VERSION=${image##*:}
compose() { docker compose -f docker-compose.selfhost.yml -p vitryne-smoke-sh "$@"; }
fail() {
  echo "smoke-selfhost: FAIL: $*" >&2
  compose logs --tail 20 >&2 || true
  exit 1
}
trap 'compose down -v >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

echo "smoke-selfhost: setup.sh"
sh setup.sh >/dev/null
sh setup.sh >/dev/null 2>&1 && fail "setup.sh overwrote an existing .env"
sed -e "s#^PUBLIC_URL=.*#PUBLIC_URL=http://localhost:$port#" -e "s#^HTTP_PORT=.*#HTTP_PORT=$port#" -e 's#^HTTPS_PORT=.*#HTTPS_PORT=8444#' .env >.env.new && mv .env.new .env
for v in JWT_SECRET POSTGRES_PASSWORD ANON_KEY SERVICE_KEY; do grep -q "^$v=.\{20,\}" .env || fail "setup.sh left $v empty"; done
[[ $(compose config 2>&1 | grep -c "run setup.sh") == 0 ]] || fail "the compose file asks for a setting setup.sh didn't write"

echo "smoke-selfhost: starting the stack"
compose up -d >/dev/null 2>&1 || fail "docker compose up"
url=http://localhost:$port
for _ in $(seq 1 90); do curl -fs "$url/config.json" >/dev/null 2>&1 && break; sleep 2; done
curl -fs "$url/config.json" >/dev/null || fail "the web container didn't answer"

key=$(sed -n 's/^ANON_KEY=//p' .env)
headers=$(curl -fsI "$url/")
grep -qi '^cross-origin-opener-policy: same-origin' <<<"$headers" || fail "no COOP header"
grep -qi '^cross-origin-embedder-policy: require-corp' <<<"$headers" || fail "no COEP header"
cfg=$(curl -fs "$url/config.json")
grep -q '"publishableKey":"'"$key"'"' <<<"$cfg" || fail "config.json doesn't carry the anon key"
logs=$(compose logs web 2>&1)
grep -q 'migrate: up to date' <<<"$logs" || fail "the migrations didn't run"
[[ $(compose exec -T auth wget -qO- http://web:8081/email/confirmation.html | wc -c) -gt 50 ]] || fail "Auth can't fetch the email templates"
[[ $(curl -s -o /dev/null -w '%{http_code}' "$url/rest/v1/projects") == 401 ]] || fail "REST answered without a key"

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
api() { curl -fsS -H "apikey: $key" -H 'Content-Type: application/json' "$@"; }

echo "smoke-selfhost: a draft becomes an account, without email"
anon=$(api -X POST "$url/auth/v1/signup" -d '{}')
[[ $(json 'd["user"]["is_anonymous"]' <<<"$anon") == True ]] || fail "no anonymous user"
tok=$(json 'd["access_token"]' <<<"$anon")
uid=$(json 'd["user"]["id"]' <<<"$anon")
up=$(api -X PUT "$url/auth/v1/user" -H "Authorization: Bearer $tok" -d '{"email":"smoke@example.com","password":"password123"}')
[[ $(json 'd["is_anonymous"]' <<<"$up") == False ]] || fail "the draft didn't become an account: $up"
tok=$(api -X POST "$url/auth/v1/token?grant_type=password" -d '{"email":"smoke@example.com","password":"password123"}' | json 'd["access_token"]')
[[ $(curl -s -o /dev/null -w '%{http_code}' -X POST "$url/auth/v1/token?grant_type=password" -H "apikey: $key" -H 'Content-Type: application/json' -d '{"email":"smoke@example.com","password":"wrong-one"}') == 400 ]] || fail "a wrong password signed in"

echo "smoke-selfhost: a part and a project"
printf 'smoke' >part.bin
sha=$(shasum -a 256 part.bin | cut -d' ' -f1)
curl -fsS -X POST "$url/storage/v1/object/parts/$uid/$sha" -H "apikey: $key" -H "Authorization: Bearer $tok" -H 'Content-Type: application/octet-stream' --data-binary @part.bin >/dev/null || fail "part upload"
[[ $(curl -fsS "$url/storage/v1/object/authenticated/parts/$uid/$sha" -H "apikey: $key" -H "Authorization: Bearer $tok") == smoke ]] || fail "part download"
api -X POST "$url/rest/v1/projects" -H "Authorization: Bearer $tok" -d "{\"owner\":\"$uid\",\"name\":\"smoke\",\"manifest\":{\"parts\":[]},\"bytes\":5}" >/dev/null || fail "project insert"

echo "smoke-selfhost: an anonymous user keeps one project"
a2=$(api -X POST "$url/auth/v1/signup" -d '{}')
t2=$(json 'd["access_token"]' <<<"$a2")
u2=$(json 'd["user"]["id"]' <<<"$a2")
mk() { curl -s -o /dev/null -w '%{http_code}' -X POST "$url/rest/v1/projects" -H "apikey: $key" -H "Authorization: Bearer $t2" -H 'Content-Type: application/json' -d "{\"owner\":\"$u2\",\"name\":\"d\",\"manifest\":{\"parts\":[]},\"bytes\":1}"; }
[[ $(mk) == 201 ]] || fail "an anonymous user's first project was refused"
[[ $(mk) != 201 ]] || fail "an anonymous user kept a second project"
curl -fsS -X POST "$url/storage/v1/object/parts/$u2/$sha" -H "apikey: $key" -H "Authorization: Bearer $t2" -H 'Content-Type: application/octet-stream' --data-binary @part.bin >/dev/null

echo "smoke-selfhost: the cleanup"
sql() { compose exec -T db psql -U postgres -tAc "$1"; }
out=$(compose exec -T web /cleanup.sh once)
grep -q 'removed 0 anonymous' <<<"$out" || fail "the cleanup removed a fresh draft: $out"
sql "update vitryne_private.limits set anonymous_days = 0" >/dev/null
sleep 1
out=$(compose exec -T web /cleanup.sh once)
grep -q 'removed 1 anonymous' <<<"$out" || fail "the cleanup didn't remove the stale draft: $out"
[[ $(sql "select count(*) from auth.users where id = '$u2'") == 0 ]] || fail "the stale user is still there"
[[ $(sql "select count(*) from storage.objects where name like '$u2/%'") == 0 ]] || fail "the stale user's part is still there"
[[ $(sql "select count(*) from auth.users where id = '$uid'") == 1 ]] || fail "the account was removed"
echo "smoke-selfhost: ok"
