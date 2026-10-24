import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ZONES, TITLE_Y, COLS, ROWS, NICHE, ITEMS, AUTHORS, HEAD_SIZE, MEDALLION, MAP, BOOK } from './catalog.js';
import { buildBook } from './book.js';
import { buildNiche, buildCornice, buildArch, buildConsole, buildDust, createLink, spinPart } from './gallery.js';

// Everything anchored to the thermostat, in its frame (meters, z out of the wall).
export const stage = new THREE.Group();

// One grabbable thing. `holder` sits at the catalog position and carries the pose and selection motion; `inner`
// carries the idle motion; the loaded model inside is centered and scaled to fit. Maps and books belong to an author
// and only show while he is active (`show` eases between 0 and 1). Items and heads hang in a niche.
// { id, kind: 'item' | 'head' | 'book' | 'map', author, size, rest: Vector3, yaw, holder, inner, box: Box3 | null,
//   mats: Material[], mixer, book, niche, drape, role: null | 'partner' | 'related', show, hover, lift: Spring, enter: Spring,
//   lit, dim, spin, phase, t0 }. `drape` is when its niche's drapes start to part; the object steps out at `t0`.
export const entries = [];

// HTML labels follow these markers: { text, sub, kind: 'zone' | 'name', id, marker: Object3D, width, show, start }.
// `width` is the label's width in meters on the wall, so it shrinks with distance and cannot overlap its neighbor.
// A name plate's id is its author, so tapping the plate works like grabbing the head.
export const labels = [];

const LIFT = { item: 0.2, head: 0.1, book: 0.12, map: 0 };
const GROW = { item: 0.4, head: 0.22, book: 0.3, map: 0.04 };
const ROLE_LIFT = { partner: 0.4, related: 1 };
const BOOK_YAW = 0.3;
const ENTER = { grow: 0.45, drape: 0.5 };

let active = AUTHORS[0].id;
let selected = null;
let hovered = null;
let gaze = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ramp = (age, start, dur) => clamp01((age - start) / dur);
const smooth = (x) => x * x * (3 - 2 * x);
const backOut = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const ease = (cur, goal, dt, rate) => cur + (goal - cur) * (1 - Math.exp(-dt * rate));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Underdamped, so whatever comes forward overshoots by about a fifth and settles. Substeps keep it stable at any dt.
function spring(s, goal, dt, w = 13, zeta = 0.45) {
  const n = Math.ceil(dt * 120), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (w * w * (goal - s.x) - 2 * zeta * w * s.v) * h;
    s.x += s.v * h;
  }
}

function addEntry({ id, kind, author = null, size, at, yaw = 0, ...rest }) {
  const holder = new THREE.Group();
  holder.rotation.order = 'YXZ';
  holder.position.fromArray(at);
  stage.add(holder);
  const e = {
    id, kind, author, size, rest: holder.position.clone(), yaw, holder, inner: null, box: null, mats: [], mixer: null, book: null,
    niche: null, drape: 0, tint: [], role: null, show: kind === 'map' || kind === 'book' ? 0 : 1, hover: 0, lift: { x: 0, v: 0 }, enter: { x: 0, v: 0 }, lit: 0, dim: 0, lum: 0,
    spin: 0, phase: Math.random() * 6.28, t0: 0, ...rest,
  };
  if (kind === 'head') Object.assign(e, { yawS: { x: 0, v: 0 }, pitchS: { x: 0, v: 0 }, glanceUntil: 0, glanceAt: null });
  entries.push(e);
  return e;
}

// The case comes out of the wall from `start`; what hangs in it steps out as it arrives.
function hang(entry, niche, start) {
  niche.start = start;
  niche.group.position.set(entry.rest.x, entry.rest.y, 0);
  stage.add(niche.group);
  entry.niche = niche;
  entry.t0 = start + ENTER.grow * 0.8;
}

function addLabel(text, sub, kind, at, width, start, id = null) {
  const marker = new THREE.Object3D();
  marker.position.fromArray(at);
  stage.add(marker);
  labels.push({ text, sub, kind, id, marker, width, show: 0, start });
}

let renderer = null, world = null;
const compileCamera = new THREE.PerspectiveCamera();

