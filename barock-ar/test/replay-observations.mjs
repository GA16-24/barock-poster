import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { A1, analyze, pose, stats } from './steady.mjs';

const input = process.argv[2] ?? new URL('./out/observations-no-gyro-raw.json', import.meta.url).pathname;
const output = process.argv[3] ?? new URL('./out/observations-no-gyro-visual-odometry.json', import.meta.url).pathname;
const HOLD_MS = 100;
const INITIALIZATION_MS = 1000;
const MIN_POINTS = 8;
const MIN_INLIERS = 6;
const RANSAC_THRESHOLD = 2.5;
const RANSAC_ITERATIONS = 32;
const RAD = 180 / Math.PI;
const ONE = new THREE.Vector3(1, 1, 1);

const identity3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const transpose3 = (a) => a[0].map((_, j) => a.map((row) => row[j]));
const multiply3 = (a, b) => a.map((row, i) => row.map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
const inverse3 = (a) => {
  const [r0, r1, r2] = a;
  const c00 = r1[1] * r2[2] - r1[2] * r2[1], c01 = r0[2] * r2[1] - r0[1] * r2[2], c02 = r0[1] * r1[2] - r0[2] * r1[1];
  const c10 = r1[2] * r2[0] - r1[0] * r2[2], c11 = r0[0] * r2[2] - r0[2] * r2[0], c12 = r0[2] * r1[0] - r0[0] * r1[2];
  const c20 = r1[0] * r2[1] - r1[1] * r2[0], c21 = r0[1] * r2[0] - r0[0] * r2[1], c22 = r0[0] * r1[1] - r0[1] * r1[0];
  const determinant = r0[0] * c00 + r0[1] * c10 + r0[2] * c20;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) return null;
  return [[c00, c01, c02], [c10, c11, c12], [c20, c21, c22]].map((row) => row.map((x) => x / determinant));
};

function symmetricEigen(matrix) {
  const n = matrix.length, a = matrix.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j)));
  for (let sweep = 0; sweep < 80; sweep++) {
    let p = 0, q = 1, largest = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    }
    if (largest < 1e-12) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle), app = a[p][p], aqq = a[q][q], apq = a[p][q];
    for (let k = 0; k < n; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < n; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i][i] - a[j][j]);
  return order.map((j) => v.map((row) => row[j]));
}

function normalizer(points) {
  const center = points.reduce((s, p) => [s[0] + p.x, s[1] + p.y], [0, 0]).map((x) => x / points.length);
  const mean = points.reduce((s, p) => s + Math.hypot(p.x - center[0], p.y - center[1]), 0) / points.length;
  if (!(mean > 1e-9)) return null;
  const scale = Math.SQRT2 / mean;
  return {
    matrix: [[scale, 0, -scale * center[0]], [0, scale, -scale * center[1]], [0, 0, 1]],
    points: points.map((p) => ({ x: scale * (p.x - center[0]), y: scale * (p.y - center[1]) })),
  };
}

function dlt(worldCoords, screenCoords) {
  if (worldCoords.length < 4) return null;
  const world = normalizer(worldCoords), screen = normalizer(screenCoords);
  if (!world || !screen) return null;
  const ata = Array.from({ length: 9 }, () => Array(9).fill(0));
  for (let i = 0; i < world.points.length; i++) {
    const { x, y } = world.points[i], { x: u, y: v } = screen.points[i];
    const rows = [[-x, -y, -1, 0, 0, 0, u * x, u * y, u], [0, 0, 0, -x, -y, -1, v * x, v * y, v]];
    for (const row of rows) for (let j = 0; j < 9; j++) for (let k = 0; k < 9; k++) ata[j][k] += row[j] * row[k];
  }
  const h = symmetricEigen(ata)[0];
  const normalized = [h.slice(0, 3), h.slice(3, 6), h.slice(6, 9)];
  const denormalized = multiply3(multiply3(inverse3(screen.matrix), normalized), world.matrix);
  if (!denormalized.flat().every(Number.isFinite) || Math.abs(denormalized[2][2]) < 1e-14) return null;
  return denormalized.map((row) => row.map((x) => x / denormalized[2][2]));
}

