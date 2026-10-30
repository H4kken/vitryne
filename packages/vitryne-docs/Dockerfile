# SPDX-License-Identifier: AGPL-3.0-or-later
# The documentation site: Astro's static build served by Caddy on port 80. Build context: the
# repository root (the build reads the root CONTRIBUTING.md, scripts/sync-contributing.mjs), e.g.
#   docker build -f packages/vitryne-docs/Dockerfile -t vitryne-docs .
# On Coolify: build pack Dockerfile, base directory `/`, Dockerfile location
# `/packages/vitryne-docs/Dockerfile`.

FROM node:24-alpine AS build
RUN npm install -g pnpm@10.11.1
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile --filter vitryne-docs... \
 && pnpm --filter vitryne-docs run build

FROM caddy:2.10.2-alpine
COPY --from=build /src/packages/vitryne-docs/dist /srv
EXPOSE 80
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
