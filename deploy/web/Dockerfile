# SPDX-License-Identifier: AGPL-3.0-or-later
# The Vitryne web image: Caddy serving the editor's static build, plus psql for the optional
# migrations at start (entrypoint.sh). Build context: the repository root.
#
# Target `from-source` (what deploy/docker-compose.yml builds) builds the editor inside Docker:
# wasm, the examples and their SDFs on the CPU, the Vite build. It needs ~10 GB of Docker disk,
# ~4 GB of memory and 10-20 minutes the first time; later builds reuse the layers. Target
# `from-dist` packages an app/dist built on the host (`cd app && pnpm run build`) in seconds:
# for deploy/smoke.sh, or a server too small to build (docs/CLOUD.md).

FROM rust:1.99-bookworm AS build
RUN rustup target add wasm32-unknown-unknown \
 && cargo install wasm-bindgen-cli --version 0.2.129 --locked \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g pnpm@10.11.1
ENV CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_DEBUG=0
WORKDIR /src
COPY . .
RUN rm -rf app/dist
WORKDIR /src/app
# The native build only exports the examples; the bench page's inputs are left out.
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/target \
    pnpm install --frozen-lockfile \
 && pnpm run wasm \
 && cd .. && cargo build --release -p drape-native && target/release/drape export-app-assets app/public \
 && cd app && pnpm exec tsc -b && pnpm exec vite build \
 && rm -rf dist/bench-assets

FROM caddy:2.10.2-alpine AS serve
RUN apk add --no-cache postgresql17-client
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY deploy/web/privacy.html /srv/site/privacy.html
COPY deploy/web/entrypoint.sh /entrypoint.sh
COPY supabase/migrations /srv/migrations
ENTRYPOINT ["/entrypoint.sh"]

FROM serve AS from-source
COPY --from=build /src/app/dist /srv/app

FROM serve AS from-dist
COPY app/dist /srv/app
RUN rm -rf /srv/app/bench-assets