function reprojectionError(h, world, screen) {
  const w = h[2][0] * world.x + h[2][1] * world.y + h[2][2];
  if (Math.abs(w) < 1e-12) return Infinity;
  const x = (h[0][0] * world.x + h[0][1] * world.y + h[0][2]) / w;
  const y = (h[1][0] * world.x + h[1][1] * world.y + h[1][2]) / w;
  return Math.hypot(x - screen.x, y - screen.y);
}

function random(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function estimateHomography(tracking, frameIndex) {
  const world = tracking?.worldCoords, screen = tracking?.screenCoords;
  if (!Array.isArray(world) || !Array.isArray(screen) || world.length !== screen.length || world.length < MIN_POINTS) return null;
  const next = random(frameIndex * 2654435761 + 97);
  let best = null;
  for (let iteration = 0; iteration < RANSAC_ITERATIONS; iteration++) {
    const indices = new Set();
    while (indices.size < 4) indices.add(Math.floor(next() * world.length));
    const sample = [...indices];
    const h = dlt(sample.map((i) => world[i]), sample.map((i) => screen[i]));
    if (!h) continue;
    const inliers = world.map((_, i) => i).filter((i) => reprojectionError(h, world[i], screen[i]) <= RANSAC_THRESHOLD);
    if (!best || inliers.length > best.length) best = inliers;
  }
  const required = Math.max(MIN_INLIERS, Math.ceil(world.length / 2));
  if (!best || best.length < required) return null;
  const h = dlt(best.map((i) => world[i]), best.map((i) => screen[i]));
  if (!h) return null;
  const inliers = world.map((_, i) => i).filter((i) => reprojectionError(h, world[i], screen[i]) <= RANSAC_THRESHOLD);
  if (inliers.length < required) return null;
  const errors = inliers.map((i) => reprojectionError(h, world[i], screen[i]));
  return { h, inliers: inliers.length, correspondences: world.length, reprojection: stats(errors) };
}

function acquisitionHomography(mv, K) {
  if (!Array.isArray(mv) || mv.length !== 3 || mv.some((row) => !Array.isArray(row) || row.length !== 4)) return null;
  const h = multiply3(K, mv.map((row) => [row[0], row[1], row[3]]));
  if (!h.flat().every(Number.isFinite) || Math.abs(h[2][2]) < 1e-14) return null;
  return h.map((row) => row.map((x) => x / h[2][2]));
}

function polarSO3(g) {
  let r = g;
  for (let i = 0; i < 20; i++) {
    const inverse = inverse3(r);
    if (!inverse) return null;
    const next = r.map((row, j) => row.map((x, k) => 0.5 * (x + transpose3(inverse)[j][k])));
    const delta = Math.max(...r.flat().map((x, j) => Math.abs(x - next.flat()[j])));
    r = next;
    if (delta < 1e-12) break;
  }
  const determinant = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1])
    - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  if (determinant < 0) for (const row of r) row[2] *= -1;
  if (!r.flat().every(Number.isFinite)) return null;
  const matrix = new THREE.Matrix4().set(...r[0], 0, ...r[1], 0, ...r[2], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
}

function relativeRotation(hcur, hlast, K) {
  const unit = (h) => {
    const d = h[0][0] * (h[1][1] * h[2][2] - h[1][2] * h[2][1])
      - h[0][1] * (h[1][0] * h[2][2] - h[1][2] * h[2][0]) + h[0][2] * (h[1][0] * h[2][1] - h[1][1] * h[2][0]);
    const scale = Math.cbrt(Math.abs(d));
    return scale > 1e-14 ? h.map((row) => row.map((x) => x / scale)) : null;
  };
  const current = unit(hcur), previous = unit(hlast);
  const kinv = inverse3(K), hlastinv = previous && inverse3(previous);
  if (!current || !kinv || !hlastinv) return null;
  const g = multiply3(multiply3(multiply3(kinv, current), hlastinv), K);
  const dcv = polarSO3(g);
  if (!dcv) return null;
  const cvToThree = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeRotationX(Math.PI));
  return cvToThree.clone().multiply(dcv).multiply(cvToThree.clone().invert()).normalize();
}

