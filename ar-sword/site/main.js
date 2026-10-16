import * as THREE from 'three';
import { toGray, detectScreen } from './detect.js';
import { poseFromQuad } from './pose.js';
import { stage, entries, labels, initStage, loadScene, updateScene, pick, select, setHover, selectedEntry } from './scene.js';
import { loadInfo, infoFor } from './info.js';
import * as ui from './ui.js';

// At 1 to 2 m the LCD is only about 35 px wide even at 1280.
const DETECT_LONG_SIDE = 1280;
const FOCAL_PER_LONG_SIDE = 0.75;
const POSITION_SMOOTHING = 0.5;
// Smoothing runs in the gyro's world frame, where the wall never moves, so heavy rotation smoothing adds no lag when the phone turns.
const ROTATION_SMOOTHING = 0.2;
const SNAP_DISTANCE = 0.3;
const LCD_HEIGHT = 0.045;
// With the gyro the scene stays fixed in the room while the user pans across its 2.3 m; without it a held pose
// would be glued to the screen. The detector only treats the last hit as a live track for TRACK_MS, so a stale
// hit from long ago cannot lower the bar for a look-alike (the card reader) somewhere else.
const HOLD_MS = { gyro: 30000, none: 100 };
const TRACK_MS = 500;
const APPEAR_MS = 600;

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('view');

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// The shadow casters barely move, so the shadow map is redrawn at 10 Hz instead of every frame.
renderer.shadowMap.autoUpdate = false;
const SHADOW_MS = 100;
let lastShadow = -Infinity;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

const anchor = new THREE.Group();
anchor.matrixAutoUpdate = false;
scene.add(anchor);
// test/jitter.mjs samples the anchor pose; test/world.mjs reads the visibility of its first child.
globalThis.__anchor = anchor;
stage.visible = false;
anchor.add(stage);
initStage(renderer, scene);

// Camera rotation in a gravity-aligned world (y up), from the W3C device orientation angles; null without motion sensors.
let worldFromCamera = null;
const euler = new THREE.Euler();
const zUpToYUp = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const screenTurn = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
addEventListener('deviceorientation', (e) => {
  if (e.beta == null) return;
  const rad = THREE.MathUtils.degToRad;
  worldFromCamera ??= new THREE.Quaternion();
  worldFromCamera.setFromEuler(euler.set(rad(e.beta), rad(e.alpha ?? 0), -rad(e.gamma), 'YXZ'))
    .multiply(zUpToYUp)
    .multiply(screenTurn.setFromAxisAngle(Z, -rad(screen.orientation?.angle ?? 0)));
});
const hold = () => (worldFromCamera ? HOLD_MS.gyro : HOLD_MS.none);

// The thermostat hangs level on a vertical wall, so only its heading comes from the noisy quad.
const normal = new THREE.Vector3(), right = new THREE.Vector3(), basis = new THREE.Matrix4();
function uprightOnWall(q) {
  normal.copy(Z).applyQuaternion(q).setY(0);
  if (normal.lengthSq() < 1e-6) return;
  normal.normalize();
  q.setFromRotationMatrix(basis.makeBasis(right.crossVectors(UP, normal), UP, normal));
}

const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true });

let videoW = 0, videoH = 0, frameW = 0, frameH = 0, focal = 0;
let lastQuad = null;
const target = new THREE.Matrix4();
const targetPos = new THREE.Vector3(), targetQuat = new THREE.Quaternion(), targetScale = new THREE.Vector3();
// pos and quat are the smoothed anchor in the world frame; frameRot is the camera rotation when the shown video frame arrived.
const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
const frameRot = new THREE.Quaternion(), cameraFromWorld = new THREE.Quaternion();
const viewPos = new THREE.Vector3(), viewQuat = new THREE.Quaternion();
let lastHit = null;
let lastSeen = -Infinity;
let lastVideoTime = -1;
let appearStart = null;

function resize(vw, vh) {
  videoW = vw;
  videoH = vh;
  const k = Math.min(1, DETECT_LONG_SIDE / Math.max(vw, vh));
  frameW = Math.round(vw * k);
  frameH = Math.round(vh * k);
  work.width = frameW;
  work.height = frameH;
  focal = FOCAL_PER_LONG_SIDE * Math.max(frameW, frameH);
  camera.fov = (2 * Math.atan(frameH / 2 / focal) * 180) / Math.PI;
  camera.aspect = frameW / frameH;
  camera.updateProjectionMatrix();
  ui.setVideoSize(vw, vh);
  fitCanvas();
  lastQuad = null;
}

