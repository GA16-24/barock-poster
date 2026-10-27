import * as THREE from 'three';
import { toGray, detectScreen } from './detect.js';
import { createWallTracker } from './track.js';
import { stage, entries, labels, initStage, loadScene, updateScene, pick, select, setHover, setGaze, selectedEntry } from './scene.js';
import { loadInfo, infoFor } from './info.js';
import * as ui from './ui.js';

// At 1 to 2 m the LCD is only about 35 px wide even at 1280.
const DETECT_LONG_SIDE = 1280;
const FOCAL_PER_LONG_SIDE = 0.75;
const POSITION_SMOOTHING = 0.5;
// Smoothing runs in the gyro's world frame, where the wall never moves, so heavy rotation smoothing adds no lag when the phone turns.
// Without the gyro it would run in camera space and trail every turn, and the wall tracker has smoothed the tilt already.
const ROTATION_SMOOTHING = 0.2;
const SNAP_DISTANCE = 0.3;
// While tracking, a box this many LCD widths wide around the last hit is searched first, a small part of the frame.
const ROI_WIDTHS = 8, ROI_MIN = 240;
// With the gyro the scene stays fixed in the room while the user pans across its 2.3 m; without it a held pose
// would be glued to the screen. The detector only treats the last hit as a live track for TRACK_MS, so a stale
// hit from long ago cannot lower the bar for a look-alike (the card reader) somewhere else.
const HOLD_MS = { gyro: 30000, none: 100 };
const TRACK_MS = 500;
// The entrance clock only runs while the scene shows, so losing the thermostat mid-entrance pauses it. Only a find
// more than REPLAY_MS after the loss starts it over.
const REPLAY_MS = 5000;
// A selection, with its threads and turned heads, ends once its object has been wholly off screen, or the scene lost,
// for SELECTION_GRACE_MS; a sweep of the camera often leaves it for a moment. The card fades sooner, once the object's
// centre has been off screen for CARD_GRACE_MS, so it never explains something the user no longer sees.
const SELECTION_GRACE_MS = 2000;
const CARD_GRACE_MS = 300;

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
// The shown video frame is older than the newest gyro reading (about 100 ms in test/world.mjs), so it gets the
// rotation from when it was captured.
const gyro = [];
const GYRO_HISTORY_MS = 1000;
addEventListener('deviceorientation', (e) => {
  if (e.beta == null) return;
  const rad = THREE.MathUtils.degToRad;
  worldFromCamera = new THREE.Quaternion().setFromEuler(euler.set(rad(e.beta), rad(e.alpha ?? 0), -rad(e.gamma), 'YXZ'))
    .multiply(zUpToYUp)
    .multiply(screenTurn.setFromAxisAngle(Z, -rad(screen.orientation?.angle ?? 0)));
  gyro.push({ t: e.timeStamp, q: worldFromCamera });
  while (gyro[0].t < e.timeStamp - GYRO_HISTORY_MS) gyro.shift();
});
const hold = () => (worldFromCamera ? HOLD_MS.gyro : HOLD_MS.none);

function rotationAt(t, out) {
  const i = gyro.findIndex((s) => s.t >= t);
  if (i <= 0) return out.copy(gyro.at(i).q);
  const a = gyro[i - 1], b = gyro[i];
  return out.slerpQuaternions(a.q, b.q, (t - a.t) / (b.t - a.t));
}

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
const grayOf = (x, y, w, h) => toGray(workCtx.getImageData(x, y, w, h).data, w * h);
const moved = (hit, dx, dy) => hit && { ...hit, quad: hit.quad.map(([x, y]) => [x + dx, y + dy]) };

// The camera image is drawn behind the scene from the frame detect() measured. The live <video> runs ahead of a
// slow frame loop, so a scene drawn over it swam against the wall whenever the phone moved. The video stays in the
// page, covered by the canvas, because it is the image's source.
const cameraImage = new THREE.VideoFrameTexture();
cameraImage.colorSpace = THREE.SRGBColorSpace;
scene.background = cameraImage;

