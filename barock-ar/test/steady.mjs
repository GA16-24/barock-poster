import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { launch } from './browser.mjs';
import { withGpu } from './gpu-lock.mjs';
import { serve } from './serve.mjs';
import { POSTER_WIDTH_M } from '../site/poster.js';

// A still phone two metres from the configured poster, with hand tremor and a slow 5 degree pan. Chrome's fake capture device
// keeps the 30 fps clip running while the app is busy. Each frame carries its index in 12 blocks along the bottom.
// --cpu 1,4 selects CDP throttling rates, --hands allows the hand model to load, and --runs repeats each setting.
// Raw captures go to test/out/steady-a1-*.json. Passing those files reanalyzes them without launching a browser.
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { cpu: { type: 'string', default: '1' }, hands: { type: 'boolean', default: false }, runs: { type: 'string', default: '1' }, 'no-gyro': { type: 'boolean', default: false } },
});
const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
mkdirSync(out, { recursive: true });

const W = 720, H = 1280, F = 960, FPS = 30, SECONDS = 12, DISTANCE = 2;
const POSTER_WIDTH = POSTER_WIDTH_M, POSTER_HEIGHT = POSTER_WIDTH * 1365 / 2048;
const WINDOW = [3, 11.5];
const EXPOSURE = { ms: 10, samples: 4 };
const POINTS = { center: [0, 0, 0], offCenter: [0.28, 0.18, 0] };
const LIMITS = { position: 8, rotation: 1, visible: 0.99, reacquisitionPosition: 12, reacquisitionRotation: 2 };
const SCHEMA = 1;
const cpus = opts.cpu.split(',').map(Number);
const runs = Number(opts.runs);
if (!cpus.length || cpus.some((x) => !Number.isFinite(x) || x < 1)) throw new Error('--cpu needs comma-separated rates of at least 1');
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs needs a positive integer');

// Camera yaw and pitch in radians at clip time t. The pan starts after five seconds and lasts four seconds.
function pose(t) {
  const deg = Math.PI / 180;
  const wave = (parts) => parts.reduce((s, [amp, hz, phase]) => s + amp * Math.sin(2 * Math.PI * hz * t + phase), 0);
  const pan = Math.min(1, Math.max(0, (t - 5) / 4));
  return [(wave([[0.6, 2.3, 0], [0.35, 4.7, 1.3], [0.15, 8.6, 2.1]]) + 5 * pan * pan * (3 - 2 * pan)) * deg,
    wave([[0.5, 1.9, 0.7], [0.3, 5.3, 2.9], [0.15, 7.9, 0.4]]) * deg];
}

const decodeSrc = `(px, stride, offset) => {
  let n = 0;
  for (let b = 0; b < 12; b++) if (px[offset + (b * 40 + 20) * stride] > 128) n |= 1 << b;
  return n;
}`;

