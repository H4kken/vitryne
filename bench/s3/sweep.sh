#!/bin/bash
# bench/s3/sweep.sh <out-dir> <garments> <verts> [flags]: seeds 1-6, one line per run.
out=$1 gs=$2 v=$3; shift 3; mkdir -p "$out"
for g in $gs; do for s in 1 2 3 4 5 6; do bench/s3/one.sh $g $v $s "$out/${g}_$((v/1000))k_s$s.json" "$@"; done; done
