// Builds one diorama map: node tools/maps/build.mjs <tuebingen|muenchen|nuernberg>
// Output: site/models/maps/<city>.glb (Y up, north toward -Z, origin at the bottom center of the base,
// longest side 1.0, meshopt compressed) and its credit row in site/data/credits/maps.json.
import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureTransform } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { CITIES } from './cities.mjs';
import { osm, dem } from './fetch.mjs';
import { extract, circleRing, chainLines, clipLine, resample, offsetLine, smoothLine, lineLength, inPoly, projector, ringArea } from './geo.mjs';
import { Bucket, P3, srgb, mul, mix, addBuilding, addSolid, addTerrain, addBase, ribbonRing, treeMesh, mulberry } from './meshes.mjs';
import { facadeTexture, timberTexture, stoneTexture, roofTexture, woodTexture, waterNormalTexture, groundTexture } from './textures.mjs';
import * as M from './movers.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const BUDGET = { tris: 150_000, bytes: 3 * 1024 * 1024 };

await MeshoptSimplifier.ready;
const simplify = (idx, pos, errorMeters) => MeshoptSimplifier.simplify(new Uint32Array(idx), new Float32Array(pos), 3, 0, errorMeters, ['LockBorder', 'ErrorAbsolute'])[0];
const city = CITIES[process.argv[2]];
if (!city) throw new Error(`usage: build.mjs <${Object.keys(CITIES).join('|')}>`);
const R = city.radius;
const V = city.style.v ?? 1.4;
const rnd = mulberry(7);

const elements = await osm(city);
const elev = await dem(city);
const f = extract(elements, city.center, R);
const xy = projector(city.center);
const [lat0, lon0] = city.center;
const k = 111_320, kx = k * Math.cos((lat0 * Math.PI) / 180);
const demAt = (x, y) => elev(lat0 + y / k, lon0 + x / kx);
const demS = (x, y) => {
  let s = 0;
  for (const dx of [-9, 0, 9]) for (const dy of [-9, 0, 9]) s += demAt(x + dx, y + dy);
  return s / 9;
};

// Landmarks: centroid of the named element, logged so a wrong center is obvious.
const named = new Map();
for (const { name, el } of f.named) {
  if (named.has(name)) continue;
  const pts = el.geometry ? el.geometry.map(xy) : (el.members || []).flatMap((m) => (m.geometry || []).map(xy));
  if (pts.length) named.set(name, [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]);
}
for (const n of city.landmarks) {
  const p = named.get(n);
  console.log(`landmark ${n}: ${p ? `${p[0].toFixed(0)} E, ${p[1].toFixed(0)} N, ${Math.hypot(...p).toFixed(0)} m from center` : 'MISSING'}`);
}

// Parts replace their parent outline (Simple 3D Buildings rule) and inherit its look.
for (const p of f.parts) p.isPart = true;
for (const b of f.buildings) {
  const inside = f.parts.filter((p) => {
    const c = p.outer.reduce((s, q) => [s[0] + q[0] / p.outer.length, s[1] + q[1] / p.outer.length], [0, 0]);
    return inPoly(c, b);
  });
  if (!inside.length) continue;
  b.skip = inside.reduce((sum, p) => sum + Math.abs(ringArea(p.outer)), 0) > 0.6 * Math.abs(ringArea(b.outer));
  for (const p of inside) {
    p.parent = b;
    p.landmark ||= b.landmark;
    p.color ||= b.color;
    p.material ||= b.material;
    p.roofColor ||= b.roofColor;
  }
}
const buildings = [...f.buildings.filter((b) => !b.skip), ...f.parts];

const { texture: groundTex, water, blocked } = await groundTexture(f, R, city.style.ground);
const waterVerts = f.water.flatMap((w) => w.outer).filter(([x, y]) => Math.hypot(x, y) < R - 2);
const wl = waterVerts.length ? waterVerts.map(([x, y]) => demS(x, y)).sort((a, b) => a - b)[Math.floor(waterVerts.length * 0.2)] : null;
let zMin = Infinity, zMax = -Infinity;
for (let x = -R; x <= R; x += 20) for (let y = -R; y <= R; y += 20) if (Math.hypot(x, y) <= R) { zMin = Math.min(zMin, demS(x, y)); zMax = Math.max(zMax, demS(x, y)); }
if (wl != null) zMin = Math.min(zMin, wl - 3);
const T = 0.045 * 2 * R;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const H = (x, y) => {
  let z = demS(x, y);
  if (wl != null) {
    z = Math.max(z, wl + 0.8);
    z += (wl - 2.2 - z) * smooth(0.25, 0.75, water(x, y));
  }
  return T + (z - zMin) * V;
};
const waterY = wl != null ? T + (wl - zMin) * V : null;
console.log(`terrain: ${zMin.toFixed(1)} to ${zMax.toFixed(1)} m above sea, water level ${wl?.toFixed(1) ?? 'none'}, heights exaggerated x${V}`);

