#!/bin/sh
# Rebuilds site/img/works/*.jpg from the original library scans. Needs curl and ImageMagick.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/site/img/works"
TMP="$(mktemp -d)"
mkdir -p "$OUT"

# Andreae: HAB Wolfenbüttel A: 134.13 Phys., CC BY-SA 3.0 DE. HAB's terms require keeping the source footer, so it is appended below the page.
curl -sfL -o "$TMP/andreae.jpg" "https://diglib.hab.de/drucke/134-13-phys/00005.jpg"
magick "$TMP/andreae.jpg" -crop 950x1500+40+45 +repage "$TMP/andreae-page.jpg"
magick "$TMP/andreae.jpg" -crop 1024x40+0+1839 +repage -resize 950x "$TMP/andreae-foot.jpg"
magick "$TMP/andreae-page.jpg" "$TMP/andreae-foot.jpg" -append -resize x768 -strip -quality 82 "$OUT/andreae.jpg"

# Bidermann: Ludi theatrales sacri, München 1666, title page listing Cenodoxus. Scan from CAMENA (Uni Mannheim).
curl -sfL -A "Mozilla/5.0" -o "$TMP/bidermann.jpg" "https://mateo.uni-mannheim.de/camena/bider3/jpg/bider001.jpg"
magick "$TMP/bidermann.jpg" -resize x768 -strip -quality 82 "$OUT/bidermann.jpg"

# Birken: Fortsetzung der Pegnitz-Schäferey, Nürnberg 1645. Google Books scan on the Internet Archive, Public Domain Mark.
curl -sfL -o "$TMP/birken.jpg" "https://archive.org/download/bub_gb_9q9IAAAAcAAJ/page/n4.jpg"
magick "$TMP/birken.jpg" -fuzz 12% -trim +repage -gravity East -chop 7%x0 +repage -resize x768 -strip -quality 82 "$OUT/birken.jpg"

rm -rf "$TMP"
magick identify "$OUT"/andreae.jpg "$OUT"/bidermann.jpg "$OUT"/birken.jpg
