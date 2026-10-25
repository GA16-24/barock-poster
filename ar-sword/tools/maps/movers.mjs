// Moving things. Meshes are built in meters at real size with their front along +X and feet at y = 0;
// the node scale enlarges them so they read at diorama size. Tracks are keyframes that loop over D seconds.
import { Bucket, srgb, mul, icosphere, mulberry } from './meshes.mjs';

export const D = 60;

const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

function frustum(m, { r0, r1, y0, y1, sides = 7, col, x = 0, z = 0, sx = 1, sz = 1, cap = true }) {
  const ring = (r, y) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [x + Math.cos(a) * r * sx, y, z - Math.sin(a) * r * sz];
  });
  const lo = ring(r0, y0), hi = ring(r1, y1);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const a = (i / sides) * Math.PI * 2, b = (j / sides) * Math.PI * 2;
    const slope = (r0 - r1) / (y1 - y0 || 1);
    const na = norm([Math.cos(a), slope, -Math.sin(a)]), nb = norm([Math.cos(b), slope, -Math.sin(b)]);
    const ids = [m.v(lo[i], na, [0, 0], col), m.v(lo[j], nb, [0, 0], col), m.v(hi[j], nb, [0, 0], col), m.v(hi[i], na, [0, 0], col)];
    m.t(ids[0], ids[1], ids[2]); m.t(ids[0], ids[2], ids[3]);
  }
  if (cap && r1 > 0) {
    const c = m.v([x, y1, z], [0, 1, 0], [0, 0], col);
    const ids = hi.map((p) => m.v(p, [0, 1, 0], [0, 0], col));
    for (let i = 0; i < sides; i++) m.t(c, ids[i], ids[(i + 1) % sides]);
  }
}

function blob(m, { c, s, col, detail = 0, rnd = null, shade = true }) {
  const ico = icosphere(detail);
  const base = m.pos.length / 3;
  for (const v of ico.verts) {
    const j = rnd ? 0.9 + rnd() * 0.2 : 1;
    const k = shade ? 0.7 + 0.3 * (v[1] + 1) / 2 : 1;
    m.v([c[0] + v[0] * s[0] * j, c[1] + v[1] * s[1] * j, c[2] + v[2] * s[2] * j], norm([v[0] / s[0], v[1] / s[1], v[2] / s[2]]), [0, 0], mul(col, k));
  }
  for (const [a, b, d] of ico.faces) m.t(base + a, base + b, base + d);
}