function rawPose(matrix) {
  const m = new THREE.Matrix4().fromArray(matrix);
  return {
    position: new THREE.Vector3().setFromMatrixPosition(m),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(m).normalize(),
  };
}

function trueRotation(frameIndex) {
  const [yaw, pitch] = pose(frameIndex / A1.FPS);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}

function freshState() {
  return {
    active: false, initialized: false, visualEpoch: 0,
    worldPosition: null, worldQuaternion: null, cameraQuaternion: null,
    hlast: null, lastHomographyFrame: null, lastHitNow: -Infinity, anchor: null,
  };
}

function referenceFor(observations, startIndex) {
  const first = observations[startIndex], epoch = first.epoch, start = first.timestamp ?? first.render.now;
  const candidates = [];
  let lastHit = first.render.now;
  for (let i = startIndex; i < observations.length; i++) {
    const o = observations[i];
    if (o.epoch !== epoch || o.render.now - lastHit >= HOLD_MS || (o.timestamp ?? o.render.now) - start > INITIALIZATION_MS) break;
    if (o.hit) {
      if (o.metricMatrix && (o.rawAcquisitionModelViewTransform || o.tracking?.worldCoords?.length >= MIN_POINTS)) candidates.push(o);
      lastHit = o.render.now;
    }
  }
  if (!candidates.length) return null;
  const reference = candidates.reduce((best, o) => o.metricMatrix[10] > best.metricMatrix[10] ? o : best);
  return { frameIndex: reference.frameIndex, quaternion: rawPose(reference.metricMatrix).quaternion };
}

