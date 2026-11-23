// node tools/assets/simplify.mjs [id ...]   Cuts the shipped models in site/models down to the triangle budget in
// place, leaving their textures as they are. optimize.mjs does the same when it builds a model from its raw source;
// this is for models whose raw source is not on this machine.
import fs from 'node:fs';
import path from 'node:path';
import { meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { budgetFor, countTris, io } from './optimize.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'assets.json'), 'utf8'));
const out = process.env.OUT;
const TARGET = { heads: 45000, prop: 18000 };
const args = process.argv.slice(2);
for (const e of MANIFEST.filter((e) => !args.length || args.includes(e.id))) {
  const file = path.join(ROOT, 'site/models', e.zone, `${e.id}.glb`);
  const doc = await io.read(file);
  const before = countTris(doc), { tris } = budgetFor(e);
  if (before <= tris) { console.log(`${e.id}: ${before} tris, within ${tris}`); continue; }
  // Most props reach TARGET within the 1 % error optimize.mjs also allows; the rest stop where their shape would go.
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(tris, TARGET[e.zone === 'heads' ? 'heads' : 'prop']) * 0.95 / before, error: 0.01 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const target = out ? path.join(out, `${e.id}.glb`) : file;
  fs.writeFileSync(target, await io.writeBinary(doc));
  console.log(`${e.id}: ${before} -> ${countTris(doc)} tris, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB -> ${(fs.statSync(target).size / 1e6).toFixed(2)} MB`);
}