function box(m, { c, s, col, rotZ = 0 }) {
  const [hx, hy, hz] = s.map((v) => v / 2);
  const cz = Math.cos(rotZ), sz = Math.sin(rotZ);
  const tr = ([x, y, z]) => [c[0] + x * cz - y * sz, c[1] + x * sz + y * cz, c[2] + z];
  const trn = ([x, y, z]) => [x * cz - y * sz, x * sz + y * cz, z];
  const faces = [
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  for (const [n, q] of faces) {
    const ids = q.map((p) => m.v(tr(p), trn(n), [0, 0], col));
    m.t(ids[0], ids[1], ids[2]); m.t(ids[0], ids[2], ids[3]);
  }
}

const SKIN = srgb('#d9a882');

// A Baroque townsperson. `look` picks coat, breeches or skirt colors and the hat.
export function person({ coat, legs = '#3a3330', hat = '#2a2522', skirt = false, robe = false, cap = false }) {
  const m = new Bucket();
  const C = srgb(coat);
  if (skirt || robe) frustum(m, { r0: skirt ? 0.36 : 0.3, r1: 0.19, y0: 0, y1: 1.0, col: C, cap: false });
  else {
    frustum(m, { r0: 0.08, r1: 0.09, y0: 0, y1: 0.85, x: 0, z: 0.1, col: srgb(legs), sides: 5 });
    frustum(m, { r0: 0.08, r1: 0.09, y0: 0, y1: 0.85, x: 0, z: -0.1, col: srgb(legs), sides: 5 });
    frustum(m, { r0: 0.27, r1: 0.21, y0: 0.55, y1: 1.0, col: C, cap: false });
  }
  frustum(m, { r0: 0.21, r1: 0.17, y0: 1.0, y1: 1.45, col: C });
  frustum(m, { r0: 0.06, r1: 0.06, y0: 0.95, y1: 1.4, x: 0.02, z: 0.24, col: C, sides: 4 });
  frustum(m, { r0: 0.06, r1: 0.06, y0: 0.95, y1: 1.4, x: 0.02, z: -0.24, col: C, sides: 4 });
  blob(m, { c: [0, 1.58, 0], s: [0.11, 0.13, 0.11], col: SKIN, detail: 1 });
  if (cap) blob(m, { c: [-0.01, 1.66, 0], s: [0.12, 0.07, 0.12], col: srgb('#f1ece2') });
  else if (hat) {
    frustum(m, { r0: 0.22, r1: 0.2, y0: 1.66, y1: 1.7, col: srgb(hat), sides: 3 });
    frustum(m, { r0: 0.11, r1: 0.1, y0: 1.66, y1: 1.8, col: srgb(hat), sides: 6 });
  }
  return m;
}

export function horse(colorHex) {
  const m = new Bucket();
  const c = srgb(colorHex), dark = mul(c, 0.55);
  blob(m, { c: [0, 1.25, 0], s: [0.95, 0.42, 0.34], col: c, detail: 1 });
  for (const [x, z] of [[0.6, 0.18], [0.6, -0.18], [-0.6, 0.18], [-0.6, -0.18]]) box(m, { c: [x, 0.5, z], s: [0.14, 1.0, 0.13], col: dark });
  box(m, { c: [1.05, 1.65, 0], s: [0.55, 0.3, 0.24], col: c, rotZ: 0.9 });
  box(m, { c: [1.35, 1.85, 0], s: [0.5, 0.22, 0.2], col: c, rotZ: -0.35 });
  box(m, { c: [-0.95, 1.2, 0], s: [0.12, 0.7, 0.1], col: dark, rotZ: -0.3 });
  return m;
}

export function carriage(bodyHex = '#5b1f1a') {
  const m = new Bucket();
  const body = srgb(bodyHex), trim = srgb('#b08a3c'), wheel = srgb('#2b2420');
  box(m, { c: [0, 1.55, 0], s: [2.0, 1.2, 1.35], col: body });
  box(m, { c: [0, 2.22, 0], s: [2.2, 0.14, 1.5], col: mul(body, 0.6) });
  box(m, { c: [0, 2.32, 0], s: [0.25, 0.08, 0.25], col: trim });
  box(m, { c: [0.15, 1.65, 0.69], s: [0.6, 0.55, 0.02], col: srgb('#1d2328') });
  box(m, { c: [0.15, 1.65, -0.69], s: [0.6, 0.55, 0.02], col: srgb('#1d2328') });
  box(m, { c: [1.35, 1.25, 0], s: [0.7, 0.12, 1.1], col: mul(body, 0.7) });
  for (const [x, r] of [[0.85, 0.5], [-0.75, 0.62]]) for (const z of [0.78, -0.78]) {
    const sides = 10;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      box(m, { c: [x + Math.cos(a) * r * 0.95, r + Math.sin(a) * r * 0.95, z], s: [0.08, 0.36 * r, 0.07], col: wheel, rotZ: a });
    }
    box(m, { c: [x, r, z], s: [r * 1.6, 0.05, 0.04], col: wheel });
    box(m, { c: [x, r, z], s: [0.05, r * 1.6, 0.04], col: wheel });
  }
  box(m, { c: [2.0, 1.05, 0], s: [1.6, 0.06, 0.06], col: wheel });
  const coachman = person({ coat: '#2d3a4a', hat: '#1e1a18' });
  m.add(coachman, [0.9, 0, 0, 0, 0.9, 0, 0, 0, 0.9], [1.4, 1.1, 0]);
  m.add(horse('#6b4a30'), undefined, [3.2, 0, 0.45]);
  m.add(horse('#3d2d22'), undefined, [3.2, 0, -0.45]);
  return m;
}

