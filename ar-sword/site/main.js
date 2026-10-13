import * as THREE from 'three';
import { toGray, detectScreen } from './detect.js';
import { poseFromQuad } from './pose.js';
import { buildSword, swordWidth } from './sword.js';

const PIXEL = 2;
const DETECT_LONG_SIDE = 480;
const FOCAL_PER_LONG_SIDE = 0.75;
const POSITION_SMOOTHING = 0.5;
// Rotation from a small, nearly frontal quad stays the noisiest part of the pose even after sub-pixel edge fitting.
const ROTATION_SMOOTHING = 0.3;
const SNAP_DISTANCE = 0.3;
const HOLD_MS = 400;
const APPEAR_MS = 250;
const VANISH_MS = 200;

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

const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true });

let videoW = 0, videoH = 0, frameW = 0, frameH = 0, focal = 0;
let lastQuad = null;
const target = new THREE.Matrix4();
const targetPos = new THREE.Vector3(), targetQuat = new THREE.Quaternion(), targetScale = new THREE.Vector3();
const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
let threshold;
let lastSeen = -Infinity;
let lastVideoTime = -1;
let appearStart = null, vanishStart = 0, vanishFrom = 0, scale = 0;

function resize(vw, vh) {
  videoW = vw;
  videoH = vh;
  const k = DETECT_LONG_SIDE / Math.max(vw, vh);
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
  workCtx.drawImage(video, 0, 0, frameW, frameH);
  const gray = toGray(workCtx.getImageData(0, 0, frameW, frameH).data, frameW * frameH);
  const hit = detectScreen(gray, frameW, frameH, threshold);
  threshold = hit?.threshold;
  if (!hit) return;
  const pose = poseFromQuad(hit.quad, focal, frameW / 2, frameH / 2);
  if (!pose) return;
  target.fromArray(pose).decompose(targetPos, targetQuat, targetScale);
  if (jumped(hit.quad) || now - lastSeen > HOLD_MS) {
    pos.copy(targetPos);
    quat.copy(targetQuat);
  } else {
    pos.lerp(targetPos, POSITION_SMOOTHING);
    quat.slerp(targetQuat, ROTATION_SMOOTHING);
  }
  anchor.matrix.compose(pos, quat, ONE);
  anchor.matrixWorldNeedsUpdate = true;
  lastSeen = now;
}

const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function updateScale(now, seen) {
  if (seen) {
    appearStart ??= now;
    scale = easeOutBack(clamp01((now - appearStart) / APPEAR_MS));
  } else {
    if (appearStart !== null) {
      appearStart = null;
      vanishStart = now;
      vanishFrom = scale;
    }
    scale = vanishFrom * (1 - clamp01((now - vanishStart) / VANISH_MS));
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (video.readyState < 2 || !video.videoWidth) return;
  if (video.videoWidth !== videoW || video.videoHeight !== videoH) resize(video.videoWidth, video.videoHeight);
  detect(now);

  const seen = now - lastSeen < HOLD_MS;
  updateScale(now, seen);
  const t = now / 1000;
  sword.visible = scale > 0.001;
  sword.scale.setScalar(Math.max(scale, 0.001));
  sword.position.y = REST.y + 0.004 * Math.sin((t * Math.PI * 2) / 2);
  sword.rotation.y = THREE.MathUtils.degToRad(15) * Math.sin((t * Math.PI * 2) / 3);
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
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    await video.play();
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
