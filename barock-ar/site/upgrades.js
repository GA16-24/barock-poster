import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBook } from './book.js';

// A variant owns one cached root and its animation. Only the selected root belongs to the rendered scene.
// { id, title, kicker, description, background, camera: { position, target }, build() => { root, modelCount, update } }
const VARIANTS = [
  {
    id: 'theater', title: 'Das lebendige Theater', kicker: 'Museum wird Bühne',
    description: 'Rote Samtvorhänge, vergoldete Bühnenarchitektur und die drei Dichter verbinden die vertraute Sammlung zu einem lebendigen Tableau.',
    background: 0x120b09, camera: { position: [0, 2.25, 9.3], target: [0, 0.25, 0] }, build: buildTheater,
  },
  {
    id: 'worlds', title: 'Zwei Welten', kicker: 'Die barocke Antithese',
    description: 'Krone und Schloss stehen Bauernhaus und Brot gegenüber. Eine bewegliche Waage hält die Gegensätze in der Mitte zusammen.',
    background: 0x11110f, camera: { position: [0, 2.35, 9.5], target: [0, 0.15, 0] }, build: buildWorlds,
  },
  {
    id: 'portal', title: 'Das Zeitportal', kicker: 'Eine Reise durch die Epoche',
    description: 'Konzentrische Portale öffnen den Blick in die Tiefe. Bücher, eine Stadtansicht und vier Jahreszahlen ordnen die Zeitreise.',
    background: 0x071416, camera: { position: [0, 1.75, 9.4], target: [0, 0.25, -0.4] }, build: buildPortal,
  },
];

const canvas = document.querySelector('#stage');
const viewer = document.querySelector('#viewer');
const status = document.querySelector('#scene-status');
const tabs = [...document.querySelectorAll('[data-variant]')];
const cache = new Map();
const modelCache = new Map();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.65;
pmrem.dispose();

MeshoptDecoder.useWorkers(2);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const clock = new THREE.Clock();
const rotations = new Map(VARIANTS.map(({ id }) => [id, { yaw: 0, pitch: 0 }]));
let active = null;
let activeId = 'theater';
let activation = 0;
let renderedFrames = 0;
let yaw = 0;
let pitch = 0;
let dragging = false;
let pointer = { x: 0, y: 0 };

const gold = (extra = {}) => new THREE.MeshStandardMaterial({ color: 0xc79a43, metalness: 0.78, roughness: 0.28, ...extra });
const plain = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra });

function addMesh(parent, geometry, material, position = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.fromArray(position);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(parent, size, position, material) {
  return addMesh(parent, new THREE.BoxGeometry(...size), material, position);
}

function cylinder(parent, radii, height, position, material, segments = 32) {
  return addMesh(parent, new THREE.CylinderGeometry(radii[0], radii[1], height, segments), material, position);
}

function rodBetween(parent, from, to, radius, material) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const rod = addMesh(parent, new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 10), material);
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  return rod;
}

function plaque(text, width = 1.25, height = 0.34, subtitle = '') {
  const surface = document.createElement('canvas');
  surface.width = 768;
  surface.height = 220;
  const ctx = surface.getContext('2d');
  ctx.fillStyle = '#17130e';
  ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.strokeStyle = '#b38a39';
  ctx.lineWidth = 5;
  ctx.strokeRect(10, 10, surface.width - 20, surface.height - 20);
  ctx.strokeRect(20, 20, surface.width - 40, surface.height - 40);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ecd28c';
  ctx.font = `${subtitle ? 66 : 78}px Georgia, serif`;
  ctx.fillText(text, surface.width / 2, subtitle ? 88 : 111);
  if (subtitle) {
    ctx.fillStyle = '#c6b994';
    ctx.font = '31px Georgia, serif';
    ctx.fillText(subtitle, surface.width / 2, 158);
  }
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const object = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
  );
  object.castShadow = false;
  return object;
}

