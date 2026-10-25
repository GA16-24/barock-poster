// Static geometry in meters: x east, y north in 2D; 3D is [x, height, -y] so north faces -Z.
import { ShapeUtils, Vector2 } from 'three';
import { ringArea } from './geo.mjs';

export const P3 = (x, y, h) => [x, h, -y];

export class Bucket {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  v(p, n, uv = [0, 0], c = [1, 1, 1]) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  t(a, b, c) { this.idx.push(a, b, c); }
  get tris() { return this.idx.length / 3; }
  // Appends another bucket, transformed by a 3x3 matrix (row-major, applied to columns) and an offset.
  add(o, m = [1, 0, 0, 0, 1, 0, 0, 0, 1], off = [0, 0, 0], tint = null) {
    const base = this.pos.length / 3;
    const tr = (v, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + v[0], m[3] * x + m[4] * y + m[5] * z + v[1], m[6] * x + m[7] * y + m[8] * z + v[2]];
    for (let i = 0; i < o.pos.length; i += 3) {
      const p = tr(off, o.pos[i], o.pos[i + 1], o.pos[i + 2]);
      const n = tr([0, 0, 0], o.nor[i], o.nor[i + 1], o.nor[i + 2]);
      const l = Math.hypot(...n) || 1;
      const c = tint ? [o.col[i] * tint[0], o.col[i + 1] * tint[1], o.col[i + 2] * tint[2]] : [o.col[i], o.col[i + 1], o.col[i + 2]];
      this.v(p, [n[0] / l, n[1] / l, n[2] / l], [o.uv[(i / 3) * 2], o.uv[(i / 3) * 2 + 1]], c);
    }
    for (const k of o.idx) this.idx.push(k + base);
  }
}

export const srgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
};
export const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// Earcut through three.js. Returns triangles as [a, b, c] points, each counter-clockwise seen from above.
export function triangulate(outer, holes = []) {
  const pts = [outer, ...holes].flat();
  const faces = ShapeUtils.triangulateShape(outer.map(([x, y]) => new Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new Vector2(x, y))));
  return faces.map(([a, b, c]) => {
    const t = [pts[a], pts[b], pts[c]];
    return ringArea(t) < 0 ? [t[0], t[2], t[1]] : t;
  });
}

// Splits every triangle until no edge is longer than `maxLen`, consistently per edge so no cracks open.
export function refine(tris, maxLen) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  for (let round = 0; round < 8; round++) {
    const mids = new Map();
    const long = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) > maxLen;
    const mid = (a, b) => {
      if (!long(a, b)) return null;
      const k = [key(a), key(b)].sort().join('|');
      if (!mids.has(k)) mids.set(k, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      return mids.get(k);
    };
    let changed = false;
    const out = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      const n = !!ab + !!bc + !!ca;
      if (!n) { out.push([a, b, c]); continue; }
      changed = true;
      if (n === 3) out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      else if (n === 1) {
        if (ab) out.push([a, ab, c], [ab, b, c]);
        else if (bc) out.push([a, b, bc], [a, bc, c]);
        else out.push([a, b, ca], [ca, b, c]);
      } else if (!ca) out.push([a, ab, c], [ab, bc, c], [ab, b, bc]);
      else if (!ab) out.push([a, b, ca], [ca, b, bc], [ca, bc, c]);
      else out.push([a, ab, ca], [ab, b, c], [ab, c, ca]);
    }
    tris = out;
    if (!changed) break;
  }
  return tris;
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && crossZ(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && crossZ(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// Minimum-area oriented box: center, long axis, half length, half width.
export function obb(ring) {
  const h = hull(ring);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const ax = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], pp = [-ax[1], ax[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) {
      const u = q[0] * ax[0] + q[1] * ax[1], v = q[0] * pp[0] + q[1] * pp[1];
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      best = { area, c: [cu * ax[0] + cv * pp[0], cu * ax[1] + cv * pp[1]], ax, pp, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2 };
    }
  }
  if (best.hw > best.hl) best = { ...best, ax: best.pp, pp: [-best.pp[0], -best.pp[1]], hl: best.hw, hw: best.hl };
  if (Math.abs(best.pp[0] * best.ax[1] - best.pp[1] * best.ax[0]) < 0.5) best.pp = [-best.ax[1], best.ax[0]];
  return best;
}

const centroid = (ring) => {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f; a += f;
  }
  return Math.abs(a) < 1e-9 ? ring[0] : [x / (3 * a), y / (3 * a)];
};