const B = Object.fromEntries(['terrain', 'soil', 'wood', 'plaster', 'timber', 'stone', 'masonry', 'roof', 'water', 'foliage'].map((n) => [n, new Bucket()]));

// ---- buildings ----
const NAMED_COLORS = { white: '#ece8df', grey: '#b9b5ad', gray: '#b9b5ad', beige: '#e0cfa8', yellow: '#e2c77c', red: '#a8553f', brown: '#7a5338', orange: '#d29a5c', pink: '#d8aa9c', green: '#7f9a72', black: '#3a3a3a', darkred: '#7d3a2c', maroon: '#7d3a2c', tan: '#d2b48c', silver: '#c0c0c0', lightgrey: '#d3d3d3' };
const parseColor = (v) => {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((c) => c + c).join('');
  return NAMED_COLORS[s] ?? null;
};
const hash = (id, salt) => mulberry((Number(id) % 2147483647) ^ salt)();
const ROOFS = ['#a4523a', '#9a4b36', '#8d4431', '#b0603f', '#7f4a3a', '#93503b', '#a85a44'];
const wallMaterial = (b) => (b.landmark ? 'stone' : hash(b.parent?.id ?? b.id, 3) < city.style.timber && !b.isPart ? 'timber' : 'plaster');
const ctx = {
  buckets: B, V,
  simplify,
  groundAt: (p) => H(p[0], p[1]),
  defaultLevels: (b) => city.style.levels[hash(b.id, 1) < 0.55 ? 0 : 1],
  wallMaterial,
  wallScale: { plaster: [6.4, 6.2 * V], timber: [10, 6.2 * V], stone: [8, 16 * V] },
  // Tagged colors are often too bright for a lit model, so they lean toward the material's real tone.
  wallTone: (b) => {
    const real = b.material === 'brick' ? srgb('#9c5a40') : wallMaterial(b) === 'stone' ? srgb('#cdb894') : null;
    const tag = parseColor(b.color);
    if (tag) return real ? mix(srgb(tag), real, 0.6) : mul(srgb(tag), 0.92);
    if (real) return real;
    const pal = city.style.walls;
    return mul(srgb(pal[Math.floor(hash(b.parent?.id ?? b.id, 2) * pal.length)]), 0.95 + hash(b.id, 5) * 0.08);
  },
  roofTone: (b) => {
    const tag = parseColor(b.roofColor);
    if (tag) return mix(mul(srgb(tag), 0.8), srgb('#8a4a36'), 0.25);
    if (b.landmark) return srgb('#7d4535');
    return mul(srgb(ROOFS[Math.floor(hash(b.parent?.id ?? b.id, 4) * ROOFS.length)]), 0.85 + hash(b.id, 6) * 0.25);
  },
};
for (const b of buildings) {
  const parentGround = b.parent && Math.min(...b.parent.outer.map((p) => H(p[0], p[1])));
  ctx.groundAt = b.parent ? () => parentGround : (p) => H(p[0], p[1]);
  addBuilding(b, ctx);
}

// ---- bridges and city walls ----
const decks = [];
const stoneCol = srgb('#b9ab92');
for (const ring of f.bridges.map((b) => b.outer)) {
  const land = ring.filter(([x, y]) => water(x, y) < 0.3).map(([x, y]) => H(x, y));
  const deck = Math.max(land.length ? Math.max(...land) : 0, (waterY ?? T) + 4 * V);
  addSolid(B.masonry, ring, deck, (waterY ?? T) - 3, stoneCol, 4);
  decks.push({ ring, h: deck });
}
const inRing = (p, ring) => inPoly(p, { outer: ring, holes: [] });
for (const r of f.roads.filter((r) => r.bridge && r.width >= 2)) {
  const mid = r.line[Math.floor(r.line.length / 2)];
  if (decks.some((d) => inRing(mid, d.ring))) continue;
  const ends = [r.line[0], r.line[r.line.length - 1]].map(([x, y]) => H(x, y));
  const deck = Math.max(...ends, (waterY ?? T) + 3 * V);
  for (const run of clipLine(r.line, R - 1)) {
    const ring = ribbonRing(run, r.width);
    addSolid(B.masonry, ring, deck, deck - 1.5 * V, mul(stoneCol, 0.9), 4);
    decks.push({ ring, h: deck });
  }
}
for (const w of f.walls) {
  for (const seg of chunk(resample(w, 3), 5)) {
    if (seg.length < 2) continue;
    const ring = ribbonRing(seg, 2.4);
    const g = seg.map(([x, y]) => H(x, y));
    addSolid(B.masonry, ring, Math.max(...g) + 7 * V, Math.min(...g) - 1, srgb('#b49e7e'), 4);
  }
}
function chunk(a, n) { const out = []; for (let i = 0; i < a.length - 1; i += n - 1) out.push(a.slice(i, i + n)); return out; }
const surfaceAt = (x, y) => Math.max(H(x, y), ...decks.filter((d) => inRing([x, y], d.ring)).map((d) => d.h));

