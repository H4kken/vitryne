#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# S3 drag matrix: tools/bench/s3/run.sh <out-dir> [extra drape flags...]
# Garments x {10k, 20k} x seeds 1-6, self-collision on, K = 4 (the S2 setup). Output: one line per run.
set -e
out=$1; shift
mkdir -p "$out"
for g in tshirt trousers hoodie; do
  for v in 10000 20000; do
    for s in 1 2 3 4 5 6; do
      tools/bench/s3/one.sh $g $v $s "$out/${g}_$((v/1000))k_s$s.json" "$@" || echo "FAIL $g $v $s"
    done
  done
done