const clipHalf = (ring, [A, B, C]) => {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const sp = A * p[0] + B * p[1] + C, sq = A * q[0] + B * q[1] + C;
    if (sp <= 0) out.push(p);
    if ((sp <= 0) !== (sq <= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
};

const planeAt = (pl, p) => pl.A * p[0] + pl.B * p[1] + pl.C;

// Roof planes over the oriented box. Height = min over planes.
function boxPlanes(o, eave, rise, hip) {
  const k = rise / o.hw;
  const cv = o.c[0] * o.pp[0] + o.c[1] * o.pp[1], cu = o.c[0] * o.ax[0] + o.c[1] * o.ax[1];
  const pl = (dir, s, cd, h0) => ({ A: -s * k * dir[0], B: -s * k * dir[1], C: h0 + s * k * cd, dir: [s * dir[0], s * dir[1]] });
  const out = [pl(o.pp, 1, cv, eave + rise), pl(o.pp, -1, cv, eave + rise)];
  if (hip) out.push(pl(o.ax, 1, cu, eave + k * o.hl), pl(o.ax, -1, cu, eave + k * o.hl));
  return out;
}

function distToRings(p, rings) {
  let d = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j], b = r[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
  }
  return d;
}

function emitTri3(bucket, a, b, c, uvf, col) {
  let n = norm(cross(sub(b, a), sub(c, a)));
  if (n[1] < 0) { [b, c] = [c, b]; n = n.map((x) => -x); }
  const i = bucket.v(a, n, uvf(a), col), j = bucket.v(b, n, uvf(b), col), k = bucket.v(c, n, uvf(c), col);
  bucket.t(i, j, k);
}

// One building or building part. `top(p)` gives the roof height above which the walls end.
export function addBuilding(b, ctx) {
  const { buckets, V, groundAt } = ctx;
  const rings = [b.outer, ...b.holes];
  const ground = Math.min(...b.outer.map((p) => groundAt(p)));
  const bottom = ground + (b.minHeight || 0) * V - (b.minHeight ? 0 : 1.2);
  const area = Math.abs(ringArea(b.outer));
  const box = obb(b.outer);
  const rect = area / (4 * box.hl * box.hw);

  let shape = b.roofShape;
  const small = ['garage', 'garages', 'shed', 'carport', 'hut', 'kiosk', 'service', 'toilets'].includes(b.kind);
  if (!shape) {
    if (b.isPart) shape = 'flat';
    else if (small) shape = 'flat';
    else if (b.holes.length || rect < 0.72 || area > 900) shape = 'skeleton';
    else shape = 'gabled';
  }
  if (shape === 'skillion' && b.roofDirection == null) shape = 'gabled';
  if (['gambrel', 'round', 'saltbox', 'double_saltbox', 'quadruple_saltbox'].includes(shape)) shape = 'gabled';
  if (['half-hipped', 'mansard', 'side_hipped', 'gabled_height_moved'].includes(shape)) shape = 'hipped';
  if (['cone', 'spire', 'tented', 'pyramid'].includes(shape)) shape = 'pyramidal';
  if (!['flat', 'gabled', 'hipped', 'skillion', 'pyramidal', 'dome', 'onion', 'skeleton'].includes(shape)) shape = 'skeleton';
  if ((shape === 'gabled' || shape === 'hipped') && (b.holes.length || rect < 0.6)) shape = 'skeleton';

  const defaultRise = Math.min(14, Math.max(2.5, box.hw * Math.tan((48 * Math.PI) / 180)));
  let roofH = b.roofHeight ?? (b.roofLevels ? b.roofLevels * 2.8 : shape === 'flat' ? 0 : shape === 'pyramidal' ? Math.max(box.hw * 2.2, 6) : shape === 'dome' || shape === 'onion' ? box.hw * 1.6 : defaultRise);
  let total;
  if (b.height) total = b.height;
  else if (b.levels) total = b.levels * 3.1 + roofH + (b.minHeight || 0);
  else if (b.landmark && !b.isPart) total = 16 + roofH;
  else if (small) total = 3.2;
  else total = (b.isPart ? 3 : ctx.defaultLevels(b)) * 3.1 + roofH + (b.minHeight || 0);
  if (shape === 'flat') roofH = 0;
  roofH = Math.min(roofH, (total - (b.minHeight || 0)) * 0.85);
  const eave = ground + (total - roofH) * V;
  const rise = roofH * V;

  let top;
  let planes = null;
  if (shape === 'skillion') {
    // roof:direction is the compass bearing the slope faces, so the roof rises the opposite way
    const a = (b.roofDirection * Math.PI) / 180, d = [Math.sin(a), Math.cos(a)];
    const proj = b.outer.map((p) => p[0] * d[0] + p[1] * d[1]);
    const lo = Math.min(...proj), span = Math.max(...proj) - lo || 1;
    const k = rise / span;
    planes = [{ A: -k * d[0], B: -k * d[1], C: eave + rise + k * lo, dir: d }];
    top = (p) => planeAt(planes[0], p);
  } else if (shape === 'gabled' || shape === 'hipped') {
    planes = boxPlanes(box, eave, rise, shape === 'hipped');
    top = (p) => Math.max(eave, Math.min(...planes.map((pl) => planeAt(pl, p))));
  } else if (shape === 'skeleton') {
    const k = Math.tan((42 * Math.PI) / 180) * V;
    top = (p) => eave + Math.min(distToRings(p, rings) * k, Math.max(rise, 3 * V));
  } else top = () => eave;

  const tone = ctx.wallTone(b);
  const wall = buckets[ctx.wallMaterial(b)];
  const scale = ctx.wallScale[ctx.wallMaterial(b)];
  for (const ring of rings) {
    let along = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.05) continue;
      const ts = [0, 1];
      if (planes) {
        for (let m = 0; m < planes.length; m++) for (let n = m + 1; n < planes.length; n++) {
          const g = (p) => planeAt(planes[m], p) - planeAt(planes[n], p);
          const ga = g(a), gc = g(c);
          if ((ga < 0) !== (gc < 0) && Math.abs(ga - gc) > 1e-9) ts.push(ga / (ga - gc));
        }
      }
      ts.sort((x, y) => x - y);
      const nx = (c[1] - a[1]) / len, ny = -(c[0] - a[0]) / len;
      const n3 = [nx, 0, -ny];
      for (let s = 0; s + 1 < ts.length; s++) {
        if (ts[s + 1] - ts[s] < 1e-6) continue;
        const p = [a[0] + (c[0] - a[0]) * ts[s], a[1] + (c[1] - a[1]) * ts[s]];
        const q = [a[0] + (c[0] - a[0]) * ts[s + 1], a[1] + (c[1] - a[1]) * ts[s + 1]];
        const up = along + len * ts[s], uq = along + len * ts[s + 1];
        const tp = top(p), tq = top(q);
        const mid = Math.min(ground + 4 * V, tp - 0.1, tq - 0.1);
        const levels = mid > bottom + 0.5 ? [bottom, mid] : [bottom];
        const ao = (h) => Math.min(1, 0.5 + 0.5 * Math.min(1, (h - ground) / (4 * V)));
        const rows = [...levels.map((h) => [h, h]), [tp, tq]];
        for (let r = 0; r + 1 < rows.length; r++) {
          const [h0p, h0q] = rows[r], [h1p, h1q] = rows[r + 1];
          const uv = (u, h) => [u / scale[0], -(h - ground) / scale[1]];
          const i0 = wall.v(P3(p[0], p[1], h0p), n3, uv(up, h0p), mul(tone, ao(h0p)));
          const i1 = wall.v(P3(q[0], q[1], h0q), n3, uv(uq, h0q), mul(tone, ao(h0q)));
          const i2 = wall.v(P3(q[0], q[1], h1q), n3, uv(uq, h1q), mul(tone, ao(h1q)));
          const i3 = wall.v(P3(p[0], p[1], h1p), n3, uv(up, h1p), mul(tone, ao(h1p)));
          wall.t(i0, i1, i2); wall.t(i0, i2, i3);
        }
      }
      along += len;
    }
  }

  const roofCol = ctx.roofTone(b);
  const roof = buckets.roof;
  if (planes) {
    for (const pl of planes) {
      let region = b.outer;
      for (const other of planes) {
        if (other === pl) continue;
        region = clipHalf(region, [pl.A - other.A, pl.B - other.B, pl.C - other.C]);
        if (region.length < 3) break;
      }
      if (region.length < 3 || Math.abs(ringArea(region)) < 0.05) continue;
      const n = norm([-pl.A, 1, pl.B]);
      const perp = [-pl.dir[1], pl.dir[0]];
      const shared = new Map();
      const vert = (p) => {
        const key = `${p[0]},${p[1]}`;
        if (!shared.has(key)) shared.set(key, roof.v(P3(p[0], p[1], planeAt(pl, p)), n, [(p[0] * perp[0] + p[1] * perp[1]) / 3, (p[0] * pl.dir[0] + p[1] * pl.dir[1]) / 3], roofCol));
        return shared.get(key);
      };
      for (const t of triangulate(region)) roof.t(...t.map(vert));
    }
  } else if (shape === 'skeleton') {
    // Sample the distance roof finely, then let the simplifier keep only the creases.
    const ids = new Map(), pos = [], idx = [];
    for (const t of refine(triangulate(b.outer, b.holes), 1.2)) for (const p of t) {
      const k = `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
      if (!ids.has(k)) { ids.set(k, pos.length / 3); pos.push(...P3(p[0], p[1], top(p))); }
      idx.push(ids.get(k));
    }
    const kept = ctx.simplify(idx, pos, 0.25);
    const at = (i) => pos.slice(kept[i] * 3, kept[i] * 3 + 3);
    for (let i = 0; i < kept.length; i += 3) emitTri3(roof, at(i), at(i + 1), at(i + 2), (p) => [p[0] / 3, p[2] / 3], roofCol);
  } else if (shape === 'pyramidal') {
    const c = centroid(b.outer);
    const apex = P3(c[0], c[1], eave + rise);
    const ring = b.outer;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], d = ring[(i + 1) % ring.length];
      emitTri3(roof, P3(a[0], a[1], eave), P3(d[0], d[1], eave), apex, (p) => [(p[0] + p[2]) / 3, p[1] / 3], roofCol);
    }
  } else if (shape === 'dome' || shape === 'onion') {
    const c = centroid(b.outer);
    const r = Math.sqrt(area / Math.PI);
    const prof = shape === 'onion'
      ? [[1, 0], [1.12, 0.12], [1.18, 0.25], [1.05, 0.4], [0.72, 0.56], [0.4, 0.7], [0.22, 0.8], [0.22, 0.88], [0.1, 0.95], [0, 1]]
      : [[1, 0], [0.97, 0.25], [0.87, 0.5], [0.66, 0.75], [0.36, 0.93], [0, 1]];
    const seg = 14;
    const ringPts = prof.map(([f, t]) => Array.from({ length: seg }, (_, k) => {
      const a = (k / seg) * Math.PI * 2;
      return P3(c[0] + Math.cos(a) * r * f, c[1] + Math.sin(a) * r * f, eave + rise * t);
    }));
    for (let i = 0; i + 1 < ringPts.length; i++) for (let k = 0; k < seg; k++) {
      const a = ringPts[i][k], bq = ringPts[i][(k + 1) % seg], cq = ringPts[i + 1][(k + 1) % seg], d = ringPts[i + 1][k];
      emitDomeQuad(roof, a, bq, cq, d, [c[0], eave, -c[1]], roofCol);
    }
    flatCap(roof, b, eave, roofCol);
  } else flatCap(roof, b, eave, roofCol);
}

function emitDomeQuad(bucket, a, b, c, d, center, col) {
  const out = (p) => norm([p[0] - center[0], (p[1] - center[1]) * 0.6 + 0.4, p[2] - center[2]]);
  const uv = (p) => [Math.atan2(p[2] - center[2], p[0] - center[0]) * 2, p[1] / 3];
  const ids = [a, b, c, d].map((p) => bucket.v(p, out(p), uv(p), col));
  bucket.t(ids[0], ids[1], ids[2]); bucket.t(ids[0], ids[2], ids[3]);
}

function flatCap(bucket, b, h, col) {
  for (const t of triangulate(b.outer, b.holes)) {
    const ids = t.map((p) => bucket.v(P3(p[0], p[1], h), [0, 1, 0], [p[0] / 3, p[1] / 3], col));
    bucket.t(...ids);
  }
}

// Extruded solid (bridges, walls): flat top at `topH`, sides down to `bottomH`.
export function addSolid(bucket, ring, topH, bottomH, col, uvScale = 4) {
  if (ringArea(ring) < 0) ring = ring.slice().reverse();
  for (const t of triangulate(ring)) bucket.t(...t.map((p) => bucket.v(P3(p[0], p[1], topH), [0, 1, 0], [p[0] / uvScale, p[1] / uvScale], col)));
  let along = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.01) continue;
    const n = [(c[1] - a[1]) / len, 0, (c[0] - a[0]) / len];
    const ids = [[a, bottomH, along], [c, bottomH, along + len], [c, topH, along + len], [a, topH, along]]
      .map(([p, h, u]) => bucket.v(P3(p[0], p[1], h), n, [u / uvScale, -h / uvScale], mul(col, h === bottomH ? 0.6 : 1)));
    bucket.t(ids[0], ids[1], ids[2]); bucket.t(ids[0], ids[2], ids[3]);
    along += len;
  }
}

// A polyline widened into a closed ring.
export function ribbonRing(line, width) {
  const l = [], r = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    l.push([line[i][0] + nx * width / 2, line[i][1] + ny * width / 2]);
    r.push([line[i][0] - nx * width / 2, line[i][1] - ny * width / 2]);
  }
  return l.concat(r.reverse());
}

// Terrain disc: a grid whose outside vertices are pulled onto the circle, colored by the ground texture.
export function addTerrain(bucket, radius, cell, H) {
  const n = Math.ceil(radius / cell) + 1;
  const idx = new Map();
  const vid = (i, j) => {
    const k = `${i},${j}`;
    if (idx.has(k)) return idx.get(k);
    let x = i * cell, y = j * cell;
    const d = Math.hypot(x, y);
    if (d > radius) { x *= radius / d; y *= radius / d; }
    const e = 0.5;
    const nrm = norm([H(x - e, y) - H(x + e, y), 2 * e, -(H(x, y - e) - H(x, y + e))]);
    const id = bucket.v(P3(x, y, H(x, y)), nrm, [(x + radius) / (2 * radius), (radius - y) / (2 * radius)]);
    idx.set(k, id);
    return id;
  };
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const cx = (i + 0.5) * cell, cy = (j + 0.5) * cell;
    if (Math.hypot(cx, cy) > radius + cell * 0.75) continue;
    const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
    // CCW from above in (x, y)
    bucket.t(a, b, c); bucket.t(a, c, d);
  }
}

// Cut soil around the terrain edge plus the wooden frame and plinth.
export function addBase(buckets, radius, H, frameTop) {
  const seg = 192;
  const soil = buckets.soil, wood = buckets.wood;
  const ring = Array.from({ length: seg + 1 }, (_, i) => (i / seg) * Math.PI * 2);
  const layers = [srgb('#6b5a45'), srgb('#7d6a50'), srgb('#5e4f3d'), srgb('#857256')];
  for (let i = 0; i < seg; i++) {
    const a0 = ring[i], a1 = ring[i + 1];
    const p0 = [Math.cos(a0) * radius, Math.sin(a0) * radius], p1 = [Math.cos(a1) * radius, Math.sin(a1) * radius];
    const h0 = H(p0[0], p0[1]) + 0.2, h1 = H(p1[0], p1[1]) + 0.2;
    const n0 = [Math.cos(a0), 0, -Math.sin(a0)], n1 = [Math.cos(a1), 0, -Math.sin(a1)];
    const steps = [frameTop, ...[0.25, 0.5, 0.75].map((t) => frameTop + (Math.min(h0, h1) - frameTop) * t), null];
    for (let s = 0; s + 1 < steps.length; s++) {
      const lo0 = steps[s], lo1 = steps[s];
      const hi0 = steps[s + 1] ?? h0, hi1 = steps[s + 1] ?? h1;
      const c = layers[s % layers.length];
      const ids = [soil.v(P3(...p0, lo0), n0, [0, 0], c), soil.v(P3(...p1, lo1), n1, [0, 0], c), soil.v(P3(...p1, hi1), n1, [0, 0], c), soil.v(P3(...p0, hi0), n0, [0, 0], c)];
      soil.t(ids[0], ids[1], ids[2]); soil.t(ids[0], ids[2], ids[3]);
    }
  }
  const frameW = radius * 0.035, plinthW = frameW * 0.35;
  const walnut = srgb('#5a3a22'), dark = srgb('#3e2716');
  // top annulus, outer wall, step, plinth wall, bottom
  const profile = [
    [radius, frameTop, walnut], [radius + frameW, frameTop, walnut], [radius + frameW, frameTop * 0.42, walnut],
    [radius + frameW + plinthW, frameTop * 0.42, dark], [radius + frameW + plinthW, 0, dark], [0, 0, dark],
  ];
  const lathe = (r0, y0, r1, y1, col) => {
    const dr = r1 - r0, dy = y1 - y0;
    const len = Math.hypot(dr, dy);
    for (let i = 0; i < seg; i++) {
      const a0 = ring[i], a1 = ring[i + 1];
      const nn = (a) => norm([-Math.cos(a) * dy / len, dr / len, Math.sin(a) * dy / len]);
      const pt = (r, y, a) => [Math.cos(a) * r, y, -Math.sin(a) * r];
      const uv = (r, y, a) => [a * radius / 40, (r + (frameTop - y)) / 40];
      const ids = [[r0, y0, a0], [r0, y0, a1], [r1, y1, a1], [r1, y1, a0]].map(([r, y, a]) => wood.v(pt(r, y, a), nn(a), uv(r, y, a), col));
      wood.t(ids[0], ids[2], ids[1]); wood.t(ids[0], ids[3], ids[2]);
    }
  };
  for (let i = 0; i + 1 < profile.length; i++) lathe(profile[i][0], profile[i][1], profile[i + 1][0], profile[i + 1][1], profile[i][2]);
  return radius + frameW + plinthW;
}

// A leafy tree: trunk plus a lumpy canopy with smooth normals and darker underside.
export function treeMesh(seed) {
  const rnd = mulberry(seed);
  const m = new Bucket();
  const bark = srgb('#4a3a2a');
  const sides = 5, tr = 0.35;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const ids = [[a0, 0], [a1, 0], [a1, 1], [a0, 1]].map(([a, y]) => m.v([Math.cos(a) * tr, y, -Math.sin(a) * tr], [Math.cos(a), 0, -Math.sin(a)], [0, 0], mul(bark, 0.6 + 0.4 * y)));
    m.t(ids[0], ids[1], ids[2]); m.t(ids[0], ids[2], ids[3]);
  }
  const canopy = [icosphere(1), icosphere(0)];
  const greens = ['#4a5d2e', '#55683a', '#3f5129', '#5e6e3e', '#465a32', '#525f36'].map(srgb);
  const g = greens[Math.floor(rnd() * greens.length)];
  const blobs = [[0, 0, 0, 1]];
  for (let k = 0; k < 2; k++) { const a = rnd() * Math.PI * 2; blobs.push([Math.cos(a) * 0.45, -0.15 + rnd() * 0.3, Math.sin(a) * 0.45, 0.6 + rnd() * 0.15]); }
  for (const [bx, by, bz, s] of blobs) {
    const base = m.pos.length / 3;
    const ico = canopy[s === 1 ? 0 : 1];
    ico.verts.forEach(([x, y, z]) => {
      const j = 0.85 + rnd() * 0.3;
      const p = [bx + x * s * j, 1.8 + by + y * s * j * 0.9, bz + z * s * j];
      const shade = 0.55 + 0.45 * Math.min(1, Math.max(0, (y + 1) / 1.6));
      m.v(p, norm([x, y, z]), [0, 0], mul(g, shade * (0.9 + rnd() * 0.2)));
    });
    for (const [a, b, c] of ico.faces) m.t(base + a, base + b, base + c);
  }
  return m;
}

export function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map();
    const midpoint = (a, b) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!cache.has(k)) { verts.push(norm(verts[a].map((v, i) => (v + verts[b][i]) / 2))); cache.set(k, verts.length - 1); }
      return cache.get(k);
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  return { verts, faces };
}

export function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