// The object only becomes visible (e.box set) once its shaders are compiled and its textures uploaded; compiling on
// first draw instead stalls a phone for a second or more, and with it the camera tracking.
async function adopt(e, object) {
  const inner = new THREE.Group();
  inner.add(object);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  // A head is picked by its whole medallion, name plate included.
  if (e.kind === 'head') box.expandByScalar(0.01).min.y -= 0.08;
  e.inner = inner;
  e.holder.add(inner);
  object.traverse((o) => {
    if (!o.isMesh) return;
    // The invisible wall would draw a map's big shadow as a grey blob over whatever stands in front of the real wall,
    // like a desk.
    o.castShadow = e.kind !== 'map';
    o.receiveShadow = e.kind === 'map';
    for (const m of [o.material].flat()) {
      if (m.emissive && !e.mats.includes(m)) e.mats.push(m);
      if (e.kind === 'map' && !e.tint.includes(m)) e.tint.push(m);
      if (e.wheel) e.angle = spinPart(m, e.wheel);
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
  if (e.roll) model.rotation.z = e.roll;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, !!e.roll);
  const dims = box.getSize(new THREE.Vector3());
  // Every prop is scaled into the same niche opening, so what hangs side by side has one size rule.
  const k = e.kind === 'item'
    ? Math.min(NICHE.fit[0] / dims.x, NICHE.fit[1] / dims.y, NICHE.reach / dims.z)
    : e.size / Math.max(dims.x, dims.y, dims.z);
  model.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-k);
  model.scale.setScalar(k);
  e.size = Math.max(dims.x, dims.y, dims.z) * k;
  await adopt(e, model);
  if (gltf.animations.length) {
    e.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) e.mixer.clipAction(clip).play();
  }
}

const offCenter = (x) => (Math.abs(x) < 0.01 ? 0 : 1);

// The cases open as a wave from the thermostat outward, both cases of a pair at once.
for (const item of ITEMS) {
  const [col, row] = item.slot;
  const far = Math.hypot(COLS[col], ROWS[row]) - Math.hypot(COLS[0], ROWS[1]);
  const e = addEntry({ ...item, kind: 'item', size: NICHE.fit[0] });
  hang(e, buildNiche({ shape: 'rect', ...NICHE, style: ZONES[item.zone].style }), 0.15 + far * 0.5);
  e.drape = 0.8 + far * 1.6;
  e.t0 = e.drape + 0.15;
}
// The three books share one niche; only the active author's book hangs in it.
const bookNiche = buildNiche({ shape: 'rect', ...BOOK.niche, style: ZONES.autoren.style });
for (const a of AUTHORS) {
  const e = addEntry({ id: a.id, kind: 'head', author: a, size: HEAD_SIZE, at: a.at });
  hang(e, buildNiche({ shape: 'oval', w: MEDALLION.w, h: MEDALLION.h, depth: MEDALLION.depth, style: ZONES.autoren.style }), 0.2 + offCenter(a.at[0]) * 0.1);
  addEntry({ id: `${a.id}-ort`, kind: 'map', author: a, size: MAP.size, at: MAP.at }).t0 = 1.2;
  const b = addEntry({ id: `${a.id}-werk`, kind: 'book', author: a, size: BOOK.size, at: BOOK.at, yaw: BOOK_YAW });
  b.book = buildBook({ size: BOOK.size, cover: a.cover, title: a.name });
  hang(b, bookNiche, 0.2);
  addLabel(a.name.split(' ').at(-1), a.reconstruction ? `${a.life}\nRekonstruktion` : a.life, 'name', [a.at[0], a.at[1] - MEDALLION.plateDrop, MEDALLION.depth + 0.012], MEDALLION.plate, 0.75 + offCenter(a.at[0]) * 0.1, a.id);
}

for (const [name, z] of Object.entries(ZONES)) addLabel(z.title, '', 'zone', [z.x, TITLE_Y, name === 'autoren' ? 0.1 : 0.055], 0.4, name === 'autoren' ? 0.25 : 0.4);
const cornice = buildCornice(), arch = buildArch(), table = buildConsole();
stage.add(cornice.group, arch.group, table.group);
const structure = (age) => {
  cornice.set(smooth(ramp(age, 0.05, 0.5)), backOut(ramp(age, 0, 0.4)));
  arch.set(smooth(ramp(age, 0.1, 0.6)));
  table.set(smooth(ramp(age, 1.0, 0.4)));
};
const dust = buildDust();
stage.add(dust.points);
const links = [createLink(), createLink()];
for (const l of links) stage.add(l.group);

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

