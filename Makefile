# SPDX-License-Identifier: AGPL-3.0-or-later
# The entry point for building and checking Vitryne. `make` lists the targets. `make check` must pass before every pull request; CI runs `make check-ci`, the same
# without the drapes (GitHub's runners have no GPU; .github/workflows/ci.yml). It needs cargo
# with clippy + rustfmt, the wasm32-unknown-unknown target, wasm-bindgen-cli 0.2.129, Node 22+
# with pnpm 10, python3, and a GPU for the drapes (CONTRIBUTING.md).
#
# Make runs the steps and their order; anything with loops or conditions lives in tools/check/.
# Steps run one after another and stop at the first failure; `make -j` isn't supported (the GPU
# and the shared target/ don't parallelise well).

export PATH := $(HOME)/.cargo/bin:$(PATH)

ENGINE := packages/vitryne-engine
WEB := packages/vitryne-web
CLOUD := packages/vitryne-cloud
DOCS := packages/vitryne-docs
VITRYNE := $(ENGINE)/target/release/vitryne
STACK := docker compose -f $(CLOUD)/dev/docker-compose.yml
# The dev stack's API, demo key, mail catcher and database (packages/vitryne-cloud/dev/), for the
# backend tests (packages/vitryne-cloud/tests/instance.mjs).
STACK_ENV := SUPABASE_URL=http://127.0.0.1:54321 \
	SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
	MAILPIT_URL=http://127.0.0.1:54324 SUPABASE_DB_CONTAINER=vitryne-dev-db-1

STEP := printf '\n== %s\n'

# Recipes aren't echoed (each step prints a `== name` banner instead); read them here.
.SILENT:
.NOTPARALLEL:
.DEFAULT_GOAL := help
.PHONY: help setup dev dev-app docs-dev docs wasm assets build hygiene fmt fmt-check lint test syntax examples drafting-corpus \
	examples-check regress regress-update check-quick check-ci check cloud-test stack stack-down stack-test clean \
	deps cli fmt-check-rust fmt-check-web fmt-check-docs lint-rust lint-web test-rust test-web

help: ## Lists the targets
	awk 'BEGIN { FS = ":.*## " } /^[a-z-]+:.*## / { printf "  make %-16s %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)

# Getting started and running the editor.

setup: deps wasm assets ## First run: pnpm install, the wasm, the app's assets

dev: ## Editor + its backend: .env.local's, or the local Supabase stack (ARGS=--local: always local)
	cd $(WEB) && pnpm run dev $(ARGS)

dev-app: ## Editor dev server only (no backend; enough for bench.html)
	cd $(WEB) && pnpm run dev:app

docs-dev: deps ## Docs site dev server (packages/vitryne-docs, http://localhost:4321)
	cd $(DOCS) && pnpm run dev

docs: deps ## Docs site: type check (astro check), static build in packages/vitryne-docs/dist
	$(STEP) 'docs: astro check, static build'
	cd $(DOCS) && pnpm run check && pnpm run build

wasm: ## wasm build (browser + Node)
	cd $(WEB) && pnpm run wasm

assets: ## The app's examples, their SDFs, the test avatar and the bench page's inputs
	cd $(WEB) && pnpm run assets

build: deps ## Production web bundle (wasm, assets, tsc, vite build) in packages/vitryne-web/dist
	$(STEP) 'app: wasm, assets, production bundle'
	cd $(WEB) && pnpm run build

deps:
	pnpm install --frozen-lockfile

cli: ## Native CLI and viewer in packages/vitryne-engine/target/release/vitryne (run it from here)
	cd $(ENGINE) && cargo build --release -p vitryne-cli --locked

# Checks, one target per step; `check-quick` and `check` run them in order.

hygiene: ## SPDX headers, no file over 1 MiB outside Git LFS, no broken markdown link
	$(STEP) 'repository hygiene'
	tools/check/hygiene.sh

fmt: ## Format Rust (rustfmt), the web and docs packages (prettier)
	cd $(ENGINE) && cargo fmt --all
	cd $(WEB) && pnpm exec prettier --write . > /dev/null
	cd $(DOCS) && pnpm exec prettier --write . > /dev/null

fmt-check: fmt-check-rust fmt-check-web fmt-check-docs ## Fail if `make fmt` would change anything

fmt-check-rust:
	$(STEP) 'rustfmt'
	cd $(ENGINE) && cargo fmt --all --check

fmt-check-web: deps
	$(STEP) 'prettier'
	cd $(WEB) && pnpm exec prettier --check . > /dev/null

fmt-check-docs: deps
	$(STEP) 'prettier (docs)'
	cd $(DOCS) && pnpm exec prettier --check . > /dev/null