// ---- water, terrain, base ----
// One water disc at river level; the terrain sits above it on land and dips below it in the riverbed,
// so islands and shorelines come from the terrain and no polygon holes need meshing.
if (waterY != null) {
  const ring = circleRing(R - 0.5, 96);
  const c = B.water.v(P3(0, 0, waterY), [0, 1, 0], [0, 0]);
  const ids = ring.map(([x, y]) => B.water.v(P3(x, y, waterY), [0, 1, 0], [x / 40, -y / 40]));
  ids.forEach((id, i) => B.water.t(c, id, ids[(i + 1) % ids.length]));
}
addTerrain(B.terrain, R, 4, H);
B.terrain = simplified(B.terrain, 0.3);

// Collapses flat stretches; UVs and normals stay valid because both follow the surface position.
function simplified(b, errorMeters) {
  const idx = simplify(b.idx, b.pos, errorMeters);
  const out = new Bucket();
  const remap = new Map();
  for (const i of idx) {
    if (!remap.has(i)) remap.set(i, out.v(b.pos.slice(i * 3, i * 3 + 3), b.nor.slice(i * 3, i * 3 + 3), b.uv.slice(i * 2, i * 2 + 2), b.col.slice(i * 3, i * 3 + 3)));
    out.idx.push(remap.get(i));
  }
  console.log(`terrain simplified ${b.tris} -> ${out.tris} triangles`);
  return out;
}
let rimMin = Infinity;
for (let i = 0; i < 360; i++) rimMin = Math.min(rimMin, H(Math.cos((i * Math.PI) / 180) * R, Math.sin((i * Math.PI) / 180) * R));
const frameTop = Math.max(T * 0.7, rimMin - 1.5 * V);
const outerR = addBase(B, R, H, frameTop);

// ---- movers ----
const nodes = [];
const E = { person: 4, horse: 2.8, sheep: 3.5, bird: 11, pigeon: 9, swan: 4.5, raft: 1.1, boat: 2.2 };
const bobAnims = [0, 0.5].map((ph) => ({ T: M.periodic(0.5, 2, (u) => [0, ((u + ph) % 1 < 0.5 ? 0.25 : 0), 0]) }));
const flapAnims = [1, -1].map((side) => ({
  R: M.periodic(3, 10, (u) => M.quatX(side * (u < 0.53 ? [0.5, -0.45][Math.floor(u * 15) % 2] : 0.12))),
}));
const leaf = (mesh, scale = 1, T = [0, 0, 0]) => ({ mesh, S: [scale, scale, scale], T, children: [] });

const chainFor = (names) => {
  const roads = f.roads.filter((r) => names.includes(r.name));
  if (!roads.length) return null;
  const runs = chainLines(roads.map((r) => r.line)).flatMap((c) => clipLine(c, R - 10)).sort((a, b) => lineLength(b) - lineLength(a));
  if (!runs[0] || lineLength(runs[0]) < 25) return null;
  runs[0].width = Math.max(...roads.map((r) => r.width));
  return runs[0];
};
const subLine = (line, start, len) => {
  const pts = resample(line, 3);
  const n = Math.min(pts.length, Math.max(3, Math.round(len / 3)));
  const s = Math.floor(start * Math.max(0, pts.length - n));
  return smoothLine(pts.slice(s, s + n), 3);
};
const lap = (line, lane) => {
  const fwd = offsetLine(line, -lane), back = offsetLine(line, lane).reverse();
  return [...fwd, ...back];
};
const to3 = (pts, lift = 0.05) => pts.map(([x, y]) => P3(x, y, surfaceAt(x, y) + lift));
const pathLaps = (pts, speed) => Math.max(1, Math.round(lineLength([...pts, pts[0]]) / (speed * M.D)));