// A Neckar timber raft: sections of lashed logs with two raftsmen and their poles.
export function raft(seed) {
  const rnd = mulberry(seed);
  const m = new Bucket();
  const woods = ['#8a6a48', '#7a5c3e', '#94744f', '#6e5236'].map(srgb);
  const logs = 7, r = 0.32, len = 14;
  for (let s = 0; s < 3; s++) {
    const x0 = -s * (len + 0.8);
    for (let i = 0; i < logs; i++) {
      const z = (i - (logs - 1) / 2) * r * 2;
      const col = woods[Math.floor(rnd() * woods.length)];
      const sides = 6;
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
        const p = (a, x) => [x, r + Math.sin(a) * r, z + Math.cos(a) * r];
        const n = (a) => [0, Math.sin(a), Math.cos(a)];
        const ids = [m.v(p(a0, x0 - len / 2), n(a0), [0, 0], col), m.v(p(a1, x0 - len / 2), n(a1), [0, 0], col), m.v(p(a1, x0 + len / 2), n(a1), [0, 0], col), m.v(p(a0, x0 + len / 2), n(a0), [0, 0], col)];
        m.t(ids[0], ids[2], ids[1]); m.t(ids[0], ids[3], ids[2]);
      }
    }
    box(m, { c: [x0 + len * 0.35, 0.68, 0], s: [0.25, 0.1, logs * r * 2], col: srgb('#4e3a28') });
    box(m, { c: [x0 - len * 0.35, 0.68, 0], s: [0.25, 0.1, logs * r * 2], col: srgb('#4e3a28') });
  }
  const man = person({ coat: '#5d4b3a', legs: '#3b342c', hat: '#2f2a24' });
  const big = 2.4;
  for (const [x, z] of [[len * 0.3, 0.4], [-2 * (len + 0.8) - len * 0.2, -0.3]]) {
    m.add(man, [big, 0, 0, 0, big, 0, 0, 0, big], [x, 0.64, z]);
    box(m, { c: [x + 1.2, 2.6, z + 0.8], s: [0.12, 7.5, 0.12], col: srgb('#a08458'), rotZ: -0.35 });
  }
  return m;
}

// A flat-bottomed Pegnitz punt with a boatman and some cargo.
export function boat(seed) {
  const rnd = mulberry(seed);
  const m = new Bucket();
  const hull = srgb(['#6a4b31', '#5c4130', '#77563a'][Math.floor(rnd() * 3)]);
  const L = 7, W = 1.5, Hh = 0.55;
  const st = [-1, -0.7, 0, 0.7, 1];
  const width = (u) => W / 2 * (1 - 0.75 * Math.abs(u) ** 3);
  const rise = (u) => 0.25 * Math.abs(u) ** 2;
  for (let i = 0; i + 1 < st.length; i++) {
    const [u0, u1] = [st[i], st[i + 1]];
    const x0 = u0 * L / 2, x1 = u1 * L / 2;
    for (const s of [1, -1]) {
      const pts = [[x0, rise(u0), s * width(u0) * 0.75], [x1, rise(u1), s * width(u1) * 0.75], [x1, Hh + rise(u1), s * width(u1)], [x0, Hh + rise(u0), s * width(u0)]];
      const n = [0, -0.2, s];
      const ids = pts.map((p) => m.v(p, norm(n), [0, 0], hull));
      if (s > 0) { m.t(ids[0], ids[1], ids[2]); m.t(ids[0], ids[2], ids[3]); } else { m.t(ids[0], ids[2], ids[1]); m.t(ids[0], ids[3], ids[2]); }
    }
    const fl = [[x0, rise(u0) + 0.08, width(u0) * 0.75], [x1, rise(u1) + 0.08, width(u1) * 0.75], [x1, rise(u1) + 0.08, -width(u1) * 0.75], [x0, rise(u0) + 0.08, -width(u0) * 0.75]];
    const ids = fl.map((p) => m.v(p, [0, 1, 0], [0, 0], mul(hull, 0.7)));
    m.t(ids[0], ids[1], ids[2]); m.t(ids[0], ids[2], ids[3]);
  }
  const man = person({ coat: ['#7b2f25', '#3f4f3a', '#2e3d55'][Math.floor(rnd() * 3)], hat: '#2a2420' });
  m.add(man, [1.6, 0, 0, 0, 1.6, 0, 0, 0, 1.6], [-2.4, 0.15, 0]);
  box(m, { c: [-1.6, 2.2, 0.5], s: [0.08, 5.2, 0.08], col: srgb('#a08458'), rotZ: 0.4 });
  if (rnd() < 0.6) for (let i = 0; i < 2; i++) frustum(m, { r0: 0.3, r1: 0.3, y0: 0.15, y1: 0.95, x: 0.4 + i * 0.75, z: 0, col: srgb('#7b5a3a'), sides: 7 });
  else box(m, { c: [0.6, 0.55, 0], s: [1.6, 0.8, 0.9], col: srgb('#c9b48a') });
  return m;
}

