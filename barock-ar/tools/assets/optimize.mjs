// node tools/assets/optimize.mjs [id ...]
// Raw model (Poly Haven glTF or the box's TRELLIS.2 GLB) -> site/models/<zone>/<id>.glb following the contract:
// +Y up, front +Z, origin at the bbox center, longest side 1.0, WebP textures, meshopt, under budget.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clearNodeTransform, dedup, flatten, meshopt, prune, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

export const BUDGET = {
  heads: { bytes: 2.5e6, tris: 100000, px: 2048 },
  prop: { bytes: 1.5e6, tris: 60000, px: 1024 },
};
export const budgetFor = (e) => BUDGET[e.zone === 'heads' ? 'heads' : 'prop'];

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'assets.json'), 'utf8'));
const CACHE = path.join(import.meta.dirname, '.cache');
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});

export const countTris = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

function rawPath(e, seed = e.meshSeed ?? 0) {
  if (e.method !== 'polyhaven') return path.join(CACHE, 'gen', e.id, `raw-s${seed}.glb`);
  const dir = path.join(CACHE, 'polyhaven', e.polyhaven.id);
  if (!fs.existsSync(dir)) return path.join(dir, 'missing.gltf');
  return path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.gltf')));
}

function normalize(doc, e) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (e.polyhaven?.keep) {
    const re = new RegExp(e.polyhaven.keep);
    for (const n of root.listNodes()) if (n.getMesh() && !re.test(n.getName())) n.dispose();
  }
  const [rx, ry, rz] = (e.rotate ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const wrap = doc.createNode('wrap').setRotation(eulerToQuat(rx, ry, rz));
  for (const c of scene.listChildren()) { scene.removeChild(c); wrap.addChild(c); }
  scene.addChild(wrap);
  if (e.metallic !== undefined) for (const m of root.listMaterials()) m.setMetallicFactor(e.metallic);
  return { scene };
}

function eulerToQuat(x, y, z) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x / 2), Math.sin(x / 2), Math.cos(y / 2), Math.sin(y / 2), Math.cos(z / 2), Math.sin(z / 2)];
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}

async function bake(doc, scene) {
  await doc.transform(flatten());
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
  await doc.transform(prune());
  const { min, max } = getBounds(scene);
  const s = 1 / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const c = min.map((v, i) => (v + max[i]) / 2);
  const m = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -c[0] * s, -c[1] * s, -c[2] * s, 1];
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m);
}

export async function optimize(e, raw = rawPath(e), out = path.join(ROOT, 'site/models', e.zone, `${e.id}.glb`)) {
  const b = budgetFor(e);
  let bytes = Infinity;
  for (const [px, quality] of [[b.px, 88], [b.px, 75], [b.px, 62], [b.px / 2, 85], [b.px / 2, 70], [b.px / 4, 80]]) {
    const doc = await io.read(raw);
    const { scene } = normalize(doc, e);
    await bake(doc, scene);
    await doc.transform(weld());
    const tris = countTris(doc);
    if (tris > b.tris * 0.97) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: (b.tris * 0.95) / tris, error: 0.01 }));
    await doc.transform(
      dedup(), prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [px, px], quality }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const glb = await io.writeBinary(doc);
    bytes = glb.byteLength;
    if (bytes <= b.bytes) {
      fs.writeFileSync(out, glb);
      console.log(`${path.basename(out)}: ${(bytes / 1e6).toFixed(2)} MB, ${countTris(doc)} tris, textures <= ${px}px q${quality}`);
      return;
    }
  }
  throw new Error(`${e.id}: still ${(bytes / 1e6).toFixed(2)} MB at the smallest texture setting`);
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  const sweep = args.indexOf('--sweep');
  if (sweep >= 0) {
    const e = MANIFEST.find((e) => e.id === args[0]);
    for (const s of args[sweep + 1].split(',')) await optimize(e, rawPath(e, s), path.join(ROOT, 'test/out/assets/sweep', `${e.id}-s${s}.glb`));
    process.exit(0);
  }
  for (const e of MANIFEST.filter((e) => !args.length || args.includes(e.id))) {
    if (!fs.existsSync(rawPath(e))) { console.log(`${e.id}: no raw model yet, run gen.sh ${e.id}`); continue; }
    await optimize(e);
  }
}
