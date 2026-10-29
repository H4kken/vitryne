#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Imports every pattern of Valentina's and Seamly2D's own collections (both GPL-3.0, so fetched
# here, never committed) with the measurements file each names at its base size, and prints per
# pattern how many pieces were made and why any was refused, then the totals.
#
# usage: tools/drafting/corpus.sh
#   VALENTINA_REF=<commit>   which Valentina to fetch (default: the one docs/PROGRESS.md reports)
#   SEAMLY_REF=<commit>      which Seamly2D to fetch (likewise)
# The checkouts go to packages/vitryne-engine/target/{valentina,seamly2d}-corpus/ (git ignores
# target/).
set -eu
cd "$(dirname "$0")/../.."

vref=${VALENTINA_REF:-6f4358d93c6da11051b093eff42e05cd6d056c2e}
sref=${SEAMLY_REF:-0c17d20b4a70de23e8b9810a6aad39d5cc33e3b4}
vdir=packages/vitryne-engine/target/valentina-corpus
sdir=packages/vitryne-engine/target/seamly2d-corpus

fetch() { # dir url ref sparse-paths...
  dir=$1 url=$2 ref=$3
  shift 3
  if [ ! -d "$dir/.git" ]; then
    git clone -q --filter=blob:none --no-checkout "$url" "$dir"
    git -C "$dir" sparse-checkout set "$@"
  fi
  git -C "$dir" fetch -q --depth 1 origin "$ref"
  git -C "$dir" checkout -q "$ref"
}
fetch "$vdir" https://gitlab.com/smart-pattern/valentina.git "$vref" \
  src/app/share/collection src/app/share/tables
fetch "$sdir" https://github.com/FashionFreedom/Seamly2D.git "$sref" \
  src/app/share src/test/CollectionTest

cd packages/vitryne-engine
PATH="$HOME/.cargo/bin:$PATH"
for root in target/valentina-corpus/src/app/share target/seamly2d-corpus/src/app/share \
  target/seamly2d-corpus/src/test/CollectionTest; do
  echo "== $root"
  DRAFTING_CORPUS="$(pwd)/$root" \
    cargo test -q --release -p vitryne-pattern --test drafting_corpus -- --ignored --nocapture
done
