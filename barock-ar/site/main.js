import * as THREE from 'three';
import { createPosterTracker } from './poster.js?v=6';
import { stage, entries, labels, initStage, loadScene, updateScene, pick, select, setHover, setGaze, selectedEntry } from './scene.js?v=3';
import { loadInfo, infoFor } from './info.js';
import * as ui from './ui.js';

const DETECT_LONG_SIDE = 1280;
const FOCAL_PER_LONG_SIDE = 0.75;
// Smoothing runs in the gyro's world frame, where the poster never moves, so rotation smoothing adds no lag when the phone turns.
// Without the gyro, continuing hits use their fresh camera-space rotation directly.
const ROTATION_SMOOTHING = 0.2;
const POSITION_SMOOTHING = 0.2;
const DISTANCE_SMOOTHING = 0.2;
// With the gyro the scene stays fixed in the room while the user pans; without it a held pose would be glued to the screen.
const HOLD_MS = { gyro: 30000, none: 500 };
// The entrance clock only runs while the scene shows, so losing the poster mid-entrance pauses it. Only a find
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

// The poster hangs level on a vertical wall, so only its heading comes from the estimated normal.
const normal = new THREE.Vector3(), right = new THREE.Vector3(), basis = new THREE.Matrix4();
function uprightOnWall(q) {
  normal.copy(Z).applyQuaternion(q).setY(0);
  if (normal.lengthSq() < 1e-6) return;
  normal.normalize();
  q.setFromRotationMatrix(basis.makeBasis(right.crossVectors(UP, normal), UP, normal));
}

const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true });