async function makeClip(origin) {
  const posterPath = `${root}site/img/poster.png`;
  const key = createHash('sha256').update(JSON.stringify([
    'a1-v1', pose.toString(), W, H, F, FPS, SECONDS, DISTANCE, POSTER_WIDTH, POSTER_HEIGHT, EXPOSURE,
    readFileSync(posterPath),
  ])).digest('hex').slice(0, 12);
  const clip = `${out}/steady-a1-${key}.y4m`;
  if (existsSync(clip)) return clip;
  const browser = await launch();
  const ffmpeg = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', `${FPS}`, '-c:v', 'png', '-i', '-',
    '-vf', 'noise=alls=3:allf=t:all_seed=42,format=yuv420p', '-f', 'yuv4mpegpipe', `${clip}.part`], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => ffmpeg.on('exit', (code) => (code ? fail(new Error(`ffmpeg exited with ${code}`)) : ok())));
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(`clip page error: ${e.message}`));
    await page.route('**/sim/poster.png', (route) => route.fulfill({ path: posterPath }));
    await page.goto(`${origin}/site/credits.html`);
    await page.evaluate(async ({ poseSrc, W, H, F, DISTANCE, POSTER_WIDTH, POSTER_HEIGHT, EXPOSURE }) => {
      const pose = eval(`(${poseSrc})`);
      const THREE = await import('/site/vendor/three.module.js');
      const gl = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
      renderer.setClearColor(0xc9b9a3);
      const map = await new THREE.TextureLoader().loadAsync('/sim/poster.png');
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(POSTER_WIDTH, POSTER_HEIGHT), new THREE.MeshBasicMaterial({ map }));
      poster.position.z = -DISTANCE;
      const scene = new THREE.Scene().add(poster);
      const cam = new THREE.PerspectiveCamera((2 * Math.atan(H / 2 / F) * 180) / Math.PI, W / H, 0.01, 10);
      cam.rotation.order = 'YXZ';
      const ctx = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d');
      globalThis.__frame = (i, fps) => {
        for (let s = 0; s < EXPOSURE.samples; s++) {
          const [yaw, pitch] = pose(i / fps + (s / (EXPOSURE.samples - 1) - 0.5) * EXPOSURE.ms / 1000);
          cam.rotation.set(pitch, yaw, 0);
          renderer.render(scene, cam);
          ctx.globalAlpha = 1 / (s + 1);
          ctx.drawImage(gl, 0, 0);
        }
        ctx.globalAlpha = 1;
        for (let b = 0; b < 12; b++) {
          ctx.fillStyle = (i >> b) & 1 ? '#fff' : '#000';
          ctx.fillRect(b * 40, H - 24, 40, 24);
        }
        return ctx.canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
      };
    }, { poseSrc: pose.toString(), W, H, F, DISTANCE, POSTER_WIDTH, POSTER_HEIGHT, EXPOSURE });
    for (let i = 0; i < FPS * SECONDS; i++) {
      const png = Buffer.from(await page.evaluate(([i, fps]) => __frame(i, fps), [i, FPS]), 'base64');
      if (!ffmpeg.stdin.write(png)) await new Promise((ok) => ffmpeg.stdin.once('drain', ok));
    }
    ffmpeg.stdin.end();
    await done;
  } catch (error) {
    ffmpeg.kill();
    done.catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
  renameSync(`${clip}.part`, clip);
  return clip;
}

// The served app gets temporary timing and pose hooks. Production files stay untouched.
function instrument(src) {
  const splices = [
    ['  workCtx.drawImage(image, 0, 0, frameW, frameH);\n', '', '  __steady.processed(workCtx, lastFrameTiming?.frameTime, frameRot.toArray());\n'],
    ['    const fresh = await detect(image);\n', '    const d0 = performance.now();\n', '    const d1 = performance.now();\n'],
    ['    const hand = fakeHand !== undefined ? fakeHand : hands?.update(renderNow) ?? null;\n', '    const h0 = performance.now();\n', '    const h1 = performance.now();\n'],
    ['    renderer.render(scene, camera);\n', '    const r0 = performance.now();\n',
      '    __steady.rendered(renderNow, [d1 - d0, h1 - h0, performance.now() - r0], anchor.matrix.toArray(), stage.visible, !!hands, renderer.getContext(),\n'
      + '      scene.background?.isTexture ? renderer.properties.get(scene.background).__webglTexture : null);\n'],
    ['  return !!hit;\n', '  __steady.detected(!!hit, hit?.acquired === true);\n', ''],
  ];
  for (const [needle, before, after] of splices) {
    if (!src.includes(needle)) throw new Error(`main.js no longer contains ${needle.trim()}`);
    src = src.replace(needle, before + needle + after);
  }
  return src;
}

