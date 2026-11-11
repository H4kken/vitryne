#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Repository hygiene (`make hygiene`): every source file carries the licence header, and nothing
# over 1 MiB is tracked outside Git LFS (see .gitattributes and CONTRIBUTING.md), and no markdown
# link is broken (links.py), and the Unreleased changelog groups are in order.
set -eu
cd "$(dirname "$0")/../.."
fail() { printf 'check: FAILED: %s\n' "$*" >&2; exit 1; }

missing=$(git ls-files '*.rs' '*.wgsl' '*.js' '*.mjs' '*.ts' '*.tsx' '*.py' '*.sh' '*.html' Makefile \
  | xargs grep -L 'SPDX-License-Identifier: AGPL-3.0-or-later' || true)
[ -z "$missing" ] || fail "missing SPDX header in: $missing"
big=$(git ls-files -z ':(attr:!filter)' | xargs -0 wc -c 2>/dev/null \
  | awk '$2 != "total" && $1 > 1048576 { print $2 " (" int($1 / 1024) " KiB)" }')
[ -z "$big" ] || fail "files over 1 MiB must go through Git LFS or be generated: $big"
# The Unreleased changelog groups come in the order Added, Changed, Fixed.
groups=$(awk '/^## \[Unreleased\]/ { on = 1; next } on && /^## / { exit } on && /^### / { print $2 }' CHANGELOG.md)
[ "$groups" = "$(printf '%s\n' "$groups" | awk '{ r = ($1 == "Added") ? 1 : ($1 == "Changed") ? 2 : ($1 == "Fixed") ? 3 : 9; print r " " $1 }' | sort -s -k1,1n | awk '{ print $2 }')" ] \
  || fail "CHANGELOG.md: the groups under Unreleased must be Added, Changed, Fixed, in that order"
python3 tools/check/links.py
echo ok