const candle = new THREE.PointLight(0xffb060, 0, 0.9, 2);
const accent = new THREE.PointLight(0xffd08a, 0, 0.8, 2);

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

  // The only two point lights: a candle flame at the chandelier, and an accent that lights the counterpart of a
  // selected object.
  const chandelier = entries.find((e) => e.candle);
  candle.position.set(chandelier.rest.x, chandelier.rest.y - 0.02, 0.26);
  accent.position.set(0, 0, 0.26);
  stage.add(candle, accent);

  // An invisible wall at z = 0 that only shows the shadows the objects throw onto the real wall.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.ShadowMaterial({ opacity: 0.3 }));
  wall.receiveShadow = true;
  stage.add(wall);
  for (const e of entries) if (e.book) adopt(e, e.book.object);

  // Compile the niche, link and veil programs now, with everything switched on, instead of on first draw.
  const shown = stage.visible;
  stage.visible = true;
  const niches = entries.filter((e) => e.niche);
  for (const e of niches) e.niche.set(1, 0, 1);
  structure(Infinity);
  for (const l of links) l.group.visible = true;
  renderer.compileAsync(stage, compileCamera, world).finally(() => {
    for (const e of niches) e.niche.set(0, 0, 0);
    structure(0);
    for (const l of links) l.group.visible = false;
  });
  stage.visible = shown;
}

export function setHover(e) { hovered = e; }
// The ray of the hand cursor, or null; heads glance at where it points on a plane just in front of the wall.
const gazePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.3), gazeHit = new THREE.Vector3(), gazeRay = new THREE.Ray(), stageInv = new THREE.Matrix4();
export function setGaze(ray) {
  gaze = ray && gazeRay.copy(ray).applyMatrix4(stageInv.copy(stage.matrixWorld).invert()).intersectPlane(gazePlane, gazeHit);
}

// Where a thread meets an object: just in front of its niche, under a poet's name plate (so no thread crosses his
// face), or the back edge of the map table.
const anchor = (e) => e.kind === 'map' ? e.rest.clone().add(new THREE.Vector3(0, 0.1, -0.38))
  : e.kind === 'head' ? new THREE.Vector3(e.rest.x, e.rest.y - MEDALLION.plateDrop - 0.035, MEDALLION.depth + 0.03)
  : e.rest.clone().add(new THREE.Vector3(0, 0, e.kind === 'item' ? 0.16 : 0.14));
// Where heads look: the face of a poet, the thread end of anything else.
const facePoint = (e) => (e.kind === 'head' ? e.rest.clone().setZ(0.3) : anchor(e));
const P = (x, y, z) => new THREE.Vector3(x, y, z);
// Gold threads stay out of the medallions and off the thermostat: a pair arcs over the poets' heads (upper rows)
// or under the book niche (lower rows); a poet's threads leave his name plate and swing out on side `sx`.
function route(from, to, sx) {
  const a = anchor(from), b = anchor(to);
  if (from.kind === 'item') {
    const y = from.rest.y > 0 ? [0.64, 0.675] : [-0.5, -0.47];
    return [a, P(a.x * 0.8, y[0], 0.3), P(0, y[1], 0.32), P(b.x * 0.8, y[0], 0.3), b];
  }
  const poet = from.kind === 'head' ? from : to.kind === 'head' ? to : null;
  const map = from.kind === 'map' || to.kind === 'map';
  const x = poet ? sx * Math.max(map ? 0.3 : 0.2, Math.abs(poet.rest.x) + (map ? 0.1 : -0.06)) : sx * 0.2;
  return [a, P(x, (a.y + b.y) / 2, map ? 0.32 : 0.24), b];
}

const head = (author) => entries.find((e) => e.kind === 'head' && e.author === author);
const sibling = (e, kind) => entries.find((x) => x.kind === kind && x.author === e.author);
function relatives(e) {
  if (e.kind === 'item') return [entries.find((x) => x.id === e.partner)];
  if (e.kind === 'head') return [sibling(e, 'book'), sibling(e, 'map')];
  return [head(e.author), sibling(e, e.kind === 'book' ? 'map' : 'book')];
}

