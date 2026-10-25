// Finds the thermostat's LCD: a dark, roughly 4:3 landscape quad inside a bright bezel.
// Input is a grayscale frame; output is null or { quad: [TL, TR, BR, BL] in pixels, threshold, score }.
import { homography } from './pose.js';
import { TEMPLATE } from './template.js';

const MIN_PIXELS = 120;
const ASPECT = [0.5, 3];
const MIN_FILL = 0.8;
const MIN_BEZEL_CONTRAST = 1.3;
// Normalized cross-correlation with the reference thermostat. In a 40 s walk-around video the neighbouring card reader
// and a green door score up to 0.69, so a new track needs ACQUIRE; a blurred or oblique thermostat can dip to 0.6,
// so an existing track continues at KEEP within NEAR LCD widths of the previous hit and at most RESIZE times its size.
const ACQUIRE = 0.75;
const KEEP = 0.6;
const NEAR = 1.5;
const RESIZE = 1.5;

export function toGray(rgba, n) {
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return gray;
}

function otsu(gray) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 100;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1];
  return Math.abs(s) / 2;
}

function meanAlongQuad(gray, w, h, q, scale) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  let sum = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    for (let t = 0; t < 1; t += 0.05) {
      const x = Math.round(cx + (a[0] + (b[0] - a[0]) * t - cx) * scale);
      const y = Math.round(cy + (a[1] + (b[1] - a[1]) * t - cy) * scale);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      sum += gray[y * w + x];
      n++;
    }
  }
  return n ? sum / n : 0;
}

function sample(gray, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return NaN;
  const fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
}

// Extreme-pixel corners are whole pixels, which makes the pose wobble by several degrees.
// Locate each side's dark-to-bright edge to sub-pixel precision and intersect the fitted lines instead.
const EDGE_SAMPLES = 16;
const EDGE_REACH = 4;

function fitEdge(gray, w, h, a, b, center) {
  const len = dist(a, b);
  const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
  let nx = -dy, ny = dx;
  if (nx * (a[0] - center[0]) + ny * (a[1] - center[1]) < 0) { nx = -nx; ny = -ny; }
  const points = [];
  for (let k = 0; k < EDGE_SAMPLES; k++) {
    const t = 0.15 + (0.7 * k) / (EDGE_SAMPLES - 1);
    const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
    const g = [];
    for (let s = -EDGE_REACH - 1; s <= EDGE_REACH + 1; s++) g.push(sample(gray, w, h, px + nx * s, py + ny * s));
    let bestS = 0, bestD = 0;
    for (let i = 1; i < g.length - 1; i++) {
      const d = g[i + 1] - g[i - 1];
      if (d > bestD) { bestD = d; bestS = i; }
    }
    if (!bestS || bestS === g.length - 2) continue;
    const dl = g[bestS] - g[bestS - 2], dr = g[bestS + 2] - g[bestS];
    const denom = dl - 2 * bestD + dr;
    const offset = denom < 0 ? (0.5 * (dl - dr)) / denom : 0;
    const s = bestS - EDGE_REACH - 1 + Math.max(-0.5, Math.min(0.5, offset));
    points.push([px + nx * s, py + ny * s]);
  }
  if (points.length < EDGE_SAMPLES / 2) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const my = points.reduce((s, p) => s + p[1], 0) / points.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: mx, y: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(l1, l2) {
  const det = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / det;
  return [l1.x + l1.dx * t, l1.y + l1.dy * t];
}

function refineQuad(gray, w, h, quad) {
  const center = [0, 1].map((k) => quad.reduce((s, p) => s + p[k], 0) / 4);
  const edges = quad.map((a, i) => fitEdge(gray, w, h, a, quad[(i + 1) % 4], center));
  if (edges.some((e) => !e)) return quad;
  const refined = quad.map((_, i) => intersect(edges[(i + 3) % 4], edges[i]));
  const ok = refined.every((p, i) => p && dist(p, quad[i]) < EDGE_REACH * 1.5);
  return ok ? refined : quad;
}

// The template covers the whole thermostat body plus a rim of wall, in LCD model meters.
const GRID = 20, SUB = 3;
const REGION = { x0: -0.05, x1: 0.05, y0: 0.041, y1: -0.059 };
const reference = Uint8Array.from(atob(TEMPLATE), (c) => c.charCodeAt(0));

export function templateSamples(gray, w, h, quad) {
  const m = homography(quad);
  if (!m) return null;
  const out = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    let sum = 0;
    for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) {
      const X = REGION.x0 + ((gx + (sx + 0.5) / SUB) / GRID) * (REGION.x1 - REGION.x0);
      const Y = REGION.y0 + ((gy + (sy + 0.5) / SUB) / GRID) * (REGION.y1 - REGION.y0);
      const d = m[2][0] * X + m[2][1] * Y + m[2][2];
      const v = sample(gray, w, h, (m[0][0] * X + m[0][1] * Y + m[0][2]) / d, (m[1][0] * X + m[1][1] * Y + m[1][2]) / d);
      if (Number.isNaN(v)) return null;
      sum += v;
    }
    out[gy * GRID + gx] = sum / (SUB * SUB);
  }
  return out;
}