let videoW = 0, videoH = 0, frameW = 0, frameH = 0, focal = 0;
let lastQuad = null;
const targetPos = new THREE.Vector3(), targetQuat = new THREE.Quaternion();
// pos and quat are the smoothed anchor in the world frame; frameRot is the camera rotation when the shown video frame was captured.
const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
const frameRot = new THREE.Quaternion(), cameraFromWorld = new THREE.Quaternion();
const viewPos = new THREE.Vector3(), viewQuat = new THREE.Quaternion();
const wall = createWallTracker();
let lastHit = null;
let lastSeen = -Infinity;
let sceneAge = 0, wasSeen = false, goneAt = -Infinity, lostAt = null, awayAt = null;

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

function jumped(quad) {
  const width = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const jump = lastQuad && quad.reduce((s, p, i) => s + Math.hypot(p[0] - lastQuad[i][0], p[1] - lastQuad[i][1]), 0) / 4;
  lastQuad = quad;
  return jump === null || jump > SNAP_DISTANCE * width;
}

function detectNear(prior) {
  const q = prior.quad, cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const half = Math.max(ROI_MIN, ROI_WIDTHS * Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])) / 2;
  const x0 = Math.max(0, Math.floor(cx - half)), y0 = Math.max(0, Math.floor(cy - half));
  const w = Math.min(frameW, Math.ceil(cx + half)) - x0, h = Math.min(frameH, Math.ceil(cy + half)) - y0;
  return moved(detectScreen(grayOf(x0, y0, w, h), w, h, moved(prior, -x0, -y0)), x0, y0);
}

