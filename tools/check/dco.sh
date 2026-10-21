#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Every commit in <base>..<head> carries a `Signed-off-by:` line naming its author, the DCO sign-off
# (CONTRIBUTING.md). CI runs it on each pull request; locally: tools/check/dco.sh origin/main HEAD.
set -eu
[ $# -eq 2 ] || { echo "usage: $0 <base> <head>" >&2; exit 2; }
failed=0
for commit in $(git rev-list --no-merges "$1..$2"); do
  author=$(git show -s --format='%an <%ae>' "$commit")
  if ! git show -s --format='%(trailers:key=Signed-off-by,valueonly)' "$commit" \
    | grep -qixF "$author"; then
    echo "dco: $(git show -s --format='%h %s' "$commit"): no 'Signed-off-by: $author'" >&2
    failed=1
  fi
done
if [ "$failed" = 1 ]; then
  echo "dco: sign off with \`git rebase --signoff $1\`, then push again (CONTRIBUTING.md)" >&2
  exit 1
fi
echo ok