// The canvas has the video's aspect and is cropped by object-fit: cover like the video, so it is sized to the
// cropped display size to render at full screen resolution.
function fitCanvas() {
  if (!videoW) return;
  const s = Math.max(innerWidth / videoW, innerHeight / videoH);
  renderer.setSize(Math.round(videoW * s), Math.round(videoH * s), false);
}
addEventListener('resize', fitCanvas);

// The homography's scale is biased short when the LCD is small: at 1.8 m it is about 32 px wide and 0.25 px of
// corner noise puts the median depth at 1.6 m (1.05 m in test/scene.mjs), which blows the 2.3 m scene up by 1.7x.
// The two vertical edges keep their length when the wall turns, so their mean inverse length gives the depth of the
// LCD center to about 1 %. The direction to the center stays the homography's, which is exact.
function depthFromEdges(quad) {
  const edge = (a, b) => Math.hypot(quad[a][0] - quad[b][0], quad[a][1] - quad[b][1]);
  return (focal * LCD_HEIGHT * (1 / edge(0, 3) + 1 / edge(1, 2))) / 2;
}

function jumped(quad) {
  const width = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const jump = lastQuad && quad.reduce((s, p, i) => s + Math.hypot(p[0] - lastQuad[i][0], p[1] - lastQuad[i][1]), 0) / 4;
  lastQuad = quad;
  return jump === null || jump > SNAP_DISTANCE * width;
}

// Returns false when the video has no new frame since the last call.
function detect(now) {
  if (video.currentTime === lastVideoTime) return false;
  lastVideoTime = video.currentTime;
  if (worldFromCamera) frameRot.copy(worldFromCamera);
  workCtx.drawImage(video, 0, 0, frameW, frameH);
  const gray = toGray(workCtx.getImageData(0, 0, frameW, frameH).data, frameW * frameH);
  const tracking = now - lastSeen < Math.min(hold(), TRACK_MS);
  const hit = detectScreen(gray, frameW, frameH, tracking ? lastHit : null);
  const pose = hit && poseFromQuad(hit.quad, focal, frameW / 2, frameH / 2);
  if (pose) {
    target.fromArray(pose).decompose(targetPos, targetQuat, targetScale);
    targetPos.multiplyScalar(depthFromEdges(hit.quad) / -targetPos.z);
    targetPos.applyQuaternion(frameRot);
    targetQuat.premultiply(frameRot);
    if (worldFromCamera) uprightOnWall(targetQuat);
    if (jumped(hit.quad) || !tracking) {
      pos.copy(targetPos);
      quat.copy(targetQuat);
    } else {
      pos.lerp(targetPos, POSITION_SMOOTHING);
      quat.slerp(targetQuat, ROTATION_SMOOTHING);
    }
    lastSeen = now;
    lastHit = hit;
  }
  cameraFromWorld.copy(frameRot).invert();
  anchor.matrix.compose(viewPos.copy(pos).applyQuaternion(cameraFromWorld), viewQuat.copy(cameraFromWorld).multiply(quat), ONE);
  anchor.matrixWorldNeedsUpdate = true;
  return true;
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Taps and hand grabs share one path: a point in normalized video coordinates. The 3D camera spans exactly the
// video frame, so that point is also the ray's position in normalized device coordinates.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function entryAt(uv) {
  if (!stage.visible) return null;
  raycaster.setFromCamera(ndc.set(uv[0] * 2 - 1, 1 - uv[1] * 2), camera);
  return pick(raycaster);
}

function trigger(e) {
  select(e);
  if (e) ui.showCard(infoFor(e));
  else ui.hideCard();
  ui.hintDone();
}

const v3 = new THREE.Vector3();
function uvOf(object) {
  v3.setFromMatrixPosition(object.matrixWorld).project(camera);
  return v3.z < 1 ? [(v3.x + 1) / 2, (1 - v3.y) / 2] : null;
}

