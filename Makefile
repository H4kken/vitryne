# SPDX-License-Identifier: AGPL-3.0-or-later
# The entry point for building and checking Vitryne (docs/REPO_PLAN.md). `make` lists the
# targets. `make check` must pass before every milestone commit (there is no CI); it needs cargo
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
VITRYNE := $(ENGINE)/target/release/vitryne

STEP := printf '\n== %s\n'

# Recipes aren't echoed (each step prints a `== name` banner instead); read them here.
.SILENT:
.NOTPARALLEL:
.DEFAULT_GOAL := help
.PHONY: help setup dev dev-app wasm assets build hygiene fmt fmt-check lint test syntax examples \
	examples-check regress regress-update check-quick check cloud-test clean \
	deps cli fmt-check-rust fmt-check-web lint-rust lint-web test-rust test-web

help: ## Lists the targets
	awk 'BEGIN { FS = ":.*## " } /^[a-z-]+:.*## / { printf "  make %-16s %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)

# Getting started and running the editor.

setup: deps wasm assets ## First run: pnpm install, the wasm, the app's assets

dev: ## Editor + its backend: .env.local's, or the local Supabase stack (ARGS=--local: always local)
	cd $(WEB) && pnpm run dev $(ARGS)

dev-app: ## Editor dev server only (no backend; enough for bench.html)
	cd $(WEB) && pnpm run dev:app

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

hygiene: ## SPDX headers, no file over 1 MiB outside Git LFS
	$(STEP) 'repository hygiene'
	tools/check/hygiene.sh

fmt: ## Format Rust (rustfmt) and the web package (prettier)
	cd $(ENGINE) && cargo fmt --all
	cd $(WEB) && pnpm exec prettier --write . > /dev/null

fmt-check: fmt-check-rust fmt-check-web ## Fail if `make fmt` would change anything

fmt-check-rust:
	$(STEP) 'rustfmt'
	cd $(ENGINE) && cargo fmt --all --check

fmt-check-web: deps
	$(STEP) 'prettier'
	cd $(WEB) && pnpm exec prettier --check . > /dev/null

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
# Supabase stack; docs/CLOUD.md, Checking); here, only that the scripts parse.
syntax: ## node --check / bash -n on the tools', cloud's and web's scripts
	$(STEP) 'tools: syntax check'
	git ls-files -z 'tools/*.mjs' | xargs -0 -n 1 node --check
	echo ok
	$(STEP) 'cloud: syntax check'
	git ls-files -z '$(CLOUD)/tests/*.mjs' '$(WEB)/scripts/*.mjs' | xargs -0 -n 1 node --check
	git ls-files -z '$(CLOUD)/deploy/*.sh' | xargs -0 -n 1 bash -n
	echo ok

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

CHECK := hygiene fmt-check-rust lint-rust test-rust build fmt-check-web test-web syntax examples-check \
	regress
check: $(CHECK) ## Everything; must pass before a milestone commit (~1.5 min, GPU)
	printf '\ncheck: all passed\n'

cloud-test: ## The web image's smoke test, then the backend tests: RLS, accounts, cleanup (Docker)
	$(CLOUD)/deploy/smoke.sh
	node --test '$(CLOUD)/tests/*.test.mjs'

clean: ## cargo clean (and the SDF cache in it), the web package's dist/ pkg/ pkg-node/, bench-out/
	cd $(ENGINE) && cargo clean
	rm -rf $(WEB)/dist $(WEB)/pkg $(WEB)/pkg-node bench-out