const COATS = ['#6b2b24', '#2f3e5a', '#4d5a3a', '#6a5236', '#3a3a42', '#7a6a4a', '#5a2f45', '#2d4a4a', '#8a6a3a'];
const DRESSES = ['#7a3a2e', '#3e4b6b', '#6b6a4a', '#5a3a50', '#8a7a5a', '#4a5a6a'];
const people = [
  ...COATS.map((c) => M.person({ coat: c })),
  ...DRESSES.map((c) => M.person({ coat: c, skirt: true, hat: null, cap: true })),
];
const moverCount = {};
const count = (k) => (moverCount[k] = (moverCount[k] || 0) + 1);

function walker(line, i, spec) {
  const sub = subLine(line, rnd(), spec.len);
  const pts = resample(lap(sub, 1.2 + rnd() * line.width * 0.35), 3);
  const keys = M.follow(to3(pts), { laps: pathLaps(pts, 6), phase: rnd() });
  const mesh = people[Math.floor(rnd() * people.length)];
  nodes.push({ name: `walker_${i}`, anim: { T: keys, R: keys }, children: [{ anim: bobAnims[i % 2], children: [leaf(mesh, E.person)] }] });
  count('people');
}

for (const spec of city.movers.streets || []) {
  const line = chainFor(spec.names);
  if (!line) { console.log(`streets ${spec.names.join('/')}: not found, skipped`); continue; }
  for (let i = 0; i < spec.count; i++) walker(line, nodes.length, spec);
}

for (const spec of city.movers.carriages || []) {
  const line = chainFor(spec.names);
  if (!line) { console.log(`carriage ${spec.names.join('/')}: not found, skipped`); continue; }
  for (let i = 0; i < spec.count; i++) {
    const sub = subLine(line, (i + 0.5) / spec.count, spec.len);
    const pts = resample(lap(sub, 3), 3);
    const keys = M.follow(to3(pts), { laps: pathLaps(pts, 11), phase: i / spec.count });
    nodes.push({ name: `carriage_${i}`, anim: { T: keys, R: keys }, children: [leaf(M.carriage(['#5b1f1a', '#1f2f4a', '#2f3f2a'][i % 3]), E.horse)] });
    count('carriages');
  }
}

if (city.movers.procession) {
  const spec = city.movers.procession;
  const line = chainFor(spec.names);
  const near = named.get(spec.near);
  if (line && near) {
    const pts0 = resample(line, 3);
    let best = 0;
    pts0.forEach((p, i) => { if (Math.hypot(p[0] - near[0], p[1] - near[1]) < Math.hypot(pts0[best][0] - near[0], pts0[best][1] - near[1])) best = i; });
    const n = Math.round(spec.len / 3);
    const s = Math.max(0, Math.min(pts0.length - n, best - Math.round(n / 2)));
    const pts = resample(lap(smoothLine(pts0.slice(s, s + n), 3), 2.5), 2);
    const L = lineLength([...pts, pts[0]]);
    const order = [M.crossBearer(), M.bannerBearer('#c9a646'), M.bannerBearer('#8e1b22'),
      M.person({ coat: '#efe9dc', robe: true, hat: null }), M.person({ coat: '#efe9dc', robe: true, hat: null }),
      M.person({ coat: '#1f1d1c', robe: true, hat: null }), M.person({ coat: '#1f1d1c', robe: true, hat: null }),
      M.canopy(), ...people.slice(0, 6)];
    order.forEach((mesh, i) => {
      const keys = M.follow(to3(pts), { laps: 1, phase: 0.2 - (i * 7.5) / L - (i > 7 ? 4 / L : 0) });
      nodes.push({ name: `procession_${i}`, anim: { T: keys, R: keys }, children: [{ anim: bobAnims[i % 2], children: [leaf(mesh, E.person)] }] });
      count('procession');
    });
  } else console.log('procession path not found');
}

