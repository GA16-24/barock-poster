import assert from 'node:assert/strict';
import * as THREE from 'three';
import { poseFromQuad, wallPose } from '../site/pose.js';

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

// wallPose at 1 to 1.5 m, off center and tilted up to 52°: one of its two rotations is the true one, and the
// perspective cue points to it, since these corners carry no noise.
const big = { f: 960, cx: 360, cy: 640 };
const wallCases = [[0, 0, 0, [0, 0, -1]], [0.5, 0.1, 0.2, [0.3, 0.2, -1.5]], [-0.7, -0.3, -0.1, [-0.4, 0.5, -1.2]], [0.2, 0.9, 0, [0, -0.6, -0.8]]];
for (const [yaw, pitch, roll, t] of wallCases) {
  const truth = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll));
  const at = new THREE.Vector3(...t);
  const quad = corners.map(([x, y]) => {
    const p = new THREE.Vector3(x, y, 0).applyQuaternion(truth).add(at);
    return [big.cx + (big.f * p.x) / -p.z, big.cy - (big.f * p.y) / -p.z];
  });
  const w = wallPose(quad, big.f, big.cx, big.cy);
  const basis = (cols) => new THREE.Matrix4().makeBasis(...cols.map((c) => new THREE.Vector3(...c)));
  const q = new THREE.Quaternion().setFromRotationMatrix(basis(w.frame).multiply(basis(w.rotations[w.cue >= 0 ? 0 : 1])));
  assert.ok(q.angleTo(truth) < 1e-3, `rotation off by ${q.angleTo(truth)} rad`);
  assert.ok(new THREE.Vector3(...w.ray).multiplyScalar(w.distance).distanceTo(at) < 1e-3, 'position off');
}
console.log(`wallPose: ${wallCases.length} synthetic poses recovered within 1 mm and 0.06°`);