function sim({ poseSrc, decodeSrc, W, H, FPS, noGyro }) {
  const pose = eval(`(${poseSrc})`), decode = eval(decodeSrc);
  const deg = 180 / Math.PI;
  const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const S = (globalThis.__steady = { t0: null, shown: [], renders: [], last: null });
  const offsets = [];
  S.processed = (ctx, frameTime, q) => {
    S.last = { i: decode(ctx.getImageData(0, H - 12, 480, 1).data, 4, 0), frameTime, q };
  };
  S.detected = (hit, acquired) => Object.assign(S.last, { hit, acquired });

  // Read the displayed camera frame in the render task, before WebGL can discard its drawing buffer. If scene pixels
  // cover the barcode, read the camera texture that supplied the background instead.
  const row = new Uint8Array(4 * 4096);
  let fb = null;
  const decodeRow = (w) => {
    let n = 0;
    for (let b = 0; b < 12; b++) {
      const bits = [8, 20, 32].map((dx) => {
        const j = 4 * Math.floor(((b * 40 + dx) / W) * w), [r, g, bl, a] = row.subarray(j, j + 4);
        if (a < 250) return null;
        return r > 175 && g > 175 && bl > 175 ? 1 : r < 80 && g < 80 && bl < 80 ? 0 : null;
      });
      if (bits.some((x) => x === null || x !== bits[0])) return null;
      n |= bits[0] << b;
    }
    return n;
  };
  const drawnFrame = (gl, background) => {
    gl.readPixels(0, Math.floor((12 / H) * gl.drawingBufferHeight), gl.drawingBufferWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    const onCanvas = decodeRow(gl.drawingBufferWidth);
    if (onCanvas !== null) return { drawn: onCanvas, drawnFrom: 'canvas' };
    if (!background) return { drawn: null, drawnFrom: null };
    gl.bindFramebuffer(gl.FRAMEBUFFER, (fb ??= gl.createFramebuffer()));
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, background, 0);
    gl.readPixels(0, 12, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { drawn: decodeRow(W), drawnFrom: 'texture' };
  };
  S.rendered = (now, ms, m, visible, hands, gl, background) =>
    S.renders.push({ now, end: performance.now(), ms, m, visible, hands, ...drawnFrame(gl, background), ...S.last });

  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async () => {
    const stream = await getUserMedia({ video: { width: W, height: H, resizeMode: 'none' }, audio: false });
    const video = document.getElementById('video');
    const probe = Object.assign(document.createElement('canvas'), { width: 480, height: 1 }).getContext('2d', { willReadFrequently: true });
    video.requestVideoFrameCallback(function onFrame(now, m) {
      probe.drawImage(video, 0, H - 12, 480, 1, 0, 0, 480, 1);
      const i = decode(probe.getImageData(0, 0, 480, 1).data, 4, 0);
      S.shown.push({ i, cap: m.captureTime, pres: m.presentationTime, now });
      if (offsets.length < FPS) offsets.push(m.captureTime - (i * 1000) / FPS);
      S.t0 = median(offsets);
      video.requestVideoFrameCallback(onFrame);
    });
    return stream;
  };
  if (!noGyro) setInterval(() => {
    const [yaw, pitch] = pose(S.t0 === null ? 0 : (performance.now() - S.t0) / 1000);
    dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: yaw * deg, beta: 90 + pitch * deg, gamma: 0 }));
  }, 1000 / 60);
}

const project = (p) => [W / 2 + (F * p.x) / -p.z, H / 2 - (F * p.y) / -p.z];
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const trueRotation = (i) => {
  const [yaw, pitch] = pose(i / FPS);
  return new THREE.Quaternion().setFromEuler(euler.set(pitch, yaw, 0));
};
const truth = (i, point) => project(new THREE.Vector3(point[0], point[1], point[2] - DISTANCE).applyQuaternion(trueRotation(i).invert()));
const drawn = (m, point) => project(new THREE.Vector3(...point).applyMatrix4(new THREE.Matrix4().fromArray(m)));
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const appRotation = (m) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(m));
const rotationError = (r, i) => appRotation(r.m).angleTo(trueRotation(i).invert()) * 180 / Math.PI;
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b), at = (k) => s[Math.floor(k * (s.length - 1))] ?? NaN;
  return { med: at(0.5), p95: at(0.95), max: at(1) };
};