async function loadModel(url, size) {
  if (!modelCache.has(url)) {
    modelCache.set(url, loader.loadAsync(url).catch((error) => {
      modelCache.delete(url);
      throw error;
    }));
  }
  const gltf = await modelCache.get(url);
  const model = gltf.scene.clone(true);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const scale = size / Math.max(dimensions.x, dimensions.y, dimensions.z);
  model.scale.setScalar(scale);
  model.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  const holder = new THREE.Group();
  holder.add(model);
  return holder;
}

function particles(count, bounds, color, size = 0.025) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = THREE.MathUtils.randFloat(-bounds[0], bounds[0]);
    positions[i * 3 + 1] = THREE.MathUtils.randFloat(-bounds[1], bounds[1]);
    positions[i * 3 + 2] = THREE.MathUtils.randFloat(-bounds[2], bounds[2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  return { points, positions };
}

function pedestal(parent, x, material) {
  cylinder(parent, [0.52, 0.62], 0.16, [x, -1.42, 0], material);
  cylinder(parent, [0.4, 0.48], 0.82, [x, -0.94, 0], plain(0x241710));
  cylinder(parent, [0.54, 0.46], 0.16, [x, -0.45, 0], material);
}

async function buildTheater() {
  const root = new THREE.Group();
  root.name = 'Das lebendige Theater';
  const gilt = gold();
  const velvet = plain(0x3d1014, { roughness: 1 });
  const wood = plain(0x4a2b18, { roughness: 0.75 });

  const back = addMesh(root, new THREE.PlaneGeometry(8.6, 5.8), velvet, [0, 0.55, -1.9]);
  back.receiveShadow = true;
  const floor = cylinder(root, [4.05, 4.05], 0.25, [0, -1.67, 0.1], wood, 64);
  floor.scale.z = 0.66;
  const rim = addMesh(root, new THREE.TorusGeometry(4.04, 0.065, 10, 80), gilt, [0, -1.53, 0.1]);
  rim.rotation.x = Math.PI / 2;
  rim.scale.z = 0.66;
  for (let x = -3.2; x <= 3.2; x += 0.4) box(root, [0.012, 0.008, 4.6], [x, -1.535, 0.2], plain(0x21150f));

  const proscenium = await loadModel('models/upgrades/kimi-proscenium.glb', 6.8);
  proscenium.position.set(0, 0.45, -1.18);
  root.add(proscenium);

  const authors = [
    ['andreae', 'ANDREAE'], ['bidermann', 'BIDERMANN'], ['birken', 'BIRKEN'],
  ];
  const heads = await Promise.all(authors.map(async ([id, name], index) => {
    const x = (index - 1) * 1.48;
    pedestal(root, x, gilt);
    const frame = addMesh(root, new THREE.TorusGeometry(0.66, 0.055, 10, 48), gilt, [x, 0.32, -0.5]);
    frame.scale.y = 1.2;
    const innerFrame = addMesh(root, new THREE.TorusGeometry(0.57, 0.018, 8, 48), gilt, [x, 0.32, -0.46]);
    innerFrame.scale.y = 1.2;
    const head = await loadModel(`models/heads/${id}.glb`, 1.25);
    head.position.set(x, 0.35, 0.03);
    root.add(head);
    const nameplate = plaque(name, 1.08, 0.28);
    nameplate.position.set(x, -1.03, 0.51);
    root.add(nameplate);
    return head;
  }));

  const book = buildBook({ size: 1.15, cover: 'img/works/andreae.jpg', title: 'Johann Valentin Andreae' });
  book.object.position.set(0, -0.95, 1.55);
  book.object.rotation.set(-0.12, -0.12, 0);
  root.add(book.object);
  const dust = particles(240, [3.5, 2.4, 2.2], 0xffd58a, 0.027);
  dust.points.position.y = 0.35;
  root.add(dust.points);

  root.add(new THREE.HemisphereLight(0xffdfad, 0x241018, 1.25));
  const key = new THREE.DirectionalLight(0xffe0a8, 3.2);
  key.position.set(-3, 5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -4, near: 0.5, far: 18 });
  key.shadow.bias = -0.0005;
  root.add(key);
  const warmth = new THREE.PointLight(0xff9d45, 38, 11, 2);
  warmth.position.set(0, 1.7, 3.2);
  root.add(warmth);
  const sideLight = new THREE.PointLight(0xffc069, 24, 9, 2);
  sideLight.position.set(-3.4, 0.8, 1.8);
  root.add(sideLight);

  return {
    root, modelCount: 5,
    update(t) {
      warmth.intensity = 37 + Math.sin(t * 3.1) * 2.2 + Math.sin(t * 7.7) * 1.1;
      heads.forEach((head, i) => { head.rotation.y = Math.sin(t * 0.38 + i * 1.7) * 0.055; });
      book.setOpen(0.18 + (Math.sin(t * 0.55) + 1) * 0.08);
      dust.points.rotation.y = t * 0.018;
      dust.points.position.y = 0.35 + Math.sin(t * 0.32) * 0.12;
    },
  };
}

