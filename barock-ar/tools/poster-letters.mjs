// node tools/poster-letters.mjs   site/img/poster.png -> site/img/poster-letters.png
// The printed lettering and underline in their own colors, with the parchment cut away, so the scene can light up
// the print in register with it. Parchment, light or dark, keeps one hue: its colors lie near the line through
// PARCHMENT, and the ink, from orange through olive to teal, lies far off it. Only the band of the word and its
// underline counts, which leaves out the reddish stains at the edges.
import sharp from 'sharp';

const root = new URL('..', import.meta.url).pathname;
const W = 1024;
const PARCHMENT = [190, 160, 123].map((v, _, a) => v / Math.hypot(...a));
const BAND = { x: [0.058, 0.95], y: [0.22, 0.67] };
const { data, info } = await sharp(`${root}site/img/poster.png`).resize(W).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const out = Buffer.alloc(info.width * info.height * 4);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let ink = 0;
for (let i = 0; i < info.width * info.height; i++) {
  const [r, g, b] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  const x = (i % info.width) / info.width, y = Math.floor(i / info.width) / info.height;
  if (x < BAND.x[0] || x > BAND.x[1] || y < BAND.y[0] || y > BAND.y[1]) continue;
  const along = r * PARCHMENT[0] + g * PARCHMENT[1] + b * PARCHMENT[2];
  const off = Math.hypot(r - along * PARCHMENT[0], g - along * PARCHMENT[1], b - along * PARCHMENT[2]) / Math.max(Math.hypot(r, g, b), 1);
  const a = smooth(0.08, 0.13, off);
  if (a > 0.5) ink++;
  if (a === 0) continue;
  out.set([r, g, b, Math.round(a * 255)], i * 4);
}
// The word and its underline cover about a tenth of the poster; far off that, the threshold is catching stains.
const share = ink / (info.width * info.height);
if (share < 0.05 || share > 0.2) throw new Error(`ink covers ${(share * 100).toFixed(1)} % of the poster, expected 5 to 20 %`);
await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(`${root}site/img/poster-letters.png`);
console.log(`poster-letters.png ${info.width}x${info.height}, ink ${(share * 100).toFixed(1)} %`);