export function sheep(seed) {
  const rnd = mulberry(seed);
  const m = new Bucket();
  const wool = mul(srgb('#e8e2d2'), 0.92 + rnd() * 0.08), dark = srgb('#2e2a26');
  blob(m, { c: [0, 0.78, 0], s: [0.62, 0.36, 0.34], col: wool, detail: 1, rnd });
  const graze = rnd() < 0.5;
  blob(m, { c: graze ? [0.7, 0.45, 0] : [0.72, 0.95, 0], s: [0.2, 0.15, 0.13], col: dark, detail: 0 });
  for (const [x, z] of [[0.38, 0.17], [0.38, -0.17], [-0.38, 0.17], [-0.38, -0.17]]) box(m, { c: [x, 0.25, z], s: [0.09, 0.5, 0.09], col: dark });
  return m;
}

export function dog() {
  const m = new Bucket();
  const c = srgb('#3a2c22');
  blob(m, { c: [0, 0.5, 0], s: [0.4, 0.16, 0.14], col: c, detail: 1 });
  blob(m, { c: [0.45, 0.68, 0], s: [0.16, 0.12, 0.11], col: c });
  for (const [x, z] of [[0.28, 0.09], [0.28, -0.09], [-0.28, 0.09], [-0.28, -0.09]]) box(m, { c: [x, 0.2, z], s: [0.07, 0.42, 0.07], col: c });
  box(m, { c: [-0.48, 0.62, 0], s: [0.3, 0.05, 0.05], col: c, rotZ: 0.6 });
  return m;
}

export function shepherd() {
  const m = person({ coat: '#5a4a32', legs: '#3d3328', hat: '#3a2f22' });
  box(m, { c: [0.32, 1.0, 0.3], s: [0.05, 2.0, 0.05], col: srgb('#8a6a40') });
  box(m, { c: [0.25, 2.0, 0.3], s: [0.2, 0.05, 0.05], col: srgb('#8a6a40') });
  frustum(m, { r0: 0.34, r1: 0.25, y0: 0.4, y1: 1.45, col: srgb('#6b5a3c'), cap: false });
  return m;
}

export function swan() {
  const m = new Bucket();
  const w = srgb('#f4f2ec');
  blob(m, { c: [0, 0.25, 0], s: [0.55, 0.22, 0.28], col: w, detail: 1 });
  box(m, { c: [0.45, 0.6, 0], s: [0.09, 0.6, 0.09], col: w, rotZ: -0.25 });
  blob(m, { c: [0.55, 0.92, 0], s: [0.11, 0.08, 0.07], col: w });
  box(m, { c: [0.68, 0.9, 0], s: [0.14, 0.05, 0.05], col: srgb('#d9732a') });
  return m;
}

// Birds: a body mesh plus two wing meshes on hinge nodes. Wings span along ±Z.
export function birdParts(kind) {
  const col = { crow: '#22201e', dove: '#e9e7e2', pigeon: '#8b8f96', gull: '#f2f1ee' }[kind];
  const wingCol = kind === 'gull' ? '#b7bcc2' : kind === 'pigeon' ? '#767b83' : col;
  const body = new Bucket();
  blob(body, { c: [0, 0, 0], s: [0.24, 0.08, 0.08], col: srgb(col), detail: 0 });
  blob(body, { c: [0.2, 0.04, 0], s: [0.07, 0.06, 0.06], col: srgb(col) });
  const wing = (side) => {
    const m = new Bucket();
    const c = srgb(wingCol);
    const pts = [[0.1, 0, 0], [-0.12, 0, 0], [-0.08, 0, side * 0.42], [0.06, 0, side * 0.36]];
    for (const ny of [1, -1]) {
      const ids = pts.map((p) => m.v(p, [0, ny, 0], [0, 0], c));
      if ((ny > 0) === (side > 0)) { m.t(ids[0], ids[1], ids[2]); m.t(ids[0], ids[2], ids[3]); }
      else { m.t(ids[0], ids[2], ids[1]); m.t(ids[0], ids[3], ids[2]); }
    }
    return m;
  };
  return { body, left: wing(1), right: wing(-1) };
}

export function crossBearer() {
  const m = person({ coat: '#efe9dc', robe: true, hat: null });
  box(m, { c: [0.35, 1.6, 0], s: [0.06, 3.2, 0.06], col: srgb('#b8913a') });
  box(m, { c: [0.35, 2.9, 0], s: [0.06, 0.06, 0.8], col: srgb('#b8913a') });
  return m;
}

