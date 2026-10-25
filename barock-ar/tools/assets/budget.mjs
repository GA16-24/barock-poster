// node tools/assets/budget.mjs   Prints size, triangles and largest texture of every GLB in assets.json.
// Exits 1 if any file is missing, over budget, not WebP, not meshopt-compressed, or not normalized.
import fs from 'node:fs';
import path from 'node:path';
import { getBounds } from '@gltf-transform/core';
import sharp from 'sharp';
import { budgetFor, countTris, io } from './optimize.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'assets.json'), 'utf8'));

let fail = 0, total = 0;
console.log('id'.padEnd(13), 'MB'.padStart(5), 'tris'.padStart(7), 'tex px'.padStart(7), ' problems');
for (const e of MANIFEST) {
  const file = path.join(ROOT, 'site/models', e.zone, `${e.id}.glb`);
  if (!fs.existsSync(file)) { console.log(e.id.padEnd(13), 'MISSING'); fail++; continue; }
  const b = budgetFor(e);
  const bytes = fs.statSync(file).size;
  total += bytes;
  const doc = await io.read(file);
  const root = doc.getRoot();
  const tris = countTris(doc);
  let px = 0;
  const problems = [];
  for (const t of root.listTextures()) {
    if (t.getMimeType() !== 'image/webp') problems.push(`texture ${t.getMimeType()}`);
    const m = await sharp(Buffer.from(t.getImage())).metadata();
    px = Math.max(px, m.width, m.height);
  }
  const used = root.listExtensionsUsed().map((x) => x.extensionName);
  if (!used.includes('EXT_meshopt_compression')) problems.push('no meshopt');
  if (bytes > b.bytes) problems.push(`> ${b.bytes / 1e6} MB`);
  if (tris > b.tris) problems.push(`> ${b.tris} tris`);
  if (px > b.px) problems.push(`> ${b.px} px`);
  const { min, max } = getBounds(root.listScenes()[0]);
  const longest = Math.max(...max.map((v, i) => v - min[i]));
  const off = Math.max(...max.map((v, i) => Math.abs(v + min[i]) / 2));
  if (Math.abs(longest - 1) > 0.01 || off > 0.01) problems.push(`bbox longest ${longest.toFixed(3)} center off ${off.toFixed(3)}`);
  if (problems.length) fail++;
  console.log(e.id.padEnd(13), (bytes / 1e6).toFixed(2).padStart(5), String(tris).padStart(7), String(px).padStart(7), ' ' + (problems.join('; ') || 'ok'));
}
console.log(`total ${(total / 1e6).toFixed(2)} MB, ${fail} failing`);
process.exit(fail ? 1 : 0);