function replay(data) {
  const state = freshState();
  const frames = [], relativeErrors = [], positionDrift = [], rotationDrift = [], reprojection = [], references = [];
  const missReasons = {}, resetReasons = {};
  let captureEpoch = null, calibration = null, reference = null;
  let missAttempts = 0, homographiesOnMisses = 0, trackedHomographiesOnMisses = 0;
  let missesWithTracking = 0, missesWithEnoughPoints = 0;
  let acquisitionHomographies = 0, trackedHomographies = 0, homographyFailures = 0;

  for (const o of data.observations) {
    if (!o.render) continue;
    const now = o.render.now;
    const nextCalibration = JSON.stringify(o.calibration?.K);
    if (captureEpoch !== o.epoch || calibration !== nextCalibration) {
      Object.assign(state, freshState(), { visualEpoch: state.visualEpoch + 1 });
      captureEpoch = o.epoch;
      calibration = nextCalibration;
      reference = null;
      resetReasons.resize = (resetReasons.resize ?? 0) + 1;
    }
    if (state.active && now - state.lastHitNow >= HOLD_MS) {
      Object.assign(state, freshState(), { visualEpoch: state.visualEpoch + 1 });
      reference = null;
      resetReasons['loss-timeout'] = (resetReasons['loss-timeout'] ?? 0) + 1;
    }
    if (o.missReason) missReasons[o.missReason] = (missReasons[o.missReason] ?? 0) + 1;

    let estimated = null, source = null;
    if (o.trackerHadPrevious && o.tracking) {
      if (!o.hit) {
        missAttempts++;
        missesWithTracking++;
        if (o.tracking.worldCoords?.length >= MIN_POINTS) missesWithEnoughPoints++;
      }
      estimated = estimateHomography(o.tracking, o.frameIndex);
      source = 'tracked-correspondences';
      if (estimated) {
        trackedHomographies++;
        if (!o.hit) trackedHomographiesOnMisses++;
      }
    } else if (o.rawAcquisitionModelViewTransform) {
      if (!o.hit) missAttempts++;
      const h = acquisitionHomography(o.rawAcquisitionModelViewTransform, o.calibration.K);
      if (h) {
        estimated = { h, inliers: null, correspondences: null, reprojection: null };
        acquisitionHomographies++;
      }
      source = 'full-acquisition';
    }
    if (source && !estimated) homographyFailures++;
    if (estimated && !o.hit) homographiesOnMisses++;
    if (estimated?.reprojection) reprojection.push(estimated.reprojection.med);

    const absolute = o.hit === true && Array.isArray(o.metricMatrix) ? rawPose(o.metricMatrix) : null;
    if (absolute && !state.active) {
      Object.assign(state, freshState(), { active: true, visualEpoch: state.visualEpoch + 1 });
      state.anchor = o.metricMatrix;
      reference = referenceFor(data.observations, o.observationIndex);
      references.push({ visualEpoch: state.visualEpoch, frameIndex: reference?.frameIndex ?? null });
      if (reference) {
        state.worldQuaternion = reference.quaternion.clone();
        state.cameraQuaternion = state.worldQuaternion.clone().multiply(absolute.quaternion.clone().invert()).normalize();
        state.worldPosition = absolute.position.clone().applyQuaternion(state.cameraQuaternion);
        state.initialized = true;
      }
    }

    let relativeError = null, framePositionDrift = null, frameRotationDrift = null;
    if (state.active && estimated && state.hlast) {
      const dthree = relativeRotation(estimated.h, state.hlast, o.calibration.K);
      if (dthree) {
        const truth = trueRotation(o.frameIndex).invert().multiply(trueRotation(state.lastHomographyFrame));
        relativeError = dthree.angleTo(truth) * RAD;
        relativeErrors.push(relativeError);
        if (state.initialized) state.cameraQuaternion.multiply(dthree.clone().invert()).normalize();
      }
    }

    if (state.active && absolute) {
      state.lastHitNow = now;
      if (!state.initialized) state.anchor = o.metricMatrix;
      if (state.initialized) {
        const predicted = state.worldPosition.clone().applyQuaternion(state.cameraQuaternion.clone().invert());
        const viewQuaternion = state.cameraQuaternion.clone().invert().multiply(state.worldQuaternion).normalize();
        framePositionDrift = predicted.distanceTo(absolute.position);
        frameRotationDrift = viewQuaternion.angleTo(absolute.quaternion) * RAD;
        positionDrift.push(framePositionDrift);
        rotationDrift.push(frameRotationDrift);
        state.worldPosition.lerp(absolute.position.clone().applyQuaternion(state.cameraQuaternion), 0.2);
      }
    }

    if (state.active && estimated) {
      state.hlast = estimated.h;
      state.lastHomographyFrame = o.frameIndex;
    }
    let visible = false;
    if (state.active && now - state.lastHitNow < HOLD_MS) {
      if (state.initialized) {
        const position = state.worldPosition.clone().applyQuaternion(state.cameraQuaternion.clone().invert());
        const quaternion = state.cameraQuaternion.clone().invert().multiply(state.worldQuaternion).normalize();
        state.anchor = new THREE.Matrix4().compose(position, quaternion, ONE).toArray();
      }
      visible = state.anchor !== null;
    }
    const m = visible ? state.anchor : o.render.m;
    frames.push({
      observationIndex: o.observationIndex, frameIndex: o.frameIndex, visualEpoch: state.visualEpoch,
      initialized: state.initialized, homography: estimated ? {
        source, h: estimated.h, inliers: estimated.inliers,
        correspondences: estimated.correspondences, reprojection: estimated.reprojection,
      } : null, relativeRotationError: relativeError, positionDrift: framePositionDrift,
      rotationDrift: frameRotationDrift, visible, m,
    });
  }

  const renders = data.observations.filter((o) => o.render).map((o, i) => ({ ...o.render, m: frames[i].m, visible: frames[i].visible }));
  return {
    renders, frames, references,
    homography: {
      missAttempts, missesWithTracking, missesWithEnoughPoints, homographiesOnMisses, trackedHomographiesOnMisses,
      yieldOnMisses: homographiesOnMisses / Math.max(missAttempts, 1),
      yieldWithEnoughPoints: trackedHomographiesOnMisses / Math.max(missesWithEnoughPoints, 1),
      acquisitionHomographies, trackedHomographies, homographyFailures,
      minPoints: MIN_POINTS, minInliers: MIN_INLIERS, ransacIterations: RANSAC_ITERATIONS,
      reprojectionPixels: stats(reprojection),
    },
    relativeRotationErrorDegrees: stats(relativeErrors),
    driftAtAbsoluteHits: { positionMeters: stats(positionDrift), rotationDegrees: stats(rotationDrift) },
    missReasons, resetReasons,
  };
}