const riverChain = (names) => {
  const lines = f.rivers.filter((r) => names.includes(r.name) && r.kind === 'river').map((r) => r.line);
  return lines.length ? chainLines(lines, true)[0] : null;
};
if (city.movers.river && waterY != null) {
  const spec = city.movers.river;
  const line = riverChain(spec.names);
  if (line) {
    const pts = smoothLine(resample(line, 6), 3).map(([x, y]) => P3(x, y, waterY + 0.1));
    console.log(`river ${spec.names[0]}: ${lineLength(line).toFixed(0)} m across the map`);
    for (let i = 0; i < spec.count; i++) {
      const keys = M.follow(pts, { laps: 1, phase: i / spec.count, closed: false });
      const mesh = spec.kind === 'raft' ? M.raft(11 + i) : M.boat(21 + i);
      const lane = (i % 2 ? -1 : 1) * 4;
      nodes.push({ name: `${spec.kind}_${i}`, anim: { T: keys, R: keys, S: keys }, children: [leaf(mesh, E[spec.kind], [0, 0, lane])] });
      count(spec.kind === 'raft' ? 'rafts' : 'boats');
    }
  } else console.log(`river ${spec.names} not found`);
}

if (city.movers.swans && waterY != null) {
  const line = riverChain(city.movers.swans.names);
  if (line) {
    const pts = resample(line, 4);
    for (let i = 0; i < city.movers.swans.count; i++) {
      const c = pts[Math.floor(pts.length * (0.25 + 0.5 * (i / Math.max(1, city.movers.swans.count - 1))))];
      const ph = rnd() * Math.PI * 2;
      const loop = Array.from({ length: 16 }, (_, j) => {
        const a = (j / 16) * Math.PI * 2;
        return [c[0] + Math.cos(a + ph) * 9, c[1] + Math.sin(a + ph) * 4];
      }).filter(([x, y]) => water(x, y) > 0.6);
      if (loop.length < 6) continue;
      const keys = M.follow(loop.map(([x, y]) => P3(x, y, waterY + 0.05)), { laps: 2, phase: rnd() });
      nodes.push({ name: `swan_${i}`, anim: { T: keys, R: keys }, children: [leaf(M.swan(), E.swan)] });
      count('swans');
    }
  }
}

if (city.movers.sheep) {
  const spec = city.movers.sheep;
  const area = f.areas.filter((a) => a.name === spec.area).sort((a, b) => Math.abs(ringArea(b.outer)) - Math.abs(ringArea(a.outer)))[0];
  if (area) {
    const xs = area.outer.map((p) => p[0]), ys = area.outer.map((p) => p[1]);
    const free = (x, y) => inPoly([x, y], area) && blocked(x, y) < 0.5 && Math.hypot(x, y) < R - 15;
    let home = null;
    for (let tries = 0; tries < 2000 && !home; tries++) {
      const x = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys));
      if ([[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]].every(([dx, dy]) => free(x + dx, y + dy))) home = [x, y];
    }
    if (home) {
      console.log(`flock on ${spec.area} at ${home.map((v) => v.toFixed(0)).join(', ')}`);
      const sheepMeshes = [1, 2, 3, 4].map((s) => M.sheep(s));
      for (let i = 0; i < spec.count; i++) {
        let c;
        for (let t = 0; t < 50; t++) { c = [home[0] + (rnd() - 0.5) * 34, home[1] + (rnd() - 0.5) * 34]; if (free(...c)) break; }
        const rx = 3 + rnd() * 4, ry = 2 + rnd() * 3, ph = rnd() * Math.PI * 2, dir = rnd() < 0.5 ? 1 : -1;
        const loop = Array.from({ length: 14 }, (_, j) => {
          const a = dir * (j / 14) * Math.PI * 2 + ph;
          return [c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry];
        });
        const keys = M.follow(to3(loop, 0), { laps: 1 + (i % 2), phase: rnd() });
        nodes.push({ name: `sheep_${i}`, anim: { T: keys, R: keys }, children: [leaf(sheepMeshes[i % 4], E.sheep)] });
        count('sheep');
      }
      const ring = (r, n) => Array.from({ length: n }, (_, j) => [home[0] + Math.cos((j / n) * Math.PI * 2) * r, home[1] + Math.sin((j / n) * Math.PI * 2) * r]);
      const sk = M.follow(to3(ring(26, 24), 0), { laps: 1, phase: 0.1 });
      nodes.push({ name: 'shepherd', anim: { T: sk, R: sk }, children: [{ anim: bobAnims[0], children: [leaf(M.shepherd(), E.person)] }] });
      const dk = M.follow(to3(ring(32, 24).reverse(), 0), { laps: 3, phase: 0.6 });
      nodes.push({ name: 'dog', anim: { T: dk, R: dk }, children: [{ anim: bobAnims[1], children: [leaf(M.dog(), E.sheep)] }] });
      count('shepherd'); count('dog');
    } else console.log('no free spot for the flock');
  } else console.log(`area ${spec.area} not found`);
}