function reacquisitionJumps(renders) {
  const position = [], rotation = [];
  let previous = null;
  for (const r of renders) {
    if (!r.visible) continue;
    if (r.acquired && previous) {
      position.push(dist(
        drawn(r.m, POINTS.center).map((v, j) => v - truth(r.i, POINTS.center)[j]),
        drawn(previous.m, POINTS.center).map((v, j) => v - truth(previous.i, POINTS.center)[j]),
      ));
      const before = appRotation(previous.m).multiply(trueRotation(previous.i));
      const after = appRotation(r.m).multiply(trueRotation(r.i));
      rotation.push(before.angleTo(after) * 180 / Math.PI);
    }
    previous = r;
  }
  return { count: position.length, position: stats(position), rotation: stats(rotation) };
}

function analyze({ t0, shown, renders }) {
  // Reconstruct 60 Hz compositor ticks. A camera frame appears after its presentation time. An overlay appears with
  // its requestAnimationFrame when the work fits that vsync, otherwise at the first vsync after the work ends.
  const VSYNC = 1000 / 60;
  const first = shown.filter((s) => s.i > 0 && s.cap < t0 + SECONDS * 1000 - VSYNC);
  const n = first.length, mi = first.reduce((s, x) => s + x.i, 0) / n, mp = first.reduce((s, x) => s + x.pres, 0) / n;
  const slope = first.reduce((s, x) => s + (x.i - mi) * (x.pres - mp), 0) / first.reduce((s, x) => s + (x.i - mi) ** 2, 0);
  const presented = new Map(first.map((s) => [s.i, s.pres]));
  const presAt = (i) => presented.get(i) ?? mp + slope * (i - mi);
  const onScreenAt = (r) => r.now + VSYNC * Math.max(0, Math.ceil((r.end - r.now) / VSYNC - 1));
  const clipTime = (ms) => (ms - t0) / 1000;
  const inWindow = renders.filter((r) => clipTime(r.end) > WINDOW[0] && clipTime(r.end) < WINDOW[1]);
  const ticks = [];
  let k = renders.findIndex((r) => clipTime(r.now) >= WINDOW[0]), shownI = 0;
  if (k < 0 || k >= renders.length) throw new Error('capture has no app updates in the measurement window');
  for (let tau = renders[k].now; clipTime(tau) < WINDOW[1]; tau += VSYNC) {
    while (renders[k + 1] && onScreenAt(renders[k + 1]) <= tau + 1) k++;
    while (presAt(shownI + 1) <= tau) shownI++;
    const r = renders[k], i = r.drawn ?? shownI;
    const centerOffset = drawn(r.m, POINTS.center).map((v, j) => v - truth(i, POINTS.center)[j]);
    const offCenterOffset = drawn(r.m, POINTS.offCenter).map((v, j) => v - truth(i, POINTS.offCenter)[j]);
    ticks.push({
      time: clipTime(tau), visible: r.visible, lag: i - r.i,
      position: Math.hypot(...centerOffset), offCenter: Math.hypot(...offCenterOffset), rotation: rotationError(r, i),
      centerOffset, offCenterOffset,
    });
  }
  const seen = ticks.filter((t) => t.visible);
  const positionStep = [], offCenterStep = [];
  for (let j = 1; j < ticks.length; j++) {
    if (!ticks[j].visible || !ticks[j - 1].visible) continue;
    positionStep.push(dist(ticks[j].centerOffset, ticks[j - 1].centerOffset));
    offCenterStep.push(dist(ticks[j].offCenterOffset, ticks[j - 1].offCenterOffset));
  }
  const buckets = new Map();
  for (const tick of ticks) {
    const key = Math.floor(tick.time);
    const bucket = buckets.get(key) ?? { n: 0, hidden: 0 };
    bucket.n++;
    if (!tick.visible) bucket.hidden++;
    buckets.set(key, bucket);
  }
  const gyro = inWindow.map((r) => new THREE.Quaternion(...r.q).angleTo(trueRotation(r.i)) * 180 / Math.PI);
  const intervals = inWindow.slice(1).map((r, j) => r.end - inWindow[j].end);
  const handsAt = renders.find((r) => r.hands);
  const captured = new Map(first.map((s) => [s.i, s.cap]));
  const stamp = stats(inWindow.map((r) => r.frameTime - (captured.get(r.i) ?? t0 + (r.i * 1000) / FPS)));
  return {
    position: stats(seen.map((t) => t.position)), offCenter: stats(seen.map((t) => t.offCenter)), rotation: stats(seen.map((t) => t.rotation)),
    positionStep: stats(positionStep), offCenterStep: stats(offCenterStep),
    visibleFraction: seen.length / Math.max(ticks.length, 1),
    flicker: stats([...buckets.values()].map((b) => b.hidden / b.n)), reacquisition: reacquisitionJumps(inWindow),
    lag: stats(seen.map((t) => t.lag)), gyro: stats(gyro), detect: stats(inWindow.map((r) => r.ms[0])), hands: stats(inWindow.map((r) => r.ms[1])),
    render: stats(inWindow.map((r) => r.ms[2])), interval: stats(intervals), depth: stats(inWindow.filter((r) => r.visible).map((r) => -r.m[14])),
    captureGrid: stats(first.map((s) => Math.abs(s.cap - t0 - (s.i * 1000) / FPS))), stamp,
    drawn: inWindow.filter((r) => r.drawn != null).length / inWindow.length,
    fromCanvas: inWindow.filter((r) => r.drawnFrom === 'canvas').length / inWindow.length,
    drawnMismatch: inWindow.filter((r) => r.drawn != null && r.drawn !== r.i).length,
    handsFrom: handsAt ? clipTime(handsAt.end) : null, ticks: ticks.length, updates: inWindow.length,
  };
}