let lookAt = null;
export function select(e) {
  selected = e;
  for (const x of entries) x.role = null;
  links.forEach((l) => l.release());
  if (!e) { lookAt = null; return; }
  if (e.kind === 'head') {
    active = e.author.id;
    e.pitchS.v += 1.4;
  }
  const related = relatives(e).filter(Boolean);
  related.forEach((r, i) => {
    r.role = e.kind === 'item' ? 'partner' : 'related';
    const poet = e.kind === 'item' ? null : e.kind === 'head' ? e : r.kind === 'head' ? r : head(e.author);
    links[i].set(route(e, r, Math.sign(poet?.rest.x) || (i ? 1 : -1)));
  });
  lookAt = facePoint(e);
  if (e.kind === 'item') lookAt.z += LIFT.item;
  if (e.kind === 'item') accent.position.set(related[0].rest.x, related[0].rest.y, 0.26);
}
export const selectedEntry = () => selected;

const GLOW = new THREE.Color(0.07, 0.05, 0.015);
const V = new THREE.Vector3();

function aim(e, p, dt, w = 7.7, zeta = 0.58) {
  const yaw = p ? THREE.MathUtils.clamp(Math.atan2(p.x - e.rest.x, p.z - e.rest.z), -0.85, 0.85) : 0;
  const pitch = p ? THREE.MathUtils.clamp(-Math.atan2(p.y - e.rest.y, Math.hypot(p.x - e.rest.x, p.z - e.rest.z)) * 0.8, -0.3, 0.3) : 0;
  spring(e.yawS, yaw, dt, w, zeta);
  spring(e.pitchS, pitch, dt, w, zeta);
}

// Every few seconds a head glances at a neighbor, at the hand cursor, or back at the viewer.
function glance(e, t) {
  if (t >= e.glanceUntil) {
    e.glanceUntil = t + 1.6 + Math.random() * 2.6;
    const others = entries.filter((x) => x.kind === 'head' && x !== e);
    const r = Math.random();
    e.glanceAt = gaze && r < 0.55 ? 'cursor' : r < 0.8 ? others[Math.floor(Math.random() * others.length)] : null;
  }
  return e.glanceAt === 'cursor' ? gaze : e.glanceAt ? V.copy(e.glanceAt.rest).setZ(0.3) : null;
}

function pivot(e, y, angle) {
  e.inner.rotation.z = angle;
  e.inner.position.set(y * Math.sin(angle), y * (1 - Math.cos(angle)), 0);
}

const IDLE = {
  sway: (e, t, a) => pivot(e, e.box.max.y, a * (Math.sin(t * 1.1 + e.phase) + 0.3 * Math.sin(t * 2.3 + e.phase))),
  rock: (e, t, a) => pivot(e, e.box.min.y, a * Math.sin(t * 2 + e.phase)),
  tilt: (e, t, a) => { e.inner.rotation.z = a * Math.sin(t * 0.8 + e.phase); },
  turn: (e, t, a) => { e.inner.rotation.y = a * Math.sin(t * 0.9 + e.phase); },
  breath: (e, t, a) => {
    const s = 1 + a * Math.sin(t * 1.4 + e.phase);
    e.inner.scale.y = s;
    e.inner.position.y = e.box.min.y * (1 - s);
  },
};

