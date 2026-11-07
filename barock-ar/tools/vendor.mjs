import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
for (const f of ['mindar-image.prod.js', 'controller-mGt1s8dJ.js', 'ui-fBadYuor.js'])
  copy(`${root}node_modules/mind-ar/dist/${f}`, `${vendor}/mindar/${f}`);
copy(`${root}node_modules/mind-ar/LICENSE`, `${vendor}/mindar/LICENSE`);

const controller = `${vendor}/mindar/controller-mGt1s8dJ.js`;
const source = readFileSync(controller, 'utf8');
writeFileSync(controller, source.replaceAll('  } finally {\n    t && (window.URL || window.webkitURL).revokeObjectURL(t);\n  }\n}', '  }\n}'));

const decoder = `${vendor}/jsm/libs/meshopt_decoder.module.js`;
writeFileSync(decoder, readFileSync(decoder, 'utf8').replace('URL.revokeObjectURL(url);', ''));

const mindar = `${vendor}/mindar/mindar-image.prod.js`;
writeFileSync(mindar, readFileSync(mindar, 'utf8').replaceAll('./controller-mGt1s8dJ.js', './controller-mGt1s8dJ.js?v=2'));
