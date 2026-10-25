// Renders the written GLBs in three.js (headless Chrome) to test/out/maps/:
//   <city>-a.png and <city>-b.png: same oblique camera, animation at t and t + 2 s; <city>-diff.png marks what moved
//   <city>-top.png: plan view, <city>-close.png: close look at the city's `focus` (fraction of the radius)
// node tools/maps/render.mjs [city ...]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { CITIES } from './cities.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}test/out/maps`;
const PORT = 8133;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

// Counts pixels that changed between the two animation times and writes <city>-diff.png:
// frame a dimmed, with every changed pixel in red.
async function changedPixels(a, b, out) {
  const [{ data: x, info }, { data: y }] = await Promise.all([a, b].map((f) => sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const img = Buffer.from(x.map((v) => v * 0.35));
  const { width, height } = info;
  let n = 0;
  for (let i = 0; i < x.length; i += 3) {
    if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) <= 30) continue;
    n++;
    const px = (i / 3) % width, py = Math.floor(i / 3 / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const qx = px + dx, qy = py + dy;
      if (qx >= 0 && qy >= 0 && qx < width && qy < height) img.set([255, 40, 40], (qy * width + qx) * 3);
    }
  }
  await sharp(img, { raw: { width, height, channels: 3 } }).png().toFile(out);
  return n;
}

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()));
  fs.mkdirSync(OUT, { recursive: true });
  for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CITIES)) {
    const url = `/site/models/maps/${id}.glb?v=${Date.now()}`;
    const save = (name, dataUrl) => fs.writeFileSync(`${OUT}/${id}-${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    for (const [view, times, names, w, h] of [
      ['oblique', [10, 12], ['a', 'b'], 1600, 1100],
      ['top', [10], ['top'], 1400, 1400],
      ['close', [10], ['close'], 1600, 1100],
    ]) {
      await page.goto(`http://127.0.0.1:${PORT}/tools/maps/render.html`);
      await page.waitForFunction(() => window.ready);
      const { shots, clips } = await page.evaluate((o) => window.render(o), { url, times, view, width: w, height: h, focus: CITIES[id].focus });
      shots.forEach((s, i) => save(names[i], s));
      if (shots.length === 2) console.log(`${id}: ${await changedPixels(`${OUT}/${id}-a.png`, `${OUT}/${id}-b.png`, `${OUT}/${id}-diff.png`)} pixels differ between a and b`);
      if (view === 'oblique') console.log(`${id}: clips ${JSON.stringify(clips)}`);
    }
    console.log(`${id}: wrote ${OUT.replace(ROOT, '')}/${id}-{a,b,diff,top,close}.png`);
  }
} finally {
  await browser.close();
  server.close();
}
