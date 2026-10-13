// Pose of the LCD plane from its 4 image corners, assuming a guessed pinhole camera.
// The result is a three.js camera-space matrix (y up, camera looks down -z).

const W = 0.0305, H = 0.0225;
const MODEL = [[-W, H], [W, H], [W, -H], [-W, -H]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function solve8(m) {
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j < 9; j++) m[r][j] -= k * m[c][j];
    }
  }
  return m.map((row, i) => row[8] / row[i]);
}

// Maps LCD model coordinates (meters, y up) to image pixels.
export function homography(quad) {
  const rows = [];
  MODEL.forEach(([X, Y], i) => {
    const [u, v] = quad[i];
    rows.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y, u]);
    rows.push([0, 0, 0, X, Y, 1, -v * X, -v * Y, v]);
  });
  const h = solve8(rows);
  return h && [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

export function poseFromQuad(quad, f, cx, cy) {
  const Hm = homography(quad);
  if (!Hm) return null;

  const col = (j) => [(Hm[0][j] - cx * Hm[2][j]) / f, (Hm[1][j] - cy * Hm[2][j]) / f, Hm[2][j]];
  const a1 = col(0), a2 = col(1), a3 = col(2);
  const n1 = len(a1), n2 = len(a2);
  if (!(n1 > 1e-9 && n2 > 1e-9)) return null;

  // The two column norms differ when f is wrong; their mean is the best single scale.
  const lambda = 2 / (n1 + n2);
  let t = scale(a3, lambda);
  const flip = t[2] < 0 ? -1 : 1;
  t = scale(t, flip);

  // Closest rotation to the (unit) r1, r2 pair: rotate their sum and difference axes onto a perpendicular pair.
  const u1 = scale(a1, flip / n1), u2 = scale(a2, flip / n2);
  const s = add(u1, u2), d = sub(u1, u2);
  if (len(s) < 1e-9 || len(d) < 1e-9) return null;
  const c = unit(s), e = unit(d);
  const r1 = scale(add(c, e), Math.SQRT1_2);
  const r2 = scale(sub(c, e), Math.SQRT1_2);
  const r3 = cross(r1, r2);

  // OpenCV camera space has y down and z forward, so flip y and z for three.js.
  const fl = (v) => [v[0], -v[1], -v[2]];
  const [R1, R2, R3, T] = [r1, r2, r3, t].map(fl);
  return [...R1, 0, ...R2, 0, ...R3, 0, ...T, 1];
}
