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

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// At 1 to 3 m the LCD is 15 to 30 px wide. Its perspective, the only cue for which way it tilts, is then about 1 %
// of its size and drowns in corner noise, so poseFromQuad swings the wall by a median 16° per frame. This fits an
// affine map in a virtual camera turned to look straight at the LCD center, where it is exact to about 1 % at any
// distance. That gives the distance, the roll and how far the LCD tilts away from the line of sight, but leaves
// the tilt's sign open: the two returned rotations mirror each other about the line of sight. cue runs from 1 when
// poseFromQuad's perspective tilts the same way as the first rotation to -1 when it matches the second, and is near
// 0 when the perspective sees the LCD face on. It is right more often than not and only worth anything summed over
// many frames.
// Everything is in three.js axes (y up, -z forward). ray points at the LCD center from the camera. frame is the
// basis of the virtual camera, rolled so that the LCD's x axis projects onto its x axis; the rotations are in it,
// which makes their tilt independent of how the phone turns. roll is that turn of the frame about the ray, in radians.
export function wallPose(quad, f, cx, cy) {
  const [a, b, c, d] = quad;
  const d1 = [c[0] - a[0], c[1] - a[1]], d2 = [d[0] - b[0], d[1] - b[1]];
  const det = d2[0] * d1[1] - d1[0] * d2[1];
  if (Math.abs(det) < 1e-9) return null;
  const s0 = (d2[0] * (b[1] - a[1]) - d2[1] * (b[0] - a[0])) / det;
  const center = [a[0] + d1[0] * s0, a[1] + d1[1] * s0];

  // OpenCV axes until the end: x right, y down, z forward.
  const v = unit([(center[0] - cx) / f, (center[1] - cy) / f, 1]);
  let xv = unit(cross([0, 1, 0], v)), yv = cross(v, xv);
  const local = (p) => {
    const r = [(p[0] - cx) / f, (p[1] - cy) / f, 1], z = dot(r, v);
    return [dot(r, xv) / z, dot(r, yv) / z];
  };
  const pts = quad.map(local);
  if (pts.some((p) => !Number.isFinite(p[0]))) return null;
  // Least squares for p = A [X, Y]: the model is symmetric about its center, so the normal equations are diagonal.
  let a11 = 0, a12 = 0, a21 = 0, a22 = 0;
  pts.forEach(([x, y], i) => {
    const [X, Y] = MODEL[i];
    a11 += x * X; a21 += y * X; a12 += x * Y; a22 += y * Y;
  });
  a11 /= 4 * W * W; a21 /= 4 * W * W; a12 /= 4 * H * H; a22 /= 4 * H * H;

  const roll = Math.atan2(a21, a11), cr = Math.cos(roll), sr = Math.sin(roll);
  [xv, yv] = [add(scale(xv, cr), scale(yv, sr)), sub(scale(yv, cr), scale(xv, sr))];
  [a11, a21] = [cr * a11 + sr * a21, cr * a21 - sr * a11];
  [a12, a22] = [cr * a12 + sr * a22, cr * a22 - sr * a12];

  // A is k times the top two rows of the rotation's first two columns, with k = 1 / distance. Unit, orthogonal
  // columns fix k and the third row up to one sign.
  const p = a11 * a11 + a21 * a21, q = a12 * a12 + a22 * a22, s = a11 * a12 + a21 * a22;
  const k2 = (p + q + Math.sqrt((p - q) ** 2 + 4 * s * s)) / 2;
  if (!(k2 > 0)) return null;
  const k = Math.sqrt(k2);
  const z1 = Math.sqrt(Math.max(0, k2 - p));
  const z2 = z1 > 1e-6 * k ? -s / z1 : Math.sqrt(Math.max(0, k2 - q));
  const rotation = (sign) => {
    const r1 = [a11 / k, a21 / k, (sign * z1) / k], r2 = unit([a12 / k, a22 / k, (sign * z2) / k]);
    const r3 = unit(cross(r1, r2));
    return [r1, cross(r3, r1), r3];
  };
  const rotations = [rotation(1), rotation(-1)];

  // The perspective pose's normal, in the same virtual camera.
  const m = poseFromQuad(quad, f, cx, cy);
  let cue = 0;
  const r3 = rotations[0][2], tilt2 = r3[0] * r3[0] + r3[1] * r3[1];
  if (m && tilt2 > 1e-9) {
    const n = [m[8], -m[9], -m[10]];
    cue = Math.max(-1, Math.min(1, (dot(n, xv) * r3[0] + dot(n, yv) * r3[1]) / tilt2));
  }

  const fl = (u) => [u[0], -u[1], -u[2]];
  return {
    ray: fl(v),
    distance: 1 / k,
    roll,
    frame: [fl(xv), scale(fl(yv), -1), scale(fl(v), -1)],
    rotations: rotations.map((r) => r.map(fl)),
    cue,
  };
}
