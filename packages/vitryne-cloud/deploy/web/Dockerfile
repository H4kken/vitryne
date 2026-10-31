# SPDX-License-Identifier: AGPL-3.0-or-later
# The Vitryne web image: Caddy serving the editor's static build, plus psql for the optional
# migrations at start (entrypoint.sh). Build context: the repository root.
#
# Target `from-source` (what ../docker-compose.build.yml builds) builds the editor inside Docker: wasm,
# the examples and their SDFs on the CPU, the Vite build. It needs ~10 GB of Docker disk, ~4 GB
# of memory and 10-20 minutes the first time; later builds reuse the layers. Target `from-dist`
# packages a packages/vitryne-web/dist built on the host (`cd packages/vitryne-web && pnpm run
# build`) in seconds: for ../smoke.sh, releases (.github/workflows/release.yml builds the image
# on GHCR this way), or a server too small to build (packages/vitryne-docs/content/docs/developers/cloud.md).

FROM rust:1.99-bookworm AS build
RUN rustup target add wasm32-unknown-unknown \
 && cargo install wasm-bindgen-cli --version 0.2.129 --locked \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g pnpm@10.11.1
ENV CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_DEBUG=0
WORKDIR /src
COPY . .
RUN rm -rf packages/vitryne-web/dist
# The native build only exports the examples; the bench page's inputs are left out.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/packages/vitryne-engine/target \
    pnpm install --frozen-lockfile \
 && (cd packages/vitryne-web && pnpm run wasm) \
 && (cd packages/vitryne-engine && cargo build --release -p vitryne-cli) \
 && packages/vitryne-engine/target/release/vitryne export-app-assets packages/vitryne-web/public \
 && cd packages/vitryne-web && pnpm exec tsc -b && pnpm exec vite build \
 && rm -rf dist/bench-assets

FROM caddy:2.10.2-alpine AS serve
RUN apk add --no-cache postgresql17-client curl jq
COPY packages/vitryne-cloud/deploy/web/Caddyfile packages/vitryne-cloud/deploy/web/Caddyfile.selfhost packages/vitryne-cloud/deploy/web/app.caddy /etc/caddy/
COPY packages/vitryne-cloud/supabase/templates /srv/email
COPY packages/vitryne-cloud/deploy/web/entrypoint.sh packages/vitryne-cloud/deploy/web/cleanup.sh /
COPY packages/vitryne-cloud/supabase/migrations /srv/migrations
ENTRYPOINT ["/entrypoint.sh"]

FROM serve AS from-source
COPY --from=build /src/packages/vitryne-web/dist /srv/app

FROM serve AS from-dist
COPY packages/vitryne-web/dist /srv/app
RUN rm -rf /srv/app/bench-assets
