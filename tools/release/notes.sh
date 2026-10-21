#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Prints the notes of one release, its `## [<version>]` section of CHANGELOG.md, and fails when
# there is none (docs/MAINTAINING.md, Releasing). The release workflow uses it; locally:
# tools/release/notes.sh 0.1.0
set -eu
[ $# -eq 1 ] || { echo "usage: $0 <version>" >&2; exit 2; }
cd "$(dirname "$0")/../.."
notes=$(awk -v heading="## [$1]" '
  index($0, heading) == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' CHANGELOG.md)
[ -n "$(printf '%s' "$notes" | tr -d '[:space:]')" ] \
  || { echo "notes: no '## [$1]' section in CHANGELOG.md" >&2; exit 1; }
printf '%s\n' "$notes"