export function updateScene(t, dt, age = Infinity) {
  dust.update(t);
  structure(age);
  for (const l of labels) l.show = ramp(age, l.start, 0.4);
  for (const l of links) l.update(t, dt);

  for (const e of entries) {
    const showGoal = e.author && e.kind !== 'head' ? +(e.author.id === active) : 1;
    // Maps sink away slowly so the switch reads as one leaving and one arriving.
    e.show = ease(e.show, showGoal, dt, showGoal ? 3 : 4);
    const hover0 = e.hover;
    e.hover = ease(e.hover, +(e === hovered), dt, 12);
    spring(e.lift, e === selected ? 1 : ROLE_LIFT[e.role] ?? 0, dt);
    e.lit = ease(e.lit, e.role ? 1 : e === selected ? 0.5 : 0, dt, 6);
    const unrelated = selected && !e.role && e !== selected;
    const dimGoal = !unrelated ? 0 : e.kind === 'item' ? (selected.kind === 'item' ? 1 : 0.7) : e.kind !== 'head' && selected.kind === 'item' ? 0.8 : 0;
    e.dim = ease(e.dim, dimGoal, dt, 5);
    e.spin = e === selected && e.kind === 'item' ? e.spin + dt * 0.5 : ease(wrap(e.spin), 0, dt, 3);
    if (e.niche && (e.kind !== 'book' || e.author.id === active)) e.niche.set(smooth(ramp(age, e.niche.start, ENTER.grow)), e.lit, e.dim, smooth(ramp(age, e.drape, ENTER.drape)));
    if (e.kind === 'head') aim(e, selected ? (selected !== e ? lookAt : null) : glance(e, t), dt);

    const h = e.holder;
    // Out of its niche (or up from the console) on a spring; restarts when the entrance replays.
    const out = age >= e.t0;
    if (out) spring(e.enter, 1, dt, 11, 0.45);
    else e.enter.x = e.enter.v = 0;
    h.visible = e.show > 0.01 && !!e.box && out;
    if (!h.visible) continue;
    const l = e.lift.x, u = e.enter.x;
    h.position.copy(e.rest);
    h.position.z += (e.kind === 'map' ? 0 : (u - 1) * 0.1) + l * LIFT[e.kind] - e.dim * 0.015;
    if (e.kind === 'map') h.position.y += -(1 - e.show) * 0.4 + 0.07 * l;
    if (e.kind === 'book') h.position.y += Math.sin(t * 0.9 + e.phase) * 0.004 * l;
    h.scale.setScalar(Math.max(e.show * (e.kind === 'map' ? u : 0.85 + 0.15 * u), 0.001) * (1 + 0.05 * e.hover + GROW[e.kind] * l) * (1 - 0.04 * e.dim));
    h.rotation.set(e.kind === 'head' ? e.pitchS.x : 0, e.yaw + (e.kind === 'head' ? e.yawS.x : 0) + e.spin, 0);
    if (e.idle) {
      e.inner.rotation.set(0, 0, 0);
      e.inner.position.set(0, 0, 0);
      e.inner.scale.setScalar(1);
      IDLE[e.idle[0]](e, t, e.idle[1] * (1 - clamp01(l)));
    }
    // A map has no niche to veil, so it dims by darkening its own colors.
    if (e.kind === 'map') for (const m of e.tint) m.color.copy(m.userData.color0 ??= m.color.clone()).multiplyScalar(1 - 0.5 * e.dim);
    if (e.angle) e.angle.value = t * e.wheel.rate;
    if (e.book) e.book.setOpen(l);
    if (e.mixer) e.mixer.update(dt);
    const lum = Math.max(e.hover, e.lit * 0.8, e.candle ? 0.25 + 0.15 * Math.sin(t * 17) * Math.sin(t * 5.3) : 0);
    if (lum > 1e-3 || e.lum > 1e-3) for (const m of e.mats) m.emissive.copy(m.userData.emissive0).lerp(GLOW, Math.min(lum, 1));
    e.lum = lum;
  }

  const flicker = 0.82 + 0.12 * Math.sin(t * 17.3) * Math.sin(t * 5.1) + 0.06 * Math.sin(t * 31);
  candle.intensity = 0.22 * flicker * ramp(age, 1.2, 0.8);
  const partner = entries.find((e) => e.role === 'partner');
  accent.intensity = ease(accent.intensity, partner ? 0.4 : 0, dt, 6);
}

const invM = new THREE.Matrix4(), localRay = new THREE.Ray(), hit = new THREE.Vector3();

// Nearest object under the ray: an exact mesh hit wins; otherwise the nearest bounding box, which forgives a hand
// that grabs slightly beside a thin object like the rapier.
export function pick(raycaster) {
  const candidates = [];
  for (const e of entries) {
    if (!e.holder.visible || e.show < 0.5 || e.holder.scale.x < 0.5) continue;
    invM.copy(e.holder.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(invM);
    if (!localRay.intersectBox(e.box, hit)) continue;
    candidates.push({ e, d: hit.applyMatrix4(e.holder.matrixWorld).distanceTo(raycaster.ray.origin) });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.find(({ e }) => raycaster.intersectObject(e.holder, true).length)?.e ?? candidates[0]?.e ?? null;
}
