#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Imports every pattern of Valentina's own collection (GPL-3.0, so fetched here, never committed)
# with its measurements file at its base size, and prints per pattern how many pieces were made
# and why any was refused, then the totals.
#
# usage: tools/valentina/corpus.sh
#   VALENTINA_REF=<commit>   which Valentina to fetch (default: the one docs/PROGRESS.md reports)
# The checkout goes to packages/vitryne-engine/target/valentina-corpus/ (git ignores target/).
set -eu
cd "$(dirname "$0")/../.."

ref=${VALENTINA_REF:-6f4358d93c6da11051b093eff42e05cd6d056c2e}
dir=packages/vitryne-engine/target/valentina-corpus
if [ ! -d "$dir/.git" ]; then
  git clone -q --filter=blob:none --no-checkout https://gitlab.com/smart-pattern/valentina.git "$dir"
  git -C "$dir" sparse-checkout set src/app/share/collection src/app/share/tables
fi
git -C "$dir" fetch -q --depth 1 origin "$ref"
git -C "$dir" checkout -q "$ref"

cd packages/vitryne-engine
PATH="$HOME/.cargo/bin:$PATH"
VALENTINA_CORPUS="$(pwd)/target/valentina-corpus/src/app/share" \
  cargo test -q --release -p vitryne-pattern --test valentina_corpus -- --ignored --nocapture