// The camera image is drawn behind the scene from the frame detect() measured. The live <video> runs ahead of a
// slow frame loop, so a scene drawn over it swam against the wall whenever the phone moved. The video stays in the
// page, covered by the canvas, because it is the image's source. iPhones and browsers without usable video-backed
// frames draw the scene over the live video instead.
const directVideo = /iP(?:hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let snapshots = !directVideo && typeof VideoFrame === 'function';
const cameraImage = new THREE.VideoFrameTexture();
cameraImage.colorSpace = THREE.SRGBColorSpace;
if (snapshots) scene.background = cameraImage;
function disableSnapshots(error) {
  snapshots = false;
  scene.background = null;
  console.warn(`Videoframes nicht verfügbar, Kamerabild wird direkt verwendet: ${error.message}`);
}

let videoW = 0, videoH = 0, frameW = 0, frameH = 0, focal = 0;
let poster = null, hasAnchor = false;
const targetPos = new THREE.Vector3(), targetQuat = new THREE.Quaternion();
// pos and quat are the smoothed anchor in the world frame; frameRot is the camera rotation when the shown video frame was captured.
const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
const frameRot = new THREE.Quaternion(), cameraFromWorld = new THREE.Quaternion();
const viewPos = new THREE.Vector3(), viewQuat = new THREE.Quaternion();
let lastSeen = -Infinity;
let sceneAge = 0, wasSeen = false, goneAt = -Infinity, lostAt = null, awayAt = null;

async function resize(vw, vh) {
  poster?.dispose();
  poster = null;
  hasAnchor = false;
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
  const onError = (error) => {
    trackingError = 'ERKENNUNG FEHLER · SEITE NEU LADEN';
    console.error('Bilderkennung:', error);
  };
  poster = await createPosterTracker({ inputWidth: frameW, inputHeight: frameH, focal, onError });
}

// The canvas has the video's aspect and is cropped by object-fit: cover like the video, so it is sized to the
// cropped display size to render at full screen resolution.
function fitCanvas() {
  if (!videoW) return;
  const s = Math.max(innerWidth / videoW, innerHeight / videoH);
  renderer.setSize(Math.round(videoW * s), Math.round(videoH * s), false);
}
addEventListener('resize', fitCanvas);

async function detect(image) {
  workCtx.drawImage(image, 0, 0, frameW, frameH);
  const hit = await poster.update(work);
  if (hit) {
    trackingError = '';
    hit.matrix.decompose(targetPos, targetQuat, ONE);
    targetPos.applyQuaternion(frameRot);
    targetQuat.premultiply(frameRot);
    if (worldFromCamera) uprightOnWall(targetQuat);
    const restart = !hasAnchor || (hit.acquired && performance.now() - lastSeen >= hold());
    hasAnchor = true;
    if (restart) {
      pos.copy(targetPos);
      quat.copy(targetQuat);
    } else {
      if (worldFromCamera) pos.lerp(targetPos, POSITION_SMOOTHING);
      else {
        const distance = THREE.MathUtils.lerp(pos.length(), targetPos.length(), DISTANCE_SMOOTHING);
        pos.copy(targetPos).setLength(distance);
        quat.slerp(targetQuat, 1);
      }
    }
    lastSeen = performance.now();
  }
  cameraFromWorld.copy(frameRot).invert();
  anchor.matrix.compose(viewPos.copy(pos).applyQuaternion(cameraFromWorld), viewQuat.copy(cameraFromWorld).multiply(quat), ONE);
  anchor.matrixWorldNeedsUpdate = true;
  return !!hit;
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
let lastFrame = null, lastFrameTiming = null;
const frameStats = { n: 0, total: 0 };

function queueFrame() {
  if (!directVideo && video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame);
  else requestAnimationFrame((now) => frame(now, { presentationTime: now }));
}

// Runs once per camera frame the browser presents. The tracker and the background read one snapshot of it: during
// a slow callback the video element itself moves on to newer frames. Chrome on Android stamps camera frames with
// the sensor time and Safari with their arrival from the camera; a canvas stream in desktop Chrome has no capture time.
async function frame(_, { captureTime, presentationTime }) {
  const t0 = performance.now();
  const frameTime = captureTime ?? presentationTime;
  if (worldFromCamera) rotationAt(frameTime, frameRot);
  let image = video, seen;
  try {
    if (snapshots) {
      try {
        image = new VideoFrame(video);
      } catch (error) {
        disableSnapshots(error);
      }
    }
    lastFrameTiming = { captureTime, presentationTime, frameTime, videoTimestamp: image === video ? null : image.timestamp, now: t0 };
    if (video.videoWidth !== videoW || video.videoHeight !== videoH) await resize(video.videoWidth, video.videoHeight);
    const fresh = await detect(image);
    if (fresh) startContent();
    const renderNow = performance.now();
    if (snapshots) cameraImage.setFrame(image);
    const dt = lastFrame === null ? 0 : Math.min((renderNow - lastFrame) / 1000, 0.25);
    lastFrame = renderNow;

    seen = fresh || renderNow - lastSeen < hold();
    if (!seen && wasSeen) goneAt = renderNow;
    if (seen && !wasSeen && renderNow - goneAt > REPLAY_MS) sceneAge = 0;
    if (seen) sceneAge += dt;
    wasSeen = seen;
    stage.visible = seen;
    updateScene(renderNow / 1000, dt, sceneAge);
    scene.updateMatrixWorld();

    const hand = fakeHand !== undefined ? fakeHand : hands?.update(renderNow) ?? null;
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

    if (renderNow - lastShadow >= SHADOW_MS) {
      renderer.shadowMap.needsUpdate = true;
      lastShadow = renderNow;
    }
    renderer.render(scene, camera);

    ui.placeLabels(labels.map((l) => ({ uv: uvOf(l.marker), size: sizeOnScreen(l.marker.matrixWorld, l.width), show: l.show })), seen);
    const sel = selectedEntry();
    if (sel) {
      const rect = seen ? screenRect(sel) : null, uv = uvOf(sel.holder);
      lostAt = rect ? null : lostAt ?? renderNow;
      awayAt = seen && uv && ui.onScreen(uv) ? null : awayAt ?? renderNow;
      if (lostAt !== null && renderNow - lostAt > SELECTION_GRACE_MS) trigger(null);
      else {
        const avoid = [rect, ...entries.filter((e) => e.role).map(screenRect)].filter(Boolean);
        ui.placeCard(uv ?? [0.5, 0.5], avoid, awayAt !== null && renderNow - awayAt > CARD_GRACE_MS);
      }
    }
    const searching = renderNow - Math.max(startedAt, lastSeen) > 5000;
    if (!contentStarted) $('loading').textContent = `Kamera ${frameStats.n + 1}`;
    ui.setStatus(seen, trackingError || (searching ? 'PLAKAT SUCHEN' : ''));
    frameStats.n++;
    frameStats.total += performance.now() - t0;
  } catch (error) {
    if (snapshots) disableSnapshots(error);
    else {
      trackingError = 'KAMERABILD FEHLER · SEITE NEU LADEN';
      console.error('Kamerabild:', error);
    }
  } finally {
    // The render uploaded it, and an open frame holds one of the camera's few buffers even when a step threw.
    if (image !== video) image.close();
    queueFrame();
  }
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
  timing: () => lastFrameTiming,
  selected: () => selectedEntry()?.id ?? null,
  objects: () => entries.map((e) => {
    const [u, v] = uvOf(e.holder) ?? [NaN, NaN];
    const [x, y] = ui.toScreen(u, v);
    return { id: e.id, kind: e.kind, role: e.role, u, v, x, y, rect: screenRect(e), shown: e.holder.visible && e.show > 0.9, loaded: !!e.box };
  }),
};

loadInfo();
let startedAt = Infinity, trackingError = '';

function explain(e) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'Die Kamera braucht eine sichere Seite. Öffne sie über https.';
  if (e.name === 'NotAllowedError') return 'Der Kamerazugriff wurde abgelehnt. Erlaube ihn in den Browsereinstellungen und tippe noch einmal auf Start.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'Auf diesem Gerät gibt es keine Rückkamera.';
  return `Die Kamera geht nicht: ${e.message || e.name}`;
}

// On software WebGL (SwiftShader, llvmpipe) one hand inference takes about 200 ms, which halves the frame rate and
// breaks the poster tracking, so those devices get taps only.
function softwareGL() {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return /swiftshader|llvmpipe|software/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
}

async function startHands() {
  ui.setHint('Handerkennung lädt … Du kannst Gegenstände schon antippen.');
  if (softwareGL()) {
    console.warn('Handerkennung aus: kein Grafikchip, Tippen geht trotzdem.');
    ui.setHint('Tippe einen Gegenstand an, um mehr zu erfahren.');
    return;
  }
  try {
    const { createHands } = await import('./hands.js');
    hands = await createHands(video);
    ui.setHint(hands
      ? 'Öffne deine Hand über einem Gegenstand und schließe sie dann zur Faust.'
      : 'Handerkennung ist nicht verfügbar. Tippe Gegenstände an.');
  } catch (e) {
    console.warn(`Handerkennung nicht verfügbar, Tippen geht trotzdem: ${e.message}`);
    ui.setHint('Handerkennung ist nicht verfügbar. Tippe Gegenstände an.');
  }
}

let contentStarted = false;
function startContent() {
  if (contentStarted) return;
  contentStarted = true;
  loadScene(ui.setProgress).then(startHands);
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
    await resize(video.videoWidth, video.videoHeight);
    await motion;
  } catch (e) {
    error.textContent = explain(e);
    error.hidden = false;
    button.disabled = false;
    return;
  }
  $('start').hidden = true;
  $('hud').hidden = false;
  startedAt = performance.now();
  ui.showHint();
  queueFrame();
});
