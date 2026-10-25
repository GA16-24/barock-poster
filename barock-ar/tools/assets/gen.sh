#!/usr/bin/env bash
# Rebuild one asset end to end: fetch source (Mac) -> edit + image-to-3D (Arch box GPU) -> optimize to site/models (Mac).
#   tools/assets/gen.sh <id>                     uses photoSeed / meshSeed from assets.json (default 0)
#   tools/assets/gen.sh <id> --photos 0,1,2      edit-only sweep -> test/out/assets/sweep/<id>-photo-s<n>.png
#   tools/assets/gen.sh <id> --meshes 0,1,2      mesh sweep on the photoSeed photo -> test/out/assets/<id>-sweep.png
# Pick the best seed by eye and write it into assets.json. Poly Haven ids only run the optimize step.
set -euo pipefail
cd "$(dirname "$0")/../.."
ID=$1 MODE=${2:-} SEEDS=${3:-}
BOX=archlinux@100.85.58.91
SRC=test/out/assets/src
SWEEP=test/out/assets/sweep
GEN=tools/assets/.cache/gen/$ID

node tools/assets/fetch.mjs "$ID"
read -r METHOD KIND PSEED MSEED < <(node -e '
  const e = require("./tools/assets/assets.json").find((e) => e.id === process.argv[1]);
  if (!e) process.exit(2);
  console.log(e.method, e.zone === "heads" ? "head" : "prop", e.photoSeed ?? 0, e.meshSeed ?? 0);' "$ID")
[ "$METHOD" = polyhaven ] && { node tools/assets/optimize.mjs "$ID"; exit; }

case "$MODE" in
  --photos) P=$SEEDS M=- ;;
  --meshes) P=- M=$SEEDS ;;
  *) P=$PSEED M=$MSEED ;;
esac

JOB=$(mktemp -d)
if [ -f "$SRC/$ID-input.png" ]; then cp "$SRC/$ID-input.png" "$JOB/input.png"
else node -e 'require("sharp")({create:{width:1024,height:1024,channels:3,background:"#c8c8c8"}}).png().toFile(process.argv[1])' "$JOB/input.png"; fi
node -e 'const e = require("./tools/assets/assets.json").find((e) => e.id === process.argv[1]);
  if (e.edit) require("fs").writeFileSync(process.argv[2], [].concat(e.edit).join("\n---\n"));' "$ID" "$JOB/prompt.txt"
rsync -az --delete "$JOB/" "${BOX}:barock3d/jobs/$ID/"
rsync -az tools/assets/box/ "${BOX}:barock3d/tools/"
ssh $BOX "rm -f /mnt/data/barock3d/out/$ID/DONE /mnt/data/barock3d/out/$ID/FAIL; tmux new -d -s gen-$ID 'bash ~/barock3d/tools/job.sh $ID $KIND $P $PSEED $M > /mnt/data/barock3d/out/$ID.log 2>&1'"
until ssh $BOX "test -f /mnt/data/barock3d/out/$ID/DONE || test -f /mnt/data/barock3d/out/$ID/FAIL"; do sleep 15; done
if ssh $BOX "test -f /mnt/data/barock3d/out/$ID/FAIL"; then ssh $BOX "tail -40 /mnt/data/barock3d/out/$ID.log"; exit 1; fi
mkdir -p "$GEN" "$SWEEP"
rsync -az "${BOX}:/mnt/data/barock3d/out/$ID/" "$GEN/"

case "$MODE" in
  --photos) for s in ${SEEDS//,/ }; do cp "$GEN/photo-s$s.png" "$SWEEP/$ID-photo-s$s.png"; done ;;
  --meshes) node tools/assets/optimize.mjs "$ID" --sweep "$SEEDS" && node tools/assets/render.mjs --sweep "$ID" ;;
  *)
    [ -f "$GEN/photo-s$PSEED.png" ] && cp "$GEN/photo-s$PSEED.png" "$SRC/$ID-photo.png"
    cp "$GEN/input.png" "$SRC/$ID-rgba.png"
    node tools/assets/optimize.mjs "$ID" ;;
esac