const data = JSON.parse(readFileSync(input, 'utf8'));
if (data.schema !== 1 || data.kind !== 'a1-no-gyro-observations' || !Array.isArray(data.observations) || !Array.isArray(data.shown)) {
  throw new Error('Expected schema 1 A1 no-gyro observations');
}
for (const key of ['W', 'H', 'F', 'FPS', 'SECONDS', 'DISTANCE', 'POSTER_WIDTH', 'POSTER_HEIGHT']) {
  if (data.spec?.[key] !== A1[key]) throw new Error(`A1 calibration changed at ${key}`);
}
const baselineRenders = data.observations.filter((o) => o.render).map((o) => o.render);
const baseline = analyze({ ...data, renders: baselineRenders });
const result = replay(data);
const visual = analyze({ ...data, renders: result.renders });
const report = {
  schema: 1, kind: 'a1-no-gyro-visual-odometry-replay', source: input, spec: data.spec,
  homography: result.homography, relativeRotationErrorDegrees: result.relativeRotationErrorDegrees,
  driftAtAbsoluteHits: result.driftAtAbsoluteHits, missReasons: result.missReasons, resetReasons: result.resetReasons,
  references: result.references, baseline, visual, frames: result.frames,
};
writeFileSync(output, JSON.stringify(report));
const fixed = (x, digits = 3) => Number.isFinite(x) ? x.toFixed(digits) : '-';
console.log(`Wrote ${output}`);
console.log(`Homographies on misses ${result.homography.homographiesOnMisses}/${result.homography.missAttempts} (${fixed(100 * result.homography.yieldOnMisses, 1)}%); enough-point yield ${fixed(100 * result.homography.yieldWithEnoughPoints, 1)}%`);
console.log(`Relative rotation error deg median/p95/max ${fixed(result.relativeRotationErrorDegrees.med)}/${fixed(result.relativeRotationErrorDegrees.p95)}/${fixed(result.relativeRotationErrorDegrees.max)}`);
console.log(`Final position px median/p95/max ${fixed(visual.position.med)}/${fixed(visual.position.p95)}/${fixed(visual.position.max)}; baseline p95 ${fixed(baseline.position.p95)}`);
console.log(`Final rotation deg median/p95/max ${fixed(visual.rotation.med)}/${fixed(visual.rotation.p95)}/${fixed(visual.rotation.max)}; baseline p95 ${fixed(baseline.rotation.p95)}`);
console.log(`Visible fraction ${fixed(100 * visual.visibleFraction, 3)}%; baseline ${fixed(100 * baseline.visibleFraction, 3)}%`);
console.log(`Reacquisition position p95 ${fixed(visual.reacquisition.position.p95)} px; rotation p95 ${fixed(visual.reacquisition.rotation.p95)} deg; count ${visual.reacquisition.count}`);
console.log(`Drift at absolute hits: position p95 ${fixed(result.driftAtAbsoluteHits.positionMeters.p95)} m; rotation p95 ${fixed(result.driftAtAbsoluteHits.rotationDegrees.p95)} deg`);
console.log(`Miss reasons ${JSON.stringify(result.missReasons)}`);