async function run(clip, origin, cpu) {
  const browser = await launch([
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`,
  ]);
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && console.error(`console: ${m.text()}`));
    await page.route(/\/site\/main\.js(?:\?.*)?$/, async (route) => {
      await route.fulfill({ body: instrument(await (await route.fetch()).text()), contentType: 'text/javascript' });
    });
    if (!opts.hands) await page.route('**/hand_landmarker.task', (route) => route.abort());
    await page.addInitScript(sim, { poseSrc: pose.toString(), decodeSrc, W, H, FPS, noGyro: opts['no-gyro'] });
    await page.goto(`${origin}/site/index.html`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.click('#go');
    await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 120000 });
    await page.waitForFunction((end) => __steady.t0 !== null && performance.now() > __steady.t0 + end, (WINDOW[1] + 0.3) * 1000,
      { timeout: 90000, polling: 200 });
    const data = await page.evaluate(() => ({ t0: __steady.t0, shown: __steady.shown, renders: __steady.renders }));
    data.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
    });
    return {
      schema: SCHEMA, cpu, handsRequested: opts.hands, userAgent: await page.evaluate(() => navigator.userAgent),
      spec: { W, H, F, FPS, SECONDS, DISTANCE, POSTER_WIDTH, POSTER_HEIGHT, WINDOW, EXPOSURE, POINTS }, ...data,
    };
  } finally {
    await browser.close();
  }
}

const f = (x, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : '-');
const triple = (s, digits = 1, scale = 1) => `${f(s.med * scale, digits)}/${f(s.p95 * scale, digits)}/${f(s.max * scale, digits)}`;
const failures = [];
function report(name, data) {
  if (data.schema !== SCHEMA || !Array.isArray(data.shown) || !Array.isArray(data.renders)) {
    throw new Error(`${name} is not a schema ${SCHEMA} A1 steady capture`);
  }
  const r = analyze(data);
  console.log(`${name} on ${data.gpu ?? 'an unrecorded GPU'}`);
  console.log(`  window ${WINDOW[0]}-${WINDOW[1]} s: ${r.ticks} compositor ticks, ${r.updates} app updates`);
  console.log(`  position jitter px ${triple(r.position)}; frame-to-frame step px ${triple(r.positionStep)}`);
  console.log(`  off-center jitter px ${triple(r.offCenter)}; frame-to-frame step px ${triple(r.offCenterStep)}`);
  console.log(`  rotation jitter deg ${triple(r.rotation, 3)}`);
  console.log(`  visible fraction ${(r.visibleFraction * 100).toFixed(3)}%; flicker, hidden fraction per second % ${triple(r.flicker, 3, 100)}`);
  console.log(`  reacquisitions ${r.reacquisition.count}; jump px ${triple(r.reacquisition.position)}; jump deg ${triple(r.reacquisition.rotation, 3)}`);
  console.log(`  anchor depth m ${triple(r.depth, 3)} (truth ${DISTANCE}); shown minus processed frame ${triple(r.lag)}`);
  console.log(`  update ms: detect ${triple(r.detect)}; hands ${triple(r.hands)}; render ${triple(r.render)}; interval ${triple(r.interval)}`);
  console.log(`  capture grid error ms ${triple(r.captureGrid)}; gyro lookup error ms ${triple(r.stamp)}; gyro angle error deg ${triple(r.gyro, 3)}`);
  console.log(`  camera image recovered for ${(r.drawn * 100).toFixed(1)}% of updates, ${(r.fromCanvas * 100).toFixed(1)}% directly from canvas; ${r.drawnMismatch} frame mismatches`);
  if (r.handsFrom !== null) console.log(`  hand model active from ${r.handsFrom.toFixed(1)} s`);
  if (r.position.p95 > LIMITS.position) failures.push(`${name}: position jitter p95 ${f(r.position.p95)} px exceeds ${LIMITS.position}`);
  if (r.rotation.p95 > LIMITS.rotation) failures.push(`${name}: rotation jitter p95 ${f(r.rotation.p95, 3)} deg exceeds ${LIMITS.rotation}`);
  if (r.visibleFraction < LIMITS.visible) failures.push(`${name}: visible fraction ${r.visibleFraction.toFixed(4)} is below ${LIMITS.visible}`);
  if (r.reacquisition.position.p95 > LIMITS.reacquisitionPosition) {
    failures.push(`${name}: reacquisition jump p95 ${f(r.reacquisition.position.p95)} px exceeds ${LIMITS.reacquisitionPosition}`);
  }
  if (r.reacquisition.rotation.p95 > LIMITS.reacquisitionRotation) {
    failures.push(`${name}: reacquisition rotation jump p95 ${f(r.reacquisition.rotation.p95, 3)} deg exceeds ${LIMITS.reacquisitionRotation}`);
  }
  return r;
}

export { analyze, makeClip, pose, stats };
export const A1 = { W, H, F, FPS, SECONDS, DISTANCE, POSTER_WIDTH, POSTER_HEIGHT, WINDOW, EXPOSURE, POINTS };

async function main() {
  console.log('A1 steady benchmark. Triples are median/p95/max. Projected pixels use the 720x1280 camera frame.');
  console.log(`Thresholds: position p95 ${LIMITS.position} px; rotation p95 ${LIMITS.rotation} deg; visible fraction ${LIMITS.visible}; reacquisition p95 ${LIMITS.reacquisitionPosition} px / ${LIMITS.reacquisitionRotation} deg`);
  if (positionals.length) {
    for (const file of positionals) report(file, JSON.parse(readFileSync(file, 'utf8')));
  } else {
    const { origin, close } = await serve(root);
    try {
      await withGpu(async () => {
        const clip = await makeClip(origin);
        console.log(`Clip: ${clip}`);
        for (const cpu of cpus) for (let n = 1; n <= runs; n++) {
          const data = await run(clip, origin, cpu);
          const file = `${out}/steady-a1-cpu${cpu}${opts.hands ? '-hands' : ''}${opts['no-gyro'] ? '-no-gyro' : ''}-${n}.json`;
          writeFileSync(file, JSON.stringify(data));
          report(`cpu ${cpu}x, hands ${opts.hands ? 'allowed' : 'blocked'}, ${opts['no-gyro'] ? 'no gyro, ' : ''}run ${n} (${file})`, data);
        }
      });
    } finally {
      close();
    }
  }
  for (const failure of failures) console.error(`FAIL ${failure}`);
  if (failures.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
