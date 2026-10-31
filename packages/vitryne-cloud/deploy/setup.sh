#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Writes .env for docker-compose.selfhost.yml with keys made here, once: `sh setup.sh` for
# http://localhost:8000, or `sh setup.sh vitryne.example.com` for a server (Caddy then gets its
# own HTTPS certificate; ports 80 and 443 must reach it). Refuses to overwrite an existing .env:
# the database and the files are tied to these keys.
set -eu
[ ! -e .env ] || { echo "setup: .env exists; delete it first (the data in the volumes goes with its keys)" >&2; exit 1; }
command -v openssl >/dev/null || { echo "setup: openssl is needed" >&2; exit 1; }

domain=${1:-}
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
# A JWT signed with $jwt (HS256), valid ~10 years like a Supabase project's keys.
jwt_for() {
  head=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  exp=$(( $(date +%s) + 315360000 ))
  body=$(printf '{"role":"%s","iss":"vitryne","iat":%s,"exp":%s}' "$1" "$(date +%s)" "$exp" | b64url)
  sig=$(printf '%s.%s' "$head" "$body" | openssl dgst -sha256 -hmac "$jwt" -binary | b64url)
  printf '%s.%s.%s' "$head" "$body" "$sig"
}

jwt=$(openssl rand -hex 32)
pg=$(openssl rand -hex 24)
if [ -n "$domain" ]; then public="https://$domain"; else public="http://localhost:8000"; fi

umask 077
cat >.env <<ENV
# Made by setup.sh. Keep this file private and backed up with the database.
# Makes plain "docker compose up", "pull" and "logs" use the right file.
COMPOSE_FILE=docker-compose.selfhost.yml
PUBLIC_URL=$public
DOMAIN=$domain
HTTP_PORT=$([ -n "$domain" ] && echo 80 || echo 8000)
HTTPS_PORT=$([ -n "$domain" ] && echo 443 || echo 8443)
JWT_SECRET=$jwt
POSTGRES_PASSWORD=$pg
ANON_KEY=$(jwt=$jwt jwt_for anon)
SERVICE_KEY=$(jwt=$jwt jwt_for service_role)

# The release to run (a version like 0.5.0); empty: latest.
VITRYNE_VERSION=
# Try the editor without an account (one draft; an account is needed for more, and drafts left
# alone for 30 days are deleted). The editor makes accounts from such a draft, so keep this on.
ALLOW_ANONYMOUS=true
# Email: none by default, so accounts work at once and a forgotten password can't be reset by
# email. For confirmation and resets set SMTP_* and MAILER_AUTOCONFIRM=false.
MAILER_AUTOCONFIRM=true
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_ADMIN_EMAIL=
ENV
echo "setup: wrote .env for $public; now: docker compose up -d"