const birdMeshes = {};
function bird(kind, center, radius, height, i, scale) {
  birdMeshes[kind] ||= M.birdParts(kind);
  const parts = birdMeshes[kind];
  const n = 24, dir = i % 2 ? 1 : -1;
  const r = radius * (0.85 + rnd() * 0.3);
  const cx = Math.max(-R + r + 15, Math.min(R - r - 15, center[0])), cy = Math.max(-R + r + 15, Math.min(R - r - 15, center[1]));
  const y = T + height * V * (0.9 + rnd() * 0.2);
  const pts = Array.from({ length: n }, (_, j) => {
    const a = dir * (j / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, y + Math.sin(a * 2) * 3, -(cy + Math.sin(a) * r)];
  });
  const speed = kind === 'pigeon' ? 14 : 22;
  const laps = Math.max(1, Math.round((2 * Math.PI * r) / (speed * M.D)));
  const keys = M.follow(pts, { laps, phase: rnd(), bank: dir * -0.35 });
  nodes.push({
    name: `${kind}_${i}`, anim: { T: keys, R: keys },
    children: [{ S: [scale, scale, scale], children: [
      leaf(parts.body),
      { T: [0, 0.02, 0], anim: flapAnims[0], children: [leaf(parts.left)] },
      { T: [0, 0.02, 0], anim: flapAnims[1], children: [leaf(parts.right)] },
    ] }],
  });
  count('birds');
}
for (const spec of city.movers.birds || []) {
  const c = spec.at ? named.get(spec.at) : [0, 0];
  if (!c) { console.log(`birds: ${spec.at} not found`); continue; }
  for (let i = 0; i < spec.count; i++) bird(spec.kind, c, spec.radius, spec.height, i, E.bird);
}
if (city.movers.pigeons) {
  const spec = city.movers.pigeons;
  const c = named.get(spec.at);
  if (c) for (let i = 0; i < spec.count; i++) bird('pigeon', [c[0] - 60, c[1] - 20], spec.radius, spec.height, i, E.pigeon);
}

// ---- trees, fitted into whatever triangle budget is left ----
const treeVariants = Array.from({ length: 8 }, (_, i) => treeMesh(100 + i));
const treeTris = Math.max(...treeVariants.map((t) => t.tris));
const moverTris = (n) => (n.mesh ? n.mesh.tris : 0) + (n.children || []).reduce((s, c) => s + moverTris(c), 0);
const staticTris = Object.values(B).reduce((s, b) => s + b.tris, 0);
const movingTris = nodes.reduce((s, n) => s + moverTris(n), 0);
const room = Math.floor((BUDGET.tris * 0.97 - staticTris - movingTris) / treeTris);
const scatter = [];
const density = { forest: 1 / 70, grass: 1 / 380, scrub: 1 / 160, vineyard: 0, farmland: 1 / 2500, plaza: 0 };
for (const a of f.areas) {
  const area = Math.abs(ringArea(a.outer));
  const n = Math.floor(area * (density[a.kind] || 0));
  const xs = a.outer.map((p) => p[0]), ys = a.outer.map((p) => p[1]);
  for (let i = 0, made = 0; i < n * 4 && made < n; i++) {
    const p = [Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys))];
    if (Math.hypot(...p) < R - 5 && inPoly(p, a) && blocked(...p) < 0.5) { scatter.push(p); made++; }
  }
}
const trees = [...f.trees, ...scatter].filter(([x, y]) => blocked(x, y) < 0.9 || f.trees.some((t) => t[0] === x && t[1] === y)).slice(0, Math.max(0, room));
for (const [x, y] of trees) {
  const r = 3.6 + rnd() * 2.2;
  const a = rnd() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  const sv = r * 1.05;
  B.foliage.add(treeVariants[Math.floor(rnd() * treeVariants.length)], [c * r, 0, s * r, 0, sv, 0, -s * r, 0, c * r], P3(x, y, H(x, y) - 0.3));
}
console.log(`triangles by bucket: ${Object.entries(B).map(([n, b]) => `${n} ${b.tris}`).join(', ')}`);
console.log(`trees: ${trees.length} placed (${f.trees.length} mapped, ${scatter.length} scattered, room for ${room})`);

