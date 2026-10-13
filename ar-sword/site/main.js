import * as THREE from 'three';
import { toGray, detectScreen } from './detect.js';
import { poseFromQuad } from './pose.js';
import { buildSword, swordWidth } from './sword.js';

const PIXEL = 2;
// At 1 to 2 m the LCD is only about 35 px wide even at 1280.
const DETECT_LONG_SIDE = 1280;
const FOCAL_PER_LONG_SIDE = 0.75;
const POSITION_SMOOTHING = 0.5;
// Smoothing runs in the gyro's world frame, where the wall never moves, so heavy rotation smoothing adds no lag when the phone turns.
const ROTATION_SMOOTHING = 0.2;
const SNAP_DISTANCE = 0.3;
// With the gyro a lost sword stays fixed in the room for a moment; without it a held pose would be glued to the screen.
const HOLD_MS = { gyro: 500, none: 100 };
const APPEAR_MS = 250;

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('view');
const statusEl = $('status');

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x94b0c2, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-1, 1, 1);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

const anchor = new THREE.Group();
anchor.matrixAutoUpdate = false;
scene.add(anchor);
// test/jitter.mjs samples the anchor pose.
globalThis.__anchor = anchor;

// Model frame (meters): origin at the LCD center, thermostat body right edge at x = 0.043.
const REST = new THREE.Vector3(0.043 + 0.012 + swordWidth / 2, -0.0086, 0.015);
const sword = buildSword(THREE);
sword.position.copy(REST);
sword.visible = false;
anchor.add(sword);

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
  renderer.setSize(Math.round(vw / PIXEL), Math.round(vh / PIXEL), false);
  lastQuad = null;
}

function jumped(quad) {
  const width = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const jump = lastQuad && quad.reduce((s, p, i) => s + Math.hypot(p[0] - lastQuad[i][0], p[1] - lastQuad[i][1]), 0) / 4;
  lastQuad = quad;
  return jump === null || jump > SNAP_DISTANCE * width;
}

function detect(now) {
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  if (worldFromCamera) frameRot.copy(worldFromCamera);
  workCtx.drawImage(video, 0, 0, frameW, frameH);
  const gray = toGray(workCtx.getImageData(0, 0, frameW, frameH).data, frameW * frameH);
  const tracking = now - lastSeen < hold();
  const hit = detectScreen(gray, frameW, frameH, tracking ? lastHit : null);
  const pose = hit && poseFromQuad(hit.quad, focal, frameW / 2, frameH / 2);
  if (pose) {
    target.fromArray(pose).decompose(targetPos, targetQuat, targetScale);
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
}

const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function frame(now) {
  requestAnimationFrame(frame);
  if (video.readyState < 2 || !video.videoWidth) return;
  if (video.videoWidth !== videoW || video.videoHeight !== videoH) resize(video.videoWidth, video.videoHeight);
  detect(now);

  const seen = now - lastSeen < hold();
  appearStart = seen ? appearStart ?? now : null;
  sword.visible = seen;
  sword.scale.setScalar(seen ? Math.max(easeOutBack(clamp01((now - appearStart) / APPEAR_MS)), 0.001) : 1);
  renderer.render(scene, camera);

  statusEl.textContent = seen ? 'SWORD DRAWN' : 'SEARCHING…';
  statusEl.classList.toggle('on', seen);
}

function explain(e) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'The camera needs a secure page. Open this site over https.';
  if (e.name === 'NotAllowedError') return 'Camera access was denied. Allow it in your browser settings and tap start again.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'No rear camera found on this device.';
  return `Camera failed: ${e.message || e.name}`;
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
  statusEl.hidden = false;
  requestAnimationFrame(frame);
});