// frameTime is when the camera frame was taken, to look up the gyro rotation it was seen with.
function detect(now, image, frameTime) {
  if (worldFromCamera) rotationAt(frameTime, frameRot);
  workCtx.drawImage(image, 0, 0, frameW, frameH);
  const tracking = now - lastSeen < Math.min(hold(), TRACK_MS);
  // A fast pan can leave the box, so a miss there still searches the whole frame.
  const hit = (tracking && detectNear(lastHit)) || detectScreen(grayOf(0, 0, frameW, frameH), frameW, frameH, tracking ? lastHit : null);
  if (hit && !tracking) wall.reset();
  if (hit && wall.update(hit.quad, focal, frameW / 2, frameH / 2, targetPos, targetQuat)) {
    targetPos.applyQuaternion(frameRot);
    targetQuat.premultiply(frameRot);
    if (worldFromCamera) uprightOnWall(targetQuat);
    if (jumped(hit.quad) || !tracking) {
      pos.copy(targetPos);
      quat.copy(targetQuat);
    } else {
      pos.lerp(targetPos, POSITION_SMOOTHING);
      quat.slerp(targetQuat, worldFromCamera ? ROTATION_SMOOTHING : 1);
    }
    lastSeen = now;
    lastHit = hit;
  }
  cameraFromWorld.copy(frameRot).invert();
  anchor.matrix.compose(viewPos.copy(pos).applyQuaternion(cameraFromWorld), viewQuat.copy(cameraFromWorld).multiply(quat), ONE);
  anchor.matrixWorldNeedsUpdate = true;
}

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
  lostAt = awayAt = null;
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
// The part of an entry's bounds on screen as [x0, y0, x1, y1] in CSS px, or null when none is. Box edges that cross
// the near plane are cut there, since a corner behind the camera projects to the wrong side.
const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
function screenRect(e) {
  if (!e.box || !e.holder.visible) return null;
  const { min, max } = e.box, near = -camera.near;
  corners.forEach((c, i) => c.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z)
    .applyMatrix4(e.holder.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
  const front = corners.filter((c) => c.z < near);
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
    const a = corners[i], b = corners[i | bit];
    if (!(i & bit) && (a.z < near) !== (b.z < near)) front.push(new THREE.Vector3().lerpVectors(a, b, (near - a.z) / (b.z - a.z)));
  }
  if (!front.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of front) {
    p.applyMatrix4(camera.projectionMatrix);
    const [x, y] = ui.toScreen((p.x + 1) / 2, (1 - p.y) / 2);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  [x0, y0, x1, y1] = [Math.max(x0, 0), Math.max(y0, 0), Math.min(x1, innerWidth), Math.min(y1, innerHeight)];
  return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
}
// How wide `meters` along the wall look at that point, in video heights. Seen from the side the wall is
// foreshortened, and so are the name plates, which keeps them inside their medallions.
const edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3();
function sizeOnScreen(matrixWorld, meters) {
  edgeA.set(-meters / 2, 0, 0).applyMatrix4(matrixWorld).project(camera);
  edgeB.set(meters / 2, 0, 0).applyMatrix4(matrixWorld).project(camera);
  if (edgeA.z >= 1 || edgeB.z >= 1) return 0;
  return Math.hypot((edgeB.x - edgeA.x) * frameW, (edgeB.y - edgeA.y) * frameH) / 2 / frameH;
}

let hands = null;
let fakeHand;
let lastFrame = null;
const frameStats = { n: 0, total: 0 };

// Runs once per camera frame the browser presents. The detector and the background read one snapshot of it: during
// a slow callback the video element itself moves on to newer frames. Chrome on Android stamps camera frames with
// the sensor time and Safari with their arrival from the camera; a canvas stream in desktop Chrome has no capture time.
function frame(now, { captureTime, presentationTime }) {
  video.requestVideoFrameCallback(frame);
  const t0 = performance.now();
  if (video.videoWidth !== videoW || video.videoHeight !== videoH) resize(video.videoWidth, video.videoHeight);
  const image = new VideoFrame(video);
  detect(now, image, captureTime ?? presentationTime);
  cameraImage.setFrame(image);
  const dt = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;

  const seen = now - lastSeen < hold();
  if (!seen && wasSeen) goneAt = now;
  if (seen && !wasSeen && now - goneAt > REPLAY_MS) sceneAge = 0;
  if (seen) sceneAge += dt;
  wasSeen = seen;
  stage.visible = seen;
  updateScene(now / 1000, dt, sceneAge);
  scene.updateMatrixWorld();

  const hand = fakeHand !== undefined ? fakeHand : hands?.update(now) ?? null;
  if (fakeHand?.grab) fakeHand = { ...fakeHand, grab: false };
  const handUv = hand && [hand.x, hand.y];
  const over = handUv ? entryAt(handUv) : null;
  setGaze(handUv ? raycaster.ray : null);
  setHover(over);
  // A fist opens the object under the hand, and the next fist closes it again wherever the hand is.
  if (hand?.grab) {
    if (selectedEntry()) trigger(null);
    else if (over) trigger(over);
  }
  ui.setCursor(handUv, !!hand?.closed, !!over);

  if (now - lastShadow >= SHADOW_MS) {
    renderer.shadowMap.needsUpdate = true;
    lastShadow = now;
  }
  renderer.render(scene, camera);
  // The render uploaded it; an open frame holds one of the camera's few buffers.
  image.close();

  ui.placeLabels(labels.map((l) => ({ uv: uvOf(l.marker), size: sizeOnScreen(l.marker.matrixWorld, l.width), show: l.show })), seen);
  const sel = selectedEntry();
  if (sel) {
    const rect = seen ? screenRect(sel) : null, uv = uvOf(sel.holder);
    lostAt = rect ? null : lostAt ?? now;
    awayAt = seen && uv && ui.onScreen(uv) ? null : awayAt ?? now;
    if (lostAt !== null && now - lostAt > SELECTION_GRACE_MS) trigger(null);
    else {
      const avoid = [rect, ...entries.filter((e) => e.role).map(screenRect)].filter(Boolean);
      ui.placeCard(uv ?? [0.5, 0.5], avoid, awayAt !== null && now - awayAt > CARD_GRACE_MS);
    }
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
  selected: () => selectedEntry()?.id ?? null,
  objects: () => entries.map((e) => {
    const [u, v] = uvOf(e.holder) ?? [NaN, NaN];
    const [x, y] = ui.toScreen(u, v);
    return { id: e.id, kind: e.kind, role: e.role, u, v, x, y, rect: screenRect(e), shown: e.holder.visible && e.show > 0.9, loaded: !!e.box };
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
  video.requestVideoFrameCallback(frame);
  startHands();
});
