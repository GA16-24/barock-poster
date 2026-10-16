#!/usr/bin/env bash
# job.sh <id> <head|prop> <photo-seeds> <photo-pick> <mesh-seeds>   (on the box)
# Seeds are comma lists; "-" skips that step. Reads ~/barock3d/jobs/<id>/{input.png,prompt.txt};
# with a prompt the mesh step runs on photo-s<photo-pick>.png.
set -euo pipefail
ID=$1 KIND=$2 PHOTO=$3 PICK=$4 MESH=$5
JOB=~/barock3d/jobs/$ID
OUT=/mnt/data/barock3d/out/$ID
PY=~/barock3d/env/bin/python
GEN=~/barock3d/tools/generate.py
mkdir -p "$OUT"
rm -f "$OUT/DONE" "$OUT/FAIL"
trap '[ -f "$OUT/DONE" ] || touch "$OUT/FAIL"' EXIT
IMG=$JOB/input.png
if [ -f "$JOB/prompt.txt" ]; then
  [ "$PHOTO" = - ] || $PY $GEN edit "$IMG" "$OUT" "$JOB/prompt.txt" "$PHOTO"
  IMG=$OUT/photo-s$PICK.png
fi
[ "$MESH" = - ] || $PY $GEN mesh "$IMG" "$OUT" "$KIND" "$MESH"
touch "$OUT/DONE"