let hands = null;
let fakeHand;
let lastFrame = null;
const frameStats = { n: 0, total: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  if (video.readyState < 2 || !video.videoWidth) return;
  const t0 = performance.now();
  if (video.videoWidth !== videoW || video.videoHeight !== videoH) resize(video.videoWidth, video.videoHeight);
  // The anchor and the hand only change with a new camera frame, so drawing in between would cost GPU time
  // (twice as much on a 60 Hz screen with a 30 fps camera) without showing anything new.
  if (!detect(now)) return;
  const dt = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;

  const seen = now - lastSeen < hold();
  appearStart = seen ? appearStart ?? now : null;
  stage.visible = seen;
  stage.scale.setScalar(seen ? Math.max(easeOutCubic(clamp01((now - appearStart) / APPEAR_MS)), 0.001) : 1);
  updateScene(now / 1000, dt);
  scene.updateMatrixWorld();

  const hand = fakeHand !== undefined ? fakeHand : hands?.update(now) ?? null;
  if (fakeHand?.grab) fakeHand = { ...fakeHand, grab: false };
  const handUv = hand && [hand.x, hand.y];
  const over = handUv ? entryAt(handUv) : null;
  setHover(over);
  if (hand?.grab && over) trigger(over);
  ui.setCursor(handUv, !!hand?.closed, !!over);

  if (now - lastShadow >= SHADOW_MS) {
    renderer.shadowMap.needsUpdate = true;
    lastShadow = now;
  }
  renderer.render(scene, camera);

  ui.placeLabels(labels.map((l) => uvOf(l.marker)), seen);
  const sel = selectedEntry();
  if (sel) {
    // The card keeps clear of the object: its screen radius is half its size over its distance, in video heights.
    const depth = Math.max(v3.setFromMatrixPosition(sel.holder.matrixWorld).length(), 0.1);
    ui.placeCard(uvOf(sel.holder) ?? [0.5, 0.5], (sel.size * sel.holder.scale.x * stage.scale.x * focal) / 2 / depth / frameH);
  }
  ui.setStatus(seen);
  frameStats.n++;
  frameStats.total += performance.now() - t0;
}

addEventListener('pointerdown', (ev) => {
  if ($('start').hidden === false || ev.target.closest('#card, .label')) return;
  const e = entryAt(ui.toVideo(ev.clientX, ev.clientY));
  if (e) trigger(e);
});
ui.onCardClose(() => trigger(null));
ui.initLabels(labels, (id) => trigger(entries.find((e) => e.id === id)));

// Test hooks for test/scene.mjs.
globalThis.__ar = {
  setHand: (h) => { fakeHand = h; },
  frameMs: () => frameStats.total / Math.max(frameStats.n, 1),
  objects: () => entries.map((e) => {
    const [u, v] = uvOf(e.holder) ?? [NaN, NaN];
    const [x, y] = ui.toScreen(u, v);
    return { id: e.id, kind: e.kind, u, v, x, y, shown: e.holder.visible && e.show > 0.9, loaded: !!e.box, missing: e.missing };
  }),
};

loadInfo();
loadScene(ui.setProgress);

function explain(e) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'Die Kamera braucht eine sichere Seite. Öffne sie über https.';
  if (e.name === 'NotAllowedError') return 'Der Kamerazugriff wurde abgelehnt. Erlaube ihn in den Browsereinstellungen und tippe noch einmal auf Start.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'Auf diesem Gerät gibt es keine Rückkamera.';
  return `Die Kamera geht nicht: ${e.message || e.name}`;
}

// On software WebGL (SwiftShader, llvmpipe) one hand inference takes about 200 ms, which halves the frame rate and
// breaks the thermostat tracking, so those devices get taps only.
function softwareGL() {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return /swiftshader|llvmpipe|software/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
}

async function startHands() {
  if (softwareGL()) {
    console.warn('Handerkennung aus: kein Grafikchip, Tippen geht trotzdem.');
    return;
  }
  try {
    const { createHands } = await import('./hands.js');
    hands = await createHands(video);
  } catch (e) {
    console.warn(`Handerkennung nicht verfügbar, Tippen geht trotzdem: ${e.message}`);
  }
}

$('go').addEventListener('click', async () => {
  const button = $('go');
  const error = $('error');
  button.disabled = true;
  error.hidden = true;
  // iOS only grants motion sensors from inside the tap, before anything is awaited.
  const motion = globalThis.DeviceOrientationEvent?.requestPermission?.().catch(() => 'denied');
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    await video.play();
    await motion;
  } catch (e) {
    error.textContent = explain(e);
    error.hidden = false;
    button.disabled = false;
    return;
  }
  $('start').hidden = true;
  $('hud').hidden = false;
  ui.showHint();
  requestAnimationFrame(frame);
  startHands();
});
