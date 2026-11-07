import assert from 'node:assert/strict';
import * as THREE from 'three';
import { POSTER_WIDTH_M, projectionTransform, metricPosterMatrix } from '../site/poster.js';

assert.equal(POSTER_WIDTH_M, 0.841);
assert.deepEqual(projectionTransform(1280, 720, 960), [
  [960, 0, 640],
  [0, 960, 360],
  [0, 0, 1],
]);
for (const args of [[0, 720, 960], [1280, -1, 960], [1280, 720, NaN], [1280, 720, Infinity]]) {
  assert.throws(() => projectionTransform(...args), TypeError);
}

const dimensions = [200, 100];
const raw = new THREE.Matrix4().compose(
  new THREE.Vector3(120, -80, 900),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.35, 0.4)),
  new THREE.Vector3(1, 1, 1),
);
const matrix = metricPosterMatrix(raw.elements, dimensions, POSTER_WIDTH_M);
const scale = POSTER_WIDTH_M / dimensions[0];
const expectedCenter = new THREE.Vector3(100, 50, 0).applyMatrix4(raw).multiplyScalar(scale);
assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(expectedCenter) < 1e-10, 'raw translation and centered origin use meters');

const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), axes = new THREE.Vector3();
matrix.decompose(position, rotation, axes);
assert.ok(axes.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-10, 'unit scale');
for (const column of [0, 1, 2]) {
  const axis = new THREE.Vector3().fromArray(matrix.elements, column * 4);
  assert.ok(Math.abs(axis.length() - 1) < 1e-10, `unit axis ${column}`);
}
assert.ok(Math.abs(new THREE.Vector3().fromArray(matrix.elements, 0).dot(new THREE.Vector3().fromArray(matrix.elements, 4))) < 1e-10, 'orthogonal axes');

for (const [local, target] of [
  [[-POSTER_WIDTH_M / 2, 0, 0], [0, 50, 0]],
  [[POSTER_WIDTH_M / 2, 0, 0], [200, 50, 0]],
  [[0, POSTER_WIDTH_M / 4, 0], [100, 100, 0]],
  [[0, -POSTER_WIDTH_M / 4, 0], [100, 0, 0]],
]) {
  const actual = new THREE.Vector3(...local).applyMatrix4(matrix);
  const expected = new THREE.Vector3(...target).applyMatrix4(raw).multiplyScalar(scale);
  assert.ok(actual.distanceTo(expected) < 1e-10, `poster corner ${local}`);
}

const override = metricPosterMatrix(raw.elements, dimensions, 0.84);
const left = new THREE.Vector3(-0.42, 0, 0).applyMatrix4(override);
const right = new THREE.Vector3(0.42, 0, 0).applyMatrix4(override);
assert.ok(Math.abs(left.distanceTo(right) - 0.84) < 1e-10, 'physical width override');
assert.ok(new THREE.Vector3().setFromMatrixPosition(override).distanceTo(expectedCenter.clone().multiplyScalar(0.84 / POSTER_WIDTH_M)) < 1e-10, 'override scales translation');

for (const [world, dims, width] of [
  [raw.elements.slice(0, 15), dimensions, POSTER_WIDTH_M],
  [raw.elements.map((v, i) => i === 12 ? NaN : v), dimensions, POSTER_WIDTH_M],
  [new THREE.Matrix4().scale(new THREE.Vector3(0, 0, 0)).elements, dimensions, POSTER_WIDTH_M],
  [raw.elements, [0, 100], POSTER_WIDTH_M],
  [raw.elements, dimensions, 0],
]) {
  assert.throws(() => metricPosterMatrix(world, dims, width), TypeError);
}

console.log('pose: projection, centered metric conversion, unit axes, width override, and degenerate inputs passed');
