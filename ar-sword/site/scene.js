import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ZONES, ITEMS, AUTHORS, HEAD_SIZE, MAP, BOOK } from './catalog.js';
import { buildBook } from './book.js';

// Everything anchored to the thermostat, in its frame (meters, z out of the wall).
export const stage = new THREE.Group();

// One grabbable thing. `holder` sits at the catalog position and carries the idle and selection motion;
// the loaded model inside it is centered and scaled to `size`. Maps and books belong to an author and only
// show while he is active (`show` eases between 0 and 1).
// { id, kind: 'item' | 'head' | 'book' | 'map', author, size, rest: Vector3, yaw, holder, box: Box3 | null,
//   mats: Material[], mixer, book, show, hover, lift, spin, phase }
export const entries = [];

// HTML labels follow these markers: { text, sub, kind: 'zone' | 'name', id, marker: Object3D }. A name plate's id is
// its author, so tapping the plate works like grabbing the head.
export const labels = [];

const MAP_TILT = 0.75;
const LIFT = 0.1;
const BOOK_YAW = 0.45;

let active = AUTHORS[0].id;
let selected = null;
let hovered = null;

function addEntry({ id, kind, author = null, size, at, yaw = 0 }) {
  const holder = new THREE.Group();
  holder.position.fromArray(at);
  stage.add(holder);
  const e = {
    id, kind, author, size, rest: holder.position.clone(), yaw, holder, box: null, mats: [], mixer: null, book: null,
    show: kind === 'map' || kind === 'book' ? 0 : 1, hover: 0, lift: 0, spin: 0, phase: Math.random() * 6.28,
  };
  entries.push(e);
  return e;
}

function addMarker(text, sub, kind, at, id = null) {
  const marker = new THREE.Object3D();
  marker.position.fromArray(at);
  stage.add(marker);
  labels.push({ text, sub, kind, id, marker });
}

let renderer = null, world = null;
const compileCamera = new THREE.PerspectiveCamera();

// The object only becomes visible (e.box set) once its shaders are compiled and its textures uploaded; compiling on
// first draw instead stalls a phone for a second or more, and with it the camera tracking.
async function adopt(e, object) {
  const inner = new THREE.Group();
  inner.add(object);
  if (e.kind === 'map') inner.rotation.x = MAP_TILT;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  e.holder.add(inner);
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = e.kind === 'map';
    for (const m of [o.material].flat()) {
      if (m.emissive && !e.mats.includes(m)) e.mats.push(m);
      for (const t of Object.values(m)) if (t?.isTexture) renderer.initTexture(t);
    }
  });
  for (const m of e.mats) m.userData.emissive0 = m.emissive.clone();
  // Program variants depend on the lights, which only count while the stage is visible.
  const shown = stage.visible;
  stage.visible = true;
  const compiled = renderer.compileAsync(inner, compileCamera, world);
  stage.visible = shown;
  await compiled;
  e.box = box;
}

// Decoding a 2 MB map takes long enough on the main thread to stall the tracking, so it runs in workers.
MeshoptDecoder.useWorkers(2);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

async function loadModel(e, url) {
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch {
    console.warn(`Modell fehlt, wird übersprungen: ${url}`);
    return;
  }
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const dims = box.getSize(new THREE.Vector3());
  const k = e.size / Math.max(dims.x, dims.y, dims.z);
  model.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-k);
  model.scale.setScalar(k);
  await adopt(e, model);
  if (gltf.animations.length) {
    e.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) e.mixer.clipAction(clip).play();
  }
}

for (const item of ITEMS) addEntry({ ...item, kind: 'item' });
for (const a of AUTHORS) {
  addEntry({ id: a.id, kind: 'head', author: a, size: HEAD_SIZE, at: a.at });
  addEntry({ id: `${a.id}-ort`, kind: 'map', author: a, size: MAP.size, at: MAP.at });
  const b = addEntry({ id: `${a.id}-werk`, kind: 'book', author: a, size: BOOK.size, at: BOOK.at, yaw: BOOK_YAW });
  b.book = buildBook({ size: BOOK.size, cover: a.cover, title: a.name });
  addMarker(a.name.split(' ').at(-1), a.life, 'name', [a.at[0], a.at[1] - HEAD_SIZE * 0.74, a.at[2]], a.id);
}
for (const z of Object.values(ZONES)) addMarker(z.title, '', 'zone', [z.x, 0.76, 0.05]);