// ---- write ----
const outerDiameter = 2 * outerR;
const scale = 1 / outerDiameter;
const file = `${ROOT}site/models/maps/${city.id}.glb`;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const doc = new Document();
const buffer = doc.createBuffer();
doc.createExtension(EXTTextureWebP).setRequired(true);
const tex = async (name, img) => {
  const data = await img;
  console.log(`texture ${name}: ${(data.length / 1024).toFixed(0)} KB`);
  return doc.createTexture(name).setImage(data).setMimeType('image/webp');
};
const T_ = { ground: await tex('ground', groundTex), plaster: await tex('plaster', facadeTexture()), timber: await tex('timber', timberTexture()), stone: await tex('stone', stoneTexture()), masonry: await tex('masonry', stoneTexture(false)), roof: await tex('roof', roofTexture()), wood: await tex('wood', woodTexture()), waterN: await tex('water_normal', waterNormalTexture()) };
const mat = (name, { tex: t, rough = 0.9, metal = 0, color = [1, 1, 1, 1], doubleSided = false } = {}) => {
  const m = doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(rough).setMetallicFactor(metal).setDoubleSided(doubleSided);
  if (t) m.setBaseColorTexture(t);
  return m;
};
const MATS = {
  terrain: mat('ground', { tex: T_.ground, rough: 0.95 }),
  soil: mat('soil', { rough: 1 }),
  wood: mat('walnut_frame', { tex: T_.wood, rough: 0.42 }),
  plaster: mat('plaster', { tex: T_.plaster, rough: 0.92 }),
  timber: mat('half_timber', { tex: T_.timber, rough: 0.9 }),
  stone: mat('sandstone', { tex: T_.stone, rough: 0.88 }),
  masonry: mat('masonry', { tex: T_.masonry, rough: 0.9 }),
  roof: mat('roof_tiles', { tex: T_.roof, rough: 0.72 }),
  water: mat('water', { rough: 0.12, color: [0.045, 0.075, 0.08, 1] }).setNormalTexture(T_.waterN).setNormalScale(0.35),
  foliage: mat('foliage', { rough: 0.85 }),
  mover: mat('figures', { rough: 0.75, doubleSided: true }),
};
MATS.terrain.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);

const acc = (arr, type, Ctor) => doc.createAccessor().setType(type).setArray(new Ctor(arr)).setBuffer(buffer);
const textureTransform = doc.createExtension(KHRTextureTransform);

// Tiled UVs: shift each connected face group by whole tiles (invisible with repeat wrapping), then store
// them in [0, 1] with a KHR_texture_transform so quantization can pack them like every other attribute.
function packUV(b, material) {
  const parent = Int32Array.from({ length: b.pos.length / 3 }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let t = 0; t < b.idx.length; t += 3) for (const j of [1, 2]) parent[find(b.idx[t + j])] = find(b.idx[t]);
  const lo = new Map();
  for (let i = 0; i < parent.length; i++) {
    const r = find(i), m = lo.get(r) || [Infinity, Infinity];
    lo.set(r, [Math.min(m[0], b.uv[i * 2]), Math.min(m[1], b.uv[i * 2 + 1])]);
  }
  const uv = b.uv.slice();
  for (let i = 0; i < parent.length; i++) { const m = lo.get(find(i)); uv[i * 2] -= Math.floor(m[0]); uv[i * 2 + 1] -= Math.floor(m[1]); }
  const min = [0, 1].map((k) => Math.min(...uv.filter((_, i) => i % 2 === k)));
  const range = [0, 1].map((k) => Math.max(...uv.filter((_, i) => i % 2 === k)) - min[k] || 1);
  for (const info of [material.getBaseColorTextureInfo(), material.getNormalTextureInfo()]) {
    if (info) info.setExtension('KHR_texture_transform', textureTransform.createTransform().setOffset(min).setScale(range));
  }
  return uv.map((v, i) => (v - min[i % 2]) / range[i % 2]);
}
const prim = (b, material) => {
  const tiled = b.uv.some((v) => v < 0 || v > 1);
  const p = doc.createPrimitive()
    .setAttribute('POSITION', acc(b.pos.map((v) => v * scale), 'VEC3', Float32Array))
    .setAttribute('NORMAL', acc(b.nor, 'VEC3', Float32Array))
    .setIndices(acc(b.idx, 'SCALAR', Uint32Array))
    .setMaterial(material);
  if (material.getBaseColorTexture() || material.getNormalTexture()) p.setAttribute('TEXCOORD_0', acc(tiled ? packUV(b, material) : b.uv, 'VEC2', Float32Array));
  if (b.col.some((c) => c !== 1)) p.setAttribute('COLOR_0', acc(b.col, 'VEC3', Float32Array));
  return p;
};

