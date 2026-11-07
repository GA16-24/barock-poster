import * as THREE from 'three';

export const POSTER_WIDTH_M = 0.841;

const positive = (...values) => values.every((v) => Number.isFinite(v) && v > 0);

export function projectionTransform(inputWidth, inputHeight, focal) {
  if (!positive(inputWidth, inputHeight, focal)) throw new TypeError('Invalid camera calibration');
  return [
    [focal, 0, inputWidth / 2],
    [0, focal, inputHeight / 2],
    [0, 0, 1],
  ];
}

export function metricPosterMatrix(worldMatrix, dimensions, physicalWidthM = POSTER_WIDTH_M) {
  if (worldMatrix?.length !== 16 || !Array.from(worldMatrix).every(Number.isFinite)
    || dimensions?.length !== 2 || !positive(...dimensions, physicalWidthM)) {
    throw new TypeError('Invalid poster pose');
  }
  const [width, height] = dimensions;
  const scale = physicalWidthM / width;
  const raw = new THREE.Matrix4().fromArray(worldMatrix);
  if (!Number.isFinite(raw.determinant()) || Math.abs(raw.determinant()) < 1e-12) throw new TypeError('Degenerate poster pose');

  // MindAR uses target pixels and a corner origin. Scale its camera translation as well as its local geometry.
  const centered = new THREE.Matrix4().makeTranslation(width / 2, height / 2, 0).scale(new THREE.Vector3(scale, scale, scale));
  raw.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale)).multiply(centered);
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), unit = new THREE.Vector3(1, 1, 1);
  raw.decompose(position, rotation, new THREE.Vector3());
  return new THREE.Matrix4().compose(position, rotation, unit);
}

function hasBroadCoverage(debugExtra, keyframes, dimensions) {
  let best = null;
  for (let i = 0; i < (debugExtra?.frames?.length ?? 0); i++) {
    const inliers = debugExtra.frames[i]?.inlierMatches2;
    if (inliers && (!best || inliers.length > best.inliers.length)) best = { inliers, keyframe: keyframes[i] };
  }
  if (!best || best.inliers.length < 12) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { keypoint } of best.inliers) {
    const x = (keypoint.x + 0.5) / best.keyframe.scale;
    const y = (keypoint.y + 0.5) / best.keyframe.scale;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return (maxX - minX) / dimensions[0] >= 0.30 || (maxY - minY) / dimensions[1] >= 0.28;
}

export async function createPosterTracker({ inputWidth, inputHeight, focal, targetUrl = './targets/poster.mind?v=5', physicalWidthM = POSTER_WIDTH_M, onError }) {
  projectionTransform(inputWidth, inputHeight, focal);
  if (!positive(physicalWidthM)) throw new TypeError('Invalid physical poster width');
  const { Controller } = await import('./vendor/mindar/mindar-image.prod.js?v=2');
  const controller = new Controller({ inputWidth, inputHeight, focal, maxTrack: 1, debugMode: true });
  try {
    controller.projectionTransform = projectionTransform(inputWidth, inputHeight, focal);
    const { dimensions, matchingDataList } = await controller.addImageTargets(new URL(targetUrl, import.meta.url).href);
    if (dimensions.length !== 1) throw new Error('The poster target must contain exactly one image');
    controller.tracker.debugMode = false;
    const targetDimensions = dimensions[0], keyframes = matchingDataList[0];
    let raw = null, disposed = false, confirmations = 0, emitted = false, misses = 0;

    return {
      async update(canvas) {
        if (disposed) return null;
        let inputT = null, acquired = false;
        try {
          if (raw === null) {
            inputT = controller.inputLoader.loadInput(canvas);
            const { featurePoints } = controller.cropDetector.detectMoving(inputT);
            inputT.dispose();
            inputT = null;
            const matched = await controller.match(featurePoints, 0);
            if (!matched.modelViewTransform || !hasBroadCoverage(matched.debugExtra, keyframes, targetDimensions)) return null;
            raw = matched.modelViewTransform;
            acquired = true;
          } else {
            const previous = raw;
            const features = await controller.track(canvas, previous, 0);
            if (features.worldCoords.length < 12) {
              misses++;
              if (misses >= 3) raw = null;
              return null;
            }
            raw = await controller.trackUpdate(previous, features);
            if (raw === null) {
              misses++;
              if (misses < 3) raw = previous;
              return null;
            }
          }
          const matrix = metricPosterMatrix(controller.getWorldMatrix(raw, 0), targetDimensions, physicalWidthM);
          const m = matrix.elements, halfW = physicalWidthM / 2, halfH = physicalWidthM * targetDimensions[1] / targetDimensions[0] / 2;
          // Partial poster views are valid, but every corner must remain in front of the camera.
          let valid = Math.abs(m[6]) <= 0.5;
          for (const [x, y] of [[-halfW, halfH], [halfW, halfH], [halfW, -halfH], [-halfW, -halfH]]) {
            const cz = m[2] * x + m[6] * y + m[14];
            if (cz >= -0.01) valid = false;
          }
          if (!valid) {
            raw = null;
            return null;
          }
          misses = 0;
          const first = !emitted;
          // Three accepted poses keep one weak match from becoming the initial world anchor.
          if (first && ++confirmations < 3) return null;
          emitted = true;
          return { matrix, acquired: acquired || (first && confirmations === 3) };
        } catch (error) {
          raw = null;
          onError?.(error);
          return null;
        } finally {
          inputT?.dispose();
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        raw = null;
        controller.dispose();
      },
    };
  } catch (error) {
    controller.dispose();
    throw error;
  }
}