const urlOf = (e) => (e.kind === 'item' ? ITEMS.find((i) => i.id === e.id).model : e.kind === 'head' ? e.author.head : e.author.map);

// Resolves once the first view (props, heads, the active map) is loaded; the other maps follow in the background.
export async function loadScene(onProgress) {
  const isFirst = (e) => e.kind === 'item' || e.kind === 'head' || (e.kind === 'map' && e.author.id === active);
  const first = entries.filter(isFirst);
  let done = 0;
  onProgress(done, first.length);
  await Promise.all(first.map((e) => loadModel(e, urlOf(e)).then(() => onProgress(++done, first.length))));
  for (const e of entries) if (e.kind === 'map' && !isFirst(e)) loadModel(e, urlOf(e));
}

export function initStage(r, scene) {
  renderer = r;
  world = scene;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
  // High and nearly frontal, so shadows land a few centimeters below and right of each object like under a ceiling lamp.
  key.position.set(-0.5, 1.0, 2.0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.2, bottom: -1.2, near: 0.2, far: 4 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 5;
  stage.add(key, key.target);

  // An invisible wall at z = 0 that only shows the shadows the objects throw onto the real wall.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.ShadowMaterial({ opacity: 0.3 }));
  wall.receiveShadow = true;
  stage.add(wall);
  for (const e of entries) if (e.book) adopt(e, e.book.object);
}

export function setHover(e) { hovered = e; }
export function select(e) {
  selected = e;
  if (e?.kind === 'head') active = e.author.id;
}
export const selectedEntry = () => selected;

const ease = (cur, goal, dt, rate) => cur + (goal - cur) * (1 - Math.exp(-dt * rate));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const GLOW = new THREE.Color(0.07, 0.05, 0.015);

export function updateScene(t, dt) {
  for (const e of entries) {
    const showGoal = e.author && e.kind !== 'head' ? +(e.author.id === active) : 1;
    // Maps sink away slowly so the switch reads as one leaving and one arriving.
    e.show = ease(e.show, showGoal, dt, showGoal ? 3 : 4);
    const hover0 = e.hover;
    e.hover = ease(e.hover, +(e === hovered), dt, 12);
    e.lift = ease(e.lift, +(e === selected), dt, 5);
    e.spin = e === selected ? e.spin + dt * 0.6 : ease(wrap(e.spin), 0, dt, 3);

    const h = e.holder;
    h.visible = e.show > 0.01 && !!e.box;
    if (!h.visible) continue;
    h.position.copy(e.rest);
    if (e.kind === 'map') h.position.y -= (1 - e.show) * 0.4;
    if (e.kind === 'book' || (e.kind === 'item' && e.size <= 0.22)) h.position.y += Math.sin(t * 0.9 + e.phase) * 0.008;
    h.position.z += e.lift * LIFT * Math.min(1, 0.25 / e.size);
    // Big things like the maps grow less when selected so they do not fill the screen.
    h.scale.setScalar(Math.max(e.show, 0.001) * (1 + 0.05 * e.hover + 0.15 * Math.min(1, 0.25 / e.size) * e.lift));
    const idle = e.kind === 'head' ? Math.sin(t * 0.35 + e.phase) * 0.12 : 0;
    h.rotation.y = e.yaw + idle + e.spin;
    if (e.book) e.book.setOpen(e.lift);
    if (e.mixer) e.mixer.update(dt);
    if (Math.abs(e.hover - hover0) > 1e-3 || (e.hover > 1e-3 && e.hover < 0.999)) {
      for (const m of e.mats) m.emissive.copy(m.userData.emissive0).lerp(GLOW, e.hover);
    }
  }
}

const inv = new THREE.Matrix4(), localRay = new THREE.Ray(), hit = new THREE.Vector3();

// Nearest object under the ray: an exact mesh hit wins; otherwise the nearest bounding box, which forgives a hand
// that grabs slightly beside a thin object like the rapier.
export function pick(raycaster) {
  const candidates = [];
  for (const e of entries) {
    if (!e.holder.visible || e.show < 0.5) continue;
    inv.copy(e.holder.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inv);
    if (!localRay.intersectBox(e.box, hit)) continue;
    candidates.push({ e, d: hit.applyMatrix4(e.holder.matrixWorld).distanceTo(raycaster.ray.origin) });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.find(({ e }) => raycaster.intersectObject(e.holder, true).length)?.e ?? candidates[0]?.e ?? null;
}