lint: lint-rust lint-web ## clippy (native + wasm32), eslint

lint-rust:
	$(STEP) 'clippy (native)'
	cd $(ENGINE) && cargo clippy --workspace --all-targets --locked -- -D warnings
	$(STEP) 'clippy (wasm32)'
	cd $(ENGINE) && cargo clippy -p vitryne-wasm --target wasm32-unknown-unknown --locked -- -D warnings

lint-web: deps
	$(STEP) 'eslint'
	cd $(WEB) && pnpm run lint

test: test-rust test-web ## cargo test, then the web package's check (types, eslint, vitest)

test-rust:
	$(STEP) 'tests'
	cd $(ENGINE) && cargo test --workspace --locked

# The TypeScript types and validators are generated from docs/format/schema/; the tests run the
# commands and guardrails against the worker's Rust (Node build of the same wasm), including
# random edit sessions on the three examples (fast-check). Needs `make wasm assets` once.
test-web: deps
	$(STEP) 'app: format types up to date, typecheck, lint, tests'
	cd $(WEB) && pnpm run check

# The backend and the web image are checked by `make cloud-test` (Docker and the local
# Supabase stack; packages/vitryne-docs/content/docs/developers/cloud.md, Checking); here, only that the scripts parse.
syntax: ## node --check / bash -n on the tools', cloud's and web's scripts
	$(STEP) 'tools: syntax check'
	git ls-files -z 'tools/*.mjs' | xargs -0 -n 1 node --check
	echo ok
	$(STEP) 'cloud: syntax check'
	git ls-files -z '$(CLOUD)/tests/*.mjs' '$(WEB)/scripts/*.mjs' | xargs -0 -n 1 node --check
	git ls-files -z '$(CLOUD)/deploy/*.sh' | xargs -0 -n 1 bash -n
	echo ok

drafting-corpus: ## Import Valentina's and Seamly2D's own pattern collections (fetched into target/): pieces made and refused
	tools/drafting/corpus.sh

examples: ## Rebuild assets/examples/ from the sidecars (commit the result)
	tools/format/build-examples.sh

examples-check: cli ## Fail if assets/examples/ differs from `vitryne convert`
	$(STEP) 'example projects are up to date'
	tools/check/examples.sh

# The three example projects and the drawn skirt at 10k vertices, 600 frames each, against
# packages/vitryne-engine/tests/*.json and *.pos: rest frame, final shape, penetration,
# self-intersections, strain, seam gap.
regress: cli ## Golden drapes (needs a GPU)
	$(STEP) 'regression drapes (golden suite)'
	$(VITRYNE) regress 2> /dev/null \
		|| { echo 'check: FAILED: regression drapes differ from the golden results' >&2; exit 1; }

regress-update: cli ## Rewrite the goldens after an intended change (say why in the commit)
	$(VITRYNE) regress --update

check-quick: hygiene fmt-check-rust lint-rust test-rust ## Rust only: hygiene, rustfmt, clippy, cargo test
	printf '\ncheck: quick checks passed (web build and drapes skipped)\n'

CHECK_NO_GPU := hygiene fmt-check-rust lint-rust test-rust build fmt-check-web test-web syntax \
	examples-check fmt-check-docs docs
check-ci: $(CHECK_NO_GPU) ## Everything but the drapes (no GPU): what CI runs on every pull request
	printf '\ncheck: all passed but the drapes (make regress needs a GPU)\n'

check: $(CHECK_NO_GPU) regress ## Everything; must pass before a pull request (~1.5 min, GPU)
	printf '\ncheck: all passed\n'

cloud-test: ## The web image's smoke test, then the backend tests: RLS, accounts, cleanup (Docker)
	$(CLOUD)/deploy/smoke.sh
	node --test '$(CLOUD)/tests/*.test.mjs'

stack: ## Everything in Docker: the editor from this checkout + a local Supabase, http://localhost:8000
	$(STACK) up -d --build
	printf 'stack: editor http://localhost:8000 · Studio http://127.0.0.1:54323 · emails http://127.0.0.1:54324\n'

stack-down: ## Stops the Docker stack (ARGS=-v: also deletes its accounts and projects)
	$(STACK) down $(ARGS)

stack-test: ## The backend tests against the Docker stack (make stack first)
	$(STACK_ENV) node --test '$(CLOUD)/tests/*.test.mjs'

clean: ## cargo clean (and the SDF cache in it), the web package's dist/ pkg/ pkg-node/, the docs' dist/, bench-out/
	cd $(ENGINE) && cargo clean
	rm -rf $(WEB)/dist $(WEB)/pkg $(WEB)/pkg-node $(DOCS)/dist bench-out
