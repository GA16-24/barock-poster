// node tools/assets/render.mjs            -> test/out/assets/contact-sheet.png (every model, 4 angles)
// node tools/assets/render.mjs <id> ...   -> test/out/assets/<id>-turntable.png (bigger tiles)
// Serves the repo on 127.0.0.1:8132 and renders with three.js in headless Chromium.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'assets.json'), 'utf8'));
const OUT = path.join(ROOT, 'test/out/assets');
const ANGLES = [0, 45, 90, 180];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8132, '127.0.0.1', r));

// Source picture, generated photo and the 3D turntable side by side: <id>-compare.png.
async function compare(id, turntable) {
  const H = 512;
  const parts = [`src/${id}-input.png`, `src/${id}-photo.png`, `src/${id}-rgba.png`]
    .map((p) => path.join(OUT, p)).filter((p) => fs.existsSync(p));
  if (!parts.length) return;
  const tiles = [];
  for (const p of [...parts, turntable]) {
    const buf = await sharp(p).flatten({ background: '#8c8c8c' }).resize({ height: H }).png().toBuffer();
    tiles.push({ buf, w: (await sharp(buf).metadata()).width });
  }
  let left = 0;
  const composite = tiles.map((t) => ({ input: t.buf, top: 0, left: (left += t.w) - t.w }));
  await sharp({ create: { width: left, height: H, channels: 3, background: '#2a2a2a' } })
    .composite(composite).png().toFile(path.join(OUT, `${id}-compare.png`));
  console.log('wrote', `test/out/assets/${id}-compare.png`);
}

const argv = process.argv.slice(2);
const sweepId = argv[0] === '--sweep' ? argv[1] : null;
const ids = sweepId ? [] : argv;
const rows = sweepId
  ? fs.readdirSync(path.join(OUT, 'sweep')).filter((f) => f.startsWith(`${sweepId}-s`) && f.endsWith('.glb'))
    .map((f) => ({ label: f.replace('.glb', ''), url: `/test/out/assets/sweep/${f}`, angles: ANGLES }))
  : MANIFEST.filter((e) => !ids.length || ids.includes(e.id))
    .map((e) => ({ label: e.id, url: `/site/models/${e.zone}/${e.id}.glb`, angles: ANGLES }));

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.goto('http://127.0.0.1:8132/tools/assets/render.html');
  await page.waitForFunction(() => window.ready);
  const tile = ids.length || sweepId ? 384 : 256;
  const title = ids.length || sweepId ? '' : 'Barock AR assets: 0° vorne (+Z), 45°, 90° Seite, 180° hinten';
  const { png, report } = await page.evaluate(([r, t, h]) => window.renderSheet(r, t, h), [rows, tile, title]);
  const file = path.join(OUT, sweepId ? `${sweepId}-sweep.png` : ids.length === 1 ? `${ids[0]}-turntable.png` : ids.length ? 'turntable.png' : 'contact-sheet.png');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  for (const r of report) console.log(r.url, r.error ?? `size ${r.size.join(' x ')} center ${r.center.join(',')}`);
  console.log('wrote', path.relative(ROOT, file));
  if (ids.length === 1) await compare(ids[0], file);
} finally {
  await browser.close();
  server.close();
}