function balancePan(material) {
  const pan = new THREE.Group();
  const bowl = addMesh(pan, new THREE.SphereGeometry(0.5, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), material);
  bowl.material.side = THREE.DoubleSide;
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    rodBetween(pan, [0, 0.83, 0], [Math.cos(angle) * 0.43, 0, Math.sin(angle) * 0.43], 0.012, material);
  }
  return pan;
}

async function buildWorlds() {
  const root = new THREE.Group();
  root.name = 'Zwei Welten';
  const gilt = gold();
  const timber = plain(0x6f4728, { roughness: 0.92 });
  const noble = plain(0x24141d, { roughness: 0.86 });
  const earth = plain(0x493522, { roughness: 1 });

  box(root, [3.9, 0.3, 4.3], [-1.98, -1.67, 0], noble);
  box(root, [3.9, 0.3, 4.3], [1.98, -1.67, 0], earth);
  box(root, [3.9, 0.08, 0.08], [-1.98, -1.48, 2.12], gilt);
  box(root, [3.9, 0.08, 0.08], [1.98, -1.48, 2.12], timber);
  box(root, [3.85, 4.6, 0.12], [-1.96, 0.55, -2.0], plain(0x21151e));
  box(root, [3.85, 4.6, 0.12], [1.96, 0.55, -2.0], plain(0x273027));
  for (const x of [-3.63, -0.35]) {
    cylinder(root, [0.1, 0.13], 3.0, [x, -0.05, -1.78], gilt);
    cylinder(root, [0.19, 0.19], 0.12, [x, 1.48, -1.78], gilt);
  }
  const nobleArch = addMesh(root, new THREE.TorusGeometry(1.64, 0.1, 10, 48, Math.PI), gilt, [-1.99, 1.43, -1.78]);
  nobleArch.scale.y = 0.7;
  for (const x of [0.38, 3.55]) box(root, [0.16, 3.15, 0.18], [x, -0.02, -1.76], timber);
  rodBetween(root, [0.25, 1.45, -1.76], [1.96, 2.62, -1.76], 0.09, timber);
  rodBetween(root, [1.96, 2.62, -1.76], [3.68, 1.45, -1.76], 0.09, timber);
  rodBetween(root, [0.45, 1.48, -1.76], [3.48, 1.48, -1.76], 0.07, timber);
  rodBetween(root, [0.45, -0.5, -1.76], [3.48, 1.42, -1.76], 0.055, timber);

  const [castle, crown, house, bread] = await Promise.all([
    loadModel('models/adel/schloss.glb', 1.85),
    loadModel('models/upgrades/kimi-crown.glb', 1.0),
    loadModel('models/volk/bauernhaus.glb', 1.75),
    loadModel('models/volk/brot.glb', 0.95),
  ]);
  castle.position.set(-2.02, -0.47, -0.55);
  crown.position.set(-2.0, -0.78, 0.92);
  house.position.set(2.0, -0.5, -0.52);
  bread.position.set(2.03, -0.93, 1.0);
  root.add(castle, crown, house, bread);
  cylinder(root, [0.73, 0.82], 0.18, [-2.0, -1.37, 0.9], gilt);
  cylinder(root, [0.76, 0.82], 0.16, [2.03, -1.39, 1.0], timber);

  const adel = plaque('ADEL', 1.15, 0.31, 'Prunk und Herrschaft');
  adel.position.set(-2.05, -1.16, 2.17);
  root.add(adel);
  const volk = plaque('VOLK', 1.15, 0.31, 'Arbeit und Alltag');
  volk.position.set(2.03, -1.16, 2.17);
  root.add(volk);

  cylinder(root, [0.44, 0.58], 0.17, [0, -1.41, 1.15], gilt);
  cylinder(root, [0.075, 0.11], 2.75, [0, -0.02, 1.15], gilt);
  addMesh(root, new THREE.SphereGeometry(0.15, 20, 12), gilt, [0, 1.47, 1.15]);
  const beam = new THREE.Group();
  beam.position.set(0, 1.22, 1.15);
  box(beam, [2.75, 0.095, 0.1], [0, 0, 0], gilt);
  for (const x of [-1.34, 1.34]) addMesh(beam, new THREE.SphereGeometry(0.09, 16, 10), gilt, [x, 0, 0]);
  root.add(beam);
  const leftPan = balancePan(gilt);
  const rightPan = balancePan(gilt);
  root.add(leftPan, rightPan);

  root.add(new THREE.HemisphereLight(0xffe0a3, 0x18201b, 1.2));
  const key = new THREE.DirectionalLight(0xffe1ae, 2.8);
  key.position.set(-3, 5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -4, near: 0.5, far: 18 });
  root.add(key);
  const nobleLight = new THREE.PointLight(0xffc66d, 24, 8, 2);
  nobleLight.position.set(-2.5, 1.7, 2.4);
  root.add(nobleLight);
  const folkLight = new THREE.PointLight(0xb9d39b, 18, 8, 2);
  folkLight.position.set(2.7, 1.4, 2.0);
  root.add(folkLight);

  return {
    root, modelCount: 4,
    update(t) {
      const angle = Math.sin(t * 0.72) * 0.065;
      beam.rotation.z = angle;
      for (const [pan, side] of [[leftPan, -1], [rightPan, 1]]) {
        pan.position.set(side * 1.34 * Math.cos(angle), 1.22 + side * 1.34 * Math.sin(angle) - 0.83, 1.15);
      }
      crown.position.y = -0.78 + Math.sin(t * 0.8) * 0.035;
      crown.rotation.y = Math.sin(t * 0.4) * 0.13;
      bread.position.y = -0.93 + Math.sin(t * 0.8 + Math.PI) * 0.018;
      castle.rotation.y = Math.sin(t * 0.25) * 0.035;
      house.rotation.y = -Math.sin(t * 0.25) * 0.035;
    },
  };
}

