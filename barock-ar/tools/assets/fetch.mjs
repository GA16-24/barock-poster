// node tools/assets/fetch.mjs [id ...]
// Downloads source photos (Commons, via the API so we never guess a file URL) and Poly Haven models,
// checks the license the API reports against assets.json, and rewrites site/data/credits/assets.json.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'assets.json'), 'utf8'));
const SRC = path.join(ROOT, 'test/out/assets/src');
const CACHE = path.join(import.meta.dirname, '.cache');
const UA = { 'User-Agent': 'barock-poster-school-project/1.0 (x1scsizorr.lobby@outlook.com)' };

const getJson = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r.json();
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error(`GET ${url} failed`);
};
const download = async (url, file) => {
  if (fs.existsSync(file)) return;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
};
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');

async function fetchCommons(entry) {
  const title = decodeURIComponent(entry.source.url.split('/wiki/')[1]);
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2048&titles=${encodeURIComponent(title)}`;
  const page = Object.values((await getJson(api)).query.pages)[0];
  const ii = page.imageinfo?.[0];
  if (!ii) throw new Error(`${entry.id}: ${title} not on Commons`);
  const license = ii.extmetadata.LicenseShortName.value;
  if (norm(license) !== norm(entry.source.license)) throw new Error(`${entry.id}: Commons says "${license}", manifest says "${entry.source.license}"`);
  const src = path.join(SRC, `${entry.id}-source.jpg`);
  await download(ii.thumburl ?? ii.url, src);
  let img = sharp(src).rotate();
  if (entry.crop) {
    const s = (await sharp(src).metadata()).width / ii.width;
    const [left, top, width, height] = entry.crop.map((v) => Math.round(v * s));
    img = img.extract({ left, top, width, height });
  }
  let buf = await img.png().toBuffer();
  if (entry.pad) {
    const { width, height } = await sharp(buf).metadata();
    const [x, y] = [Math.round(width * entry.pad), Math.round(height * entry.pad)];
    buf = await sharp(buf).extend({ top: y, bottom: Math.round(y / 2), left: x, right: x, background: '#c8c8c8' }).png().toBuffer();
  }
  fs.writeFileSync(path.join(SRC, `${entry.id}-input.png`), buf);
  console.log(entry.id, 'ok', license, ii.extmetadata.Artist?.value.replace(/<[^>]+>/g, '').trim());
}

async function fetchPolyHaven(entry) {
  const id = entry.polyhaven.id;
  const dir = path.join(CACHE, 'polyhaven', id);
  const info = await getJson(`https://api.polyhaven.com/info/${id}`);
  const g = (await getJson(`https://api.polyhaven.com/files/${id}`)).gltf['1k'].gltf;
  await download(g.url, path.join(dir, path.basename(g.url)));
  for (const [rel, f] of Object.entries(g.include ?? {})) await download(f.url, path.join(dir, rel));
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 1));
  console.log(entry.id, 'ok polyhaven', id, Object.keys(info.authors).join(', '));
}

function writeCredits() {
  const rows = MANIFEST.map((e) => {
    const file = `site/models/${e.zone}/${e.id}.glb`;
    if (e.method === 'polyhaven') {
      const info = JSON.parse(fs.readFileSync(path.join(CACHE, 'polyhaven', e.polyhaven.id, 'info.json'), 'utf8'));
      return { id: e.id, file, title: info.name, author: Object.keys(info.authors).join(', '), license: 'CC0', url: `https://polyhaven.com/a/${e.polyhaven.id}` };
    }
    const row = { id: e.id, file, title: e.source.title, author: e.source.author, license: e.source.license, url: e.source.url };
    if (e.reconstruction) row.reconstruction = true;
    if (e.method !== 'polyhaven') row.method = `${e.edit ? 'Qwen-Image-Edit-2511 + ' : ''}TRELLIS.2 (Bild zu 3D)`;
    return row;
  });
  const out = path.join(ROOT, 'site/data/credits/assets.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(rows, null, 2) + '\n');
}

const ids = process.argv.slice(2);
for (const e of MANIFEST.filter((e) => !ids.length || ids.includes(e.id))) {
  if (e.method === 'polyhaven') await fetchPolyHaven(e);
  else if (e.source.url) await fetchCommons(e);
}
if (MANIFEST.every((e) => e.method !== 'polyhaven' || fs.existsSync(path.join(CACHE, 'polyhaven', e.polyhaven.id, 'info.json')))) writeCredits();
