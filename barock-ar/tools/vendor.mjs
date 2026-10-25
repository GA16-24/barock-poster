import { cpSync, mkdirSync } from 'node:fs';

// Copies browser libraries into site/vendor, since CDNs are often slow or blocked from Shanghai.
const root = new URL('..', import.meta.url).pathname;
const three = `${root}node_modules/three`;
const vendor = `${root}site/vendor`;
const copy = (from, to) => {
  mkdirSync(to.slice(0, to.lastIndexOf('/')), { recursive: true });
  cpSync(from, to, { recursive: true });
};

for (const f of ['three.module.js', 'three.core.js']) copy(`${three}/build/${f}`, `${vendor}/${f}`);
for (const f of [
  'loaders/GLTFLoader.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
  'libs/meshopt_decoder.module.js',
  'environments/RoomEnvironment.js',
]) copy(`${three}/examples/jsm/${f}`, `${vendor}/jsm/${f}`);
copy(`${root}node_modules/@mediapipe/tasks-vision/vision_bundle.mjs`, `${vendor}/mediapipe/vision_bundle.mjs`);
copy(`${root}node_modules/@mediapipe/tasks-vision/wasm`, `${vendor}/mediapipe/wasm`);