async function buildPortal() {
  const root = new THREE.Group();
  root.name = 'Das Zeitportal';
  const gilt = gold({ emissive: 0x3b2408, emissiveIntensity: 0.45 });
  const glow = gold({ color: 0x8dd8ce, emissive: 0x3baca4, emissiveIntensity: 1.7, metalness: 0.35, roughness: 0.25 });
  const armillary = await loadModel('models/upgrades/kimi-armillary.glb', 4.4);
  armillary.position.set(0, 0.28, -0.7);
  root.add(armillary);
  const floor = cylinder(root, [3.35, 3.35], 0.12, [0, -1.72, -0.3], plain(0x102526, { metalness: 0.45, roughness: 0.35 }), 64);
  floor.scale.z = 0.72;
  const floorRing = addMesh(root, new THREE.TorusGeometry(3.32, 0.025, 8, 72), glow, [0, -1.65, -0.3]);
  floorRing.rotation.x = Math.PI / 2;
  floorRing.scale.z = 0.72;

  const map = await loadModel('models/maps/tuebingen.glb', 2.15);
  map.position.set(0, -0.64, -0.7);
  root.add(map);
  const books = [
    { book: buildBook({ size: 1.12, cover: 'img/works/andreae.jpg', title: 'Johann Valentin Andreae' }), at: [-2.0, -0.38, 0.5], turn: 0.48 },
    { book: buildBook({ size: 1.0, cover: 'img/works/bidermann.jpg', title: 'Jakob Bidermann' }), at: [1.86, 0.22, -0.85], turn: -0.52 },
    { book: buildBook({ size: 0.88, cover: 'img/works/birken.jpg', title: 'Sigmund von Birken' }), at: [1.62, -0.98, 1.0], turn: -0.3 },
  ];
  books.forEach(({ book, at, turn }) => {
    book.object.position.fromArray(at);
    book.object.rotation.set(-0.14, turn, turn * 0.14);
    root.add(book.object);
  });

  const dates = [
    ['1600', 'Barockbeginn', [-2.2, 1.5, 2.25]],
    ['1618', 'Kriegsbeginn', [2.15, 1.5, 1.95]],
    ['1648', 'Westfälischer Friede', [-1.85, -0.12, 1.75]],
    ['1720', 'Spätbarock', [1.95, 0.02, 1.45]],
  ];
  const timelinePoints = [];
  dates.forEach(([year, label, at]) => {
    const marker = plaque(year, 1.08, 0.43, label);
    marker.position.fromArray(at);
    root.add(marker);
    const point = new THREE.Vector3(...at);
    timelinePoints.push(point);
    addMesh(root, new THREE.SphereGeometry(0.075, 16, 10), glow, [at[0], at[1] - 0.32, at[2]]);
    rodBetween(root, [at[0], at[1] - 0.21, at[2]], [at[0], at[1] - 0.48, at[2]], 0.012, gilt);
  });
  const timeline = new THREE.CatmullRomCurve3(timelinePoints.map((point) => point.clone().add(new THREE.Vector3(0, -0.48, 0))));
  addMesh(root, new THREE.TubeGeometry(timeline, 72, 0.012, 6, false), gilt);

  const dust = particles(480, [3.4, 2.6, 3.8], 0x9fe7d8, 0.026);
  dust.points.position.set(0, 0.25, -0.5);
  root.add(dust.points);
  root.add(new THREE.HemisphereLight(0x9fd9d2, 0x0b1018, 1.35));
  const key = new THREE.DirectionalLight(0xffdf9f, 2.7);
  key.position.set(-3, 4, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -4, near: 0.5, far: 18 });
  root.add(key);
  const portalLight = new THREE.PointLight(0x65d9cf, 35, 10, 2);
  portalLight.position.set(0, 0.5, 2.7);
  root.add(portalLight);
  const bookLight = new THREE.PointLight(0xffbd62, 22, 8, 2);
  bookLight.position.set(-2.5, 1.8, 2.0);
  root.add(bookLight);

  return {
    root, modelCount: 5,
    update(t, dt) {
      armillary.position.y = 0.28 + Math.sin(t * 0.45) * 0.025;
      armillary.rotation.y = t * 0.08;
      glow.emissiveIntensity = 1.55 + Math.sin(t * 1.2) * 0.25;
      portalLight.intensity = 34 + Math.sin(t * 1.4) * 4;
      books.forEach(({ book, at, turn }, i) => {
        book.object.position.y = at[1] + Math.sin(t * 0.65 + i * 1.8) * 0.09;
        book.object.rotation.y = turn + Math.sin(t * 0.35 + i) * 0.09;
        book.setOpen(0.12 + (Math.sin(t * 0.5 + i) + 1) * 0.08);
      });
      map.rotation.y = Math.sin(t * 0.25) * 0.045;
      const positions = dust.points.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        let z = positions.getZ(i) + dt * (0.11 + (i % 7) * 0.014);
        if (z > 3.8) z = -3.8;
        positions.setZ(i, z);
      }
      positions.needsUpdate = true;
      dust.points.rotation.z = Math.sin(t * 0.08) * 0.025;
    },
  };
}