export function bannerBearer(clothHex) {
  const m = person({ coat: '#3a3f55', hat: '#222' });
  box(m, { c: [0.3, 1.7, 0], s: [0.05, 3.4, 0.05], col: srgb('#6b4a2a') });
  box(m, { c: [0.3, 2.6, 0], s: [0.04, 1.3, 0.85], col: srgb(clothHex) });
  return m;
}

// Canopy (Baldachin) carried by four men with a priest underneath.
export function canopy() {
  const m = new Bucket();
  const carrier = person({ coat: '#2f2f3a', hat: '#1f1f1f' });
  const priest = person({ coat: '#c9a646', robe: true, hat: null });
  for (const [x, z] of [[0.9, 0.7], [0.9, -0.7], [-0.9, 0.7], [-0.9, -0.7]]) {
    m.add(carrier, undefined, [x, 0, z * 1.15]);
    box(m, { c: [x + 0.15, 1.6, z], s: [0.05, 3.0, 0.05], col: srgb('#c4a24a') });
  }
  m.add(priest, undefined, [0, 0, 0]);
  box(m, { c: [0.15, 3.1, 0], s: [2.1, 0.12, 1.6], col: srgb('#8e1b22') });
  box(m, { c: [0.15, 2.95, 0], s: [2.15, 0.2, 1.65], col: srgb('#c9a646') });
  return m;
}

// ---- tracks ----

const yawQ = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

// Path following. `pts` are 3D points [X, Y, Z]. `laps` passes over D seconds starting at `phase` (0..1).
// Closed paths wrap seamlessly; open paths shrink the mover to nothing at both ends so the jump is hidden.
export function follow(pts, { laps = 1, phase = 0, closed = true, bank = 0 }) {
  const path = closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]));
  const L = cum[cum.length - 1];
  const at = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const a = path[i - 1], b = path[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const heading = (s) => {
    const e = Math.min(4, L / 50);
    const p = at(closed ? (s - e + L) % L : Math.max(0, s - e)), q = at(closed ? (s + e) % L : Math.min(L, s + e));
    return Math.atan2(-(q[2] - p[2]), q[0] - p[0]);
  };
  const lapT = D / laps;
  const times = new Set([0, D]);
  for (let k = 0; k < laps; k++) for (const c of cum) {
    const t = ((c / L - phase + 1) % 1) * lapT + k * lapT;
    if (t >= 0 && t <= D) times.add(t);
  }
  if (!closed) for (let k = 0; k <= laps; k++) {
    const tw = ((1 - phase) % 1) * lapT + k * lapT;
    for (const t of [tw - 0.01, tw, lapT * 0.04 + tw, tw - lapT * 0.04]) if (t >= 0 && t <= D) times.add(t);
  }
  const t = [...times].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-4);
  const T = [], R = [], S = [];
  let prevYaw = null;
  for (const time of t) {
    const f = (time / lapT + phase) % 1;
    const s = f * L;
    T.push(at(s));
    let yaw = heading(s);
    if (prevYaw != null) while (yaw - prevYaw > Math.PI) yaw -= 2 * Math.PI;
    if (prevYaw != null) while (yaw - prevYaw < -Math.PI) yaw += 2 * Math.PI;
    prevYaw = yaw;
    const q = bank ? qmul(yawQ(yaw), [Math.sin(bank / 2), 0, 0, Math.cos(bank / 2)]) : yawQ(yaw);
    R.push(q);
    if (!closed) {
      const edge = Math.min(f, 1 - f) / 0.04;
      const sc = Math.max(0, Math.min(1, edge));
      S.push([sc, sc, sc]);
    }
  }
  if (!closed) {
    // the two keys straddling the wrap must both be hidden
    for (let i = 0; i < t.length; i++) {
      const f = (t[i] / lapT + phase) % 1;
      if (f < 1e-3 || f > 1 - 1e-3) S[i] = [0, 0, 0];
    }
  }
  return { t, T, R, S: closed ? null : S };
}

// Periodic keys for one channel; `fn(u)` gives the value at phase u in [0, 1).
export function periodic(period, steps, fn) {
  const t = [], v = [];
  const n = Math.round(D / period);
  for (let k = 0; k < n; k++) for (let s = 0; s < steps; s++) { t.push(k * period + (s / steps) * period); v.push(fn(s / steps)); }
  t.push(D); v.push(fn(0));
  return { t, v };
}

export const quatX = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