function ncc(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; ab += da * db; aa += da * da; bb += db * db; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

const THRESHOLDS = [60, 80, 100, 120, 140, 160, 180];

// Candidate LCD quads, refined to sub-pixel edges and largest first, before template verification.
export function findCandidates(gray, w, h, thresholds = [otsu(gray), ...THRESHOLDS]) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];
  for (const threshold of thresholds) {
    label.fill(0);
    for (const c of components(gray, w, h, threshold, label, stack)) found.push({ ...c, quad: refineQuad(gray, w, h, c.quad) });
  }
  return found.sort((a, b) => b.area - a.area);
}

const center = (q) => [0, 1].map((k) => (q[0][k] + q[1][k] + q[2][k] + q[3][k]) / 4);

function verified(gray, w, h, candidates, prior) {
  const width = prior && dist(prior.quad[0], prior.quad[1]);
  const near = prior && ((q) => {
    const ratio = dist(q[0], q[1]) / width;
    return dist(center(q), center(prior.quad)) < NEAR * width && ratio < RESIZE && ratio > 1 / RESIZE;
  });
  let best = null;
  for (const c of candidates) {
    const samples = templateSamples(gray, w, h, c.quad);
    const score = samples ? ncc(samples, reference) : 0;
    const ok = score >= ACQUIRE || (score >= KEEP && near?.(c.quad));
    if (ok && (!best || score > best.score)) best = { ...c, score };
  }
  return best;
}

// prior is the previous frame's result, or null when nothing is being tracked.
export function detectScreen(gray, w, h, prior) {
  return (prior && verified(gray, w, h, findCandidates(gray, w, h, [prior.threshold]), prior))
    ?? verified(gray, w, h, findCandidates(gray, w, h), prior);
}

function components(gray, w, h, threshold, label, stack) {
  const found = [];
  for (let start = 0, id = 1; start < w * h; start++) {
    if (label[start] || gray[start] >= threshold) continue;
    let top = 0, count = 0, sumGray = 0;
    let tl = start, tr = start, br = start, bl = start;
    let tlS = Infinity, brS = -Infinity, trD = -Infinity, blD = Infinity;
    stack[top++] = start;
    label[start] = id;
    while (top) {
      const p = stack[--top];
      const x = p % w, y = (p / w) | 0;
      count++;
      sumGray += gray[p];
      if (x + y < tlS) { tlS = x + y; tl = p; }
      if (x + y > brS) { brS = x + y; br = p; }
      if (x - y > trD) { trD = x - y; tr = p; }
      if (x - y < blD) { blD = x - y; bl = p; }
      if (x > 0 && !label[p - 1] && gray[p - 1] < threshold) { label[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && !label[p + 1] && gray[p + 1] < threshold) { label[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && !label[p - w] && gray[p - w] < threshold) { label[p - w] = id; stack[top++] = p - w; }
      if (y < h - 1 && !label[p + w] && gray[p + w] < threshold) { label[p + w] = id; stack[top++] = p + w; }
    }
    id++;

    if (count < MIN_PIXELS) continue;
    const quad = [tl, tr, br, bl].map((p) => [p % w, (p / w) | 0]);
    const area = quadArea(quad);
    const aspect = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / (dist(quad[0], quad[3]) + dist(quad[1], quad[2]));
    const fill = count / area;
    if (aspect < ASPECT[0] || aspect > ASPECT[1] || fill < MIN_FILL || fill > 1.15) continue;
    if (quad.some(([x, y]) => x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2)) continue;
    const bezel = meanAlongQuad(gray, w, h, quad, 1.12);
    const inside = sumGray / count;
    if (bezel < inside * MIN_BEZEL_CONTRAST) continue;
    found.push({ quad, area, aspect, fill, bezel, inside, threshold });
  }
  return found;
}