function resize() {
  const { width, height } = viewer.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  const variant = VARIANTS.find(({ id }) => id === activeId);
  const fit = Math.max(1, 1.22 / camera.aspect);
  camera.position.fromArray(variant.camera.position);
  camera.position.z *= fit;
  camera.lookAt(new THREE.Vector3(...variant.camera.target));
  camera.updateProjectionMatrix();
}

function updateInterface(variant, index) {
  document.querySelector('#scene-index').textContent = `Studie 0${index + 1} / 03`;
  document.querySelector('#scene-kicker').textContent = variant.kicker;
  document.querySelector('#scene-title').textContent = variant.title;
  document.querySelector('#scene-description').textContent = variant.description;
  document.querySelector('#preview').setAttribute('aria-labelledby', `tab-${variant.id}`);
  for (const tab of tabs) {
    const selected = tab.dataset.variant === variant.id;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
}

async function activate(id) {
  const index = VARIANTS.findIndex((variant) => variant.id === id);
  if (index < 0 || (id === activeId && active)) return;
  const variant = VARIANTS[index];
  const token = ++activation;
  activeId = id;
  updateInterface(variant, index);
  status.textContent = cache.has(id) ? 'Szene wird gewechselt' : 'Modelle werden geladen';
  status.classList.add('is-loading');
  if (active) scene.remove(active.root);
  active = null;
  const rotation = rotations.get(id);
  yaw = rotation.yaw;
  pitch = rotation.pitch;
  try {
    if (!cache.has(id)) cache.set(id, variant.build());
    const runtime = await cache.get(id);
    if (token !== activation) return;
    active = runtime;
    scene.background = new THREE.Color(variant.background);
    scene.fog = new THREE.FogExp2(variant.background, id === 'portal' ? 0.028 : 0.018);
    scene.add(runtime.root);
    resize();
    status.textContent = 'Bereit zum Drehen';
    status.classList.remove('is-loading');
  } catch (error) {
    cache.delete(id);
    if (token !== activation) return;
    status.textContent = 'Szene konnte nicht geladen werden';
    status.classList.remove('is-loading');
    console.error(`Vorschau ${id}:`, error);
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activate(tab.dataset.variant));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else next = (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    activate(tabs[next].dataset.variant);
  });
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  dragging = true;
  pointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const rotation = rotations.get(activeId);
  rotation.yaw += (event.clientX - pointer.x) * 0.008;
  rotation.pitch = THREE.MathUtils.clamp(rotation.pitch + (event.clientY - pointer.y) * 0.005, -0.34, 0.34);
  pointer = { x: event.clientX, y: event.clientY };
});
const stopDrag = () => { dragging = false; };
canvas.addEventListener('pointerup', stopDrag);
canvas.addEventListener('pointercancel', stopDrag);
canvas.addEventListener('lostpointercapture', stopDrag);
canvas.addEventListener('keydown', (event) => {
  const rotation = rotations.get(activeId);
  if (event.key === 'ArrowLeft') rotation.yaw -= 0.12;
  else if (event.key === 'ArrowRight') rotation.yaw += 0.12;
  else if (event.key === 'ArrowUp') rotation.pitch = Math.max(-0.34, rotation.pitch - 0.08);
  else if (event.key === 'ArrowDown') rotation.pitch = Math.min(0.34, rotation.pitch + 0.08);
  else return;
  event.preventDefault();
});

new ResizeObserver(resize).observe(viewer);
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (active) {
    const rotation = rotations.get(activeId);
    const damping = 1 - Math.exp(-dt * 10);
    yaw += (rotation.yaw - yaw) * damping;
    pitch += (rotation.pitch - pitch) * damping;
    active.root.rotation.y = yaw;
    active.root.rotation.x = pitch;
    active.update(t, dt);
  }
  renderer.render(scene, camera);
  renderedFrames++;
});

window.__upgrades = {
  get activeVariant() { return active ? activeId : null; },
  get meshCount() {
    let count = 0;
    active?.root.traverse((object) => { if (object.isMesh && object.visible) count++; });
    return count;
  },
  get modelCount() { return active?.modelCount ?? 0; },
  get renderedFrames() { return renderedFrames; },
  get triangles() { return renderer.info.render.triangles; },
  get drawCalls() { return renderer.info.render.calls; },
  get rotation() { return { yaw, pitch }; },
  get loadedVariants() { return [...cache.keys()]; },
};

resize();
activate('theater');
