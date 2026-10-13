import assert from 'node:assert/strict';
import { poseFromQuad } from '../site/pose.js';

const f = 360, cx = 135, cy = 240;
const W = 0.0305, H = 0.0225;
const corners = [[-W, H], [W, H], [W, -H], [-W, -H]];

function rotation(yaw, pitch, roll) {
  const [cy_, sy] = [Math.cos(yaw), Math.sin(yaw)];
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)];
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)];
  const Ry = [[cy_, 0, sy], [0, 1, 0], [-sy, 0, cy_]];
  const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  return mul(mul(Rz, Rx), Ry);
}

// Truth in three.js camera space: y up, camera looks down -z.
const cases = [
  { R: rotation(0, 0, 0), t: [0, 0, -0.5] },
  { R: rotation(0.4, -0.2, 0.1), t: [0.03, -0.02, -0.45] },
  { R: rotation(-0.6, 0.3, -0.5), t: [-0.05, 0.04, -0.7] },
];

for (const { R, t } of cases) {
  const quad = corners.map(([x, y]) => {
    const p = [0, 1, 2].map((i) => R[i][0] * x + R[i][1] * y + t[i]);
    return [cx + (f * p[0]) / -p[2], cy - (f * p[1]) / -p[2]];
  });
  const m = poseFromQuad(quad, f, cx, cy);
  const expected = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, ...t, 1];
  m.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6, `element ${i}: ${v} vs ${expected[i]}`));
}

assert.equal(poseFromQuad([[0, 0], [10, 0], [10, 0], [0, 0]], f, cx, cy), null);
console.log(`pose: ${cases.length} synthetic poses recovered within 1e-6, degenerate quad rejected`);