const scene = doc.createScene(city.id);
doc.getRoot().setDefaultScene(scene);
const mapMesh = doc.createMesh('diorama');
for (const [name, b] of Object.entries(B)) if (b.tris) mapMesh.addPrimitive(prim(b, MATS[name]));
scene.addChild(doc.createNode('diorama').setMesh(mapMesh));

const meshCache = new Map();
const anim = doc.createAnimation('movers');
const samplerCache = new Map();
// Key sets shared by many nodes (walking bob, wing flaps) become one sampler.
const sampler = (keys, path) => {
  if (!samplerCache.has(keys)) samplerCache.set(keys, {});
  const per = samplerCache.get(keys);
  if (per[path]) return per[path];
  const t = keys.t;
  let v = path === 'translation' ? (keys.v || keys.T) : path === 'rotation' ? (keys.v || keys.R) : keys.S;
  if (path === 'translation') v = v.map((p) => p.map((c) => c * scale));
  const s = doc.createAnimationSampler().setInput(acc(t, 'SCALAR', Float32Array)).setOutput(acc(v.flat(), path === 'rotation' ? 'VEC4' : 'VEC3', Float32Array)).setInterpolation('LINEAR');
  anim.addSampler(s);
  per[path] = s;
  return s;
};
const build = (n, name) => {
  const node = doc.createNode(n.name || name);
  if (n.T) node.setTranslation(n.T.map((c) => c * scale));
  if (n.S) node.setScale(n.S);
  if (n.mesh) {
    if (!meshCache.has(n.mesh)) meshCache.set(n.mesh, doc.createMesh().addPrimitive(prim(n.mesh, MATS.mover)));
    node.setMesh(meshCache.get(n.mesh));
  }
  for (const [path, keyName] of [['translation', 'T'], ['rotation', 'R'], ['scale', 'S']]) {
    const keys = n.anim?.[keyName];
    if (!keys) continue;
    anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler(keys, path)));
  }
  for (const c of n.children || []) node.addChild(build(c, `${node.getName()}_part`));
  return node;
};
const moversRoot = doc.createNode('movers');
scene.addChild(moversRoot);
for (const n of nodes) moversRoot.addChild(build(n, 'mover'));

await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'high', quantizeTexcoord: 14 }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(`${ROOT}site/models/maps`, { recursive: true });
await io.write(file, doc);

// ---- verify the written file, not the in-memory scene ----
const back = await io.read(file);
let tris = 0;
const walk = (node) => {
  const mesh = node.getMesh();
  if (mesh) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  node.listChildren().forEach(walk);
};
back.getRoot().getDefaultScene().listChildren().forEach(walk);
const staticBounds = getBounds(back.getRoot().listNodes().find((n) => n.getName() === 'diorama'));
const size = fs.statSync(file).size;
const ext = staticBounds.max.map((v, i) => v - staticBounds.min[i]);
const anims = back.getRoot().listAnimations();
console.log(`movers: ${JSON.stringify(moverCount)}`);
console.log(`${file.replace(ROOT, '')}: ${(size / 1024 / 1024).toFixed(2)} MB, ${tris} triangles (static ${staticTris}, movers ${movingTris}, trees ${trees.length * treeTris}), extent ${ext.map((v) => v.toFixed(3)).join(' x ')}, min y ${staticBounds.min[1].toFixed(4)}, ${anims.length} clip ${anims[0]?.getName()} with ${anims[0]?.listChannels().length} channels`);

const credits = `${ROOT}site/data/credits/maps.json`;
const rows = fs.existsSync(credits) ? JSON.parse(fs.readFileSync(credits, 'utf8')) : [];
const mine = [
  { id: `map-${city.id}-osm`, file: `site/models/maps/${city.id}.glb`, title: `${city.title}: Gebäude, Straßen, Wasser, Bäume`, author: '© OpenStreetMap contributors', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' },
  { id: `map-${city.id}-terrain`, file: `site/models/maps/${city.id}.glb`, title: `${city.title}: Geländehöhen (Terrain Tiles)`, author: 'Mapzen. Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers. SRTM terrain data courtesy of the U.S. Geological Survey.', license: 'Attribution required (terrain tiles attribution page)', url: 'https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md' },
];
const merged = [...rows.filter((r) => !mine.some((m) => m.id === r.id)), ...mine].sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(credits, JSON.stringify(merged, null, 2) + '\n');

if (tris > BUDGET.tris || size > BUDGET.bytes) { console.error('OVER BUDGET'); process.exit(1); }
