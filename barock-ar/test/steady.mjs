import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import * as THREE from 'three';
import { launch } from './browser.mjs';
import { withGpu } from './gpu-lock.mjs';
import { serve } from './serve.mjs';

// A phone held still on the thermostat from 2 m, with hand tremor and a slow 5° pan, measured as the user sees it:
// how far the drawn LCD center (a) and a point 0.15 m right and 0.1 m up of it (b) sit from where they belong in the
// camera frame on screen at that moment. The camera is Chrome's fake capture device playing a rendered clip, so frames
// keep coming at 30 fps while the app's main thread is busy, as on a phone; each frame carries its index as 12 blocks
// along the bottom edge. --cpu 1,4 runs once per CDP CPU throttling rate, --hands loads the hand model (it is blocked
// otherwise; the clip has no hand, but its inference costs loop time), --runs repeats each setting. Each run's raw
// samples go to test/out/steady-*.json; passing such files instead re-analyzes them without a browser. A run fails
// when (a) is off by more than MAX_P95 px at the 95th percentile or the screen shows a newer camera frame than the
// one the anchor was measured in for most of the time.
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { cpu: { type: 'string', default: '1' }, hands: { type: 'boolean', default: false }, runs: { type: 'string', default: '1' } },
});
const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
mkdirSync(out, { recursive: true });

const W = 720, H = 1280, F = 960, FPS = 30, SECONDS = 12, DISTANCE = 2;
const WINDOW = [3, 11.5];
// 4 renders over 10 ms per frame blur the motion like a camera's exposure.
const EXPOSURE = { ms: 10, samples: 4 };
const POINTS = { a: [0, 0, 0], b: [0.15, 0.1, 0] };
const MAX_P95 = 8;

// Camera yaw (left positive) and pitch (up positive) in radians at clip time t.
function pose(t) {
  const deg = Math.PI / 180;
  const wave = (parts) => parts.reduce((s, [amp, hz, phase]) => s + amp * Math.sin(2 * Math.PI * hz * t + phase), 0);
  const pan = Math.min(1, Math.max(0, (t - 5) / 4));
  return [(wave([[0.6, 2.3, 0], [0.35, 4.7, 1.3], [0.15, 8.6, 2.1]]) + 5 * (pan * pan * (3 - 2 * pan))) * deg,
    wave([[0.5, 1.9, 0.7], [0.3, 5.3, 2.9], [0.15, 7.9, 0.4]]) * deg];
}

const decodeSrc = `(px, stride, offset) => {
  let n = 0;
  for (let b = 0; b < 12; b++) if (px[offset + (b * 40 + 20) * stride] > 128) n |= 1 << b;
  return n;
}`;

async function makeClip(origin) {
  const key = createHash('sha1').update(JSON.stringify([pose.toString(), W, H, F, FPS, SECONDS, DISTANCE, EXPOSURE])).digest('hex').slice(0, 10);
  const clip = `${out}/steady-${key}.y4m`;
  if (existsSync(clip)) return clip;
  const photo = `${out}/0442-small.jpg`;
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', `${root}test/photos/0442.jpg`, '-vf', 'scale=1080:1440', photo]);
  const browser = await launch();
  const ffmpeg = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', `${FPS}`, '-c:v', 'png', '-i', '-',
    '-vf', 'noise=alls=3:allf=t,format=yuv420p', '-f', 'yuv4mpegpipe', `${clip}.part`], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => ffmpeg.on('exit', (code) => (code ? fail(new Error(`ffmpeg exited with ${code}`)) : ok())));
  try {
    const page = await browser.newPage();
    await page.route('**/sim/0442.jpg', (route) => route.fulfill({ path: photo }));
    await page.goto(`${origin}/site/credits.html`);
    await page.evaluate(async ({ poseSrc, W, H, F, DISTANCE, EXPOSURE }) => {
      const pose = eval(`(${poseSrc})`);
      const THREE = await import('/site/vendor/three.module.js');
      const gl = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
      renderer.setClearColor(0xc9b9a3);
      const map = await new THREE.TextureLoader().loadAsync('/sim/0442.jpg');
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      // 0442 at 540x720 has the LCD center at (279, 325) and 2066 px per meter.
      const k = 2066, photo = new THREE.Mesh(new THREE.PlaneGeometry(540 / k, 720 / k), new THREE.MeshBasicMaterial({ map }));
      photo.position.set(-9 / k, -35 / k, -DISTANCE);
      const scene = new THREE.Scene().add(photo);
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
        for (let b = 0; b < 12; b++) { ctx.fillStyle = (i >> b) & 1 ? '#fff' : '#000'; ctx.fillRect(b * 40, H - 24, 40, 24); }
        return ctx.canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
      };
    }, { poseSrc: pose.toString(), W, H, F, DISTANCE, EXPOSURE });
    for (let i = 0; i < FPS * SECONDS; i++) {
      const png = Buffer.from(await page.evaluate(([i, fps]) => __frame(i, fps), [i, FPS]), 'base64');
      if (!ffmpeg.stdin.write(png)) await new Promise((ok) => ffmpeg.stdin.once('drain', ok));
    }
    ffmpeg.stdin.end();
    await done;
  } finally {
    await browser.close();
  }
  renameSync(`${clip}.part`, clip);
  return clip;
}

// Timing and pose hooks spliced into the app's main.js as served; the app itself stays untouched.
function instrument(src) {
  const splices = [
    [/^ *workCtx\.drawImage\(.*\n/m, '', '  __steady.processed(workCtx, frameTime, frameRot.toArray());\n'],
    [/^ *(?:if \(!)?detect\(.*\n/m, '  const d0 = performance.now();\n', '  const d1 = performance.now();\n'],
    ['  const hand = fakeHand !== undefined ? fakeHand : hands?.update(now) ?? null;\n', '  const h0 = performance.now();\n', '  const h1 = performance.now();\n'],
    ['  renderer.render(scene, camera);\n', '  const r0 = performance.now();\n',
      '  __steady.rendered(now, [d1 - d0, h1 - h0, performance.now() - r0], anchor.matrix.toArray(), stage.visible, !!hands, renderer.getContext(),\n'
      + '    scene.background?.isTexture ? renderer.properties.get(scene.background).__webglTexture : null);\n'],
  ];
  for (const [needle, before, after] of splices) {
    const line = typeof needle === 'string' ? (src.includes(needle) ? needle : null) : src.match(needle)?.[0];
    if (!line) throw new Error(`main.js no longer contains ${needle}`);
    src = src.replace(line, before + line + after);
  }
  return src;
}

function sim({ poseSrc, decodeSrc, W, H, FPS }) {
  const pose = eval(`(${poseSrc})`), decode = eval(decodeSrc);
  const deg = 180 / Math.PI;
  const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const S = (globalThis.__steady = { t0: null, shown: [], renders: [], last: null });
  const offsets = [];
  S.processed = (ctx, frameTime, q) => {
    S.last = { i: decode(ctx.getImageData(0, H - 12, 480, 1).data, 4, 0), frameTime, q };
  };
  // Which camera frame the canvas shows, read in the task that drew it, so no preserved drawing buffer is needed:
  // from the canvas's own pixels, or where the scene covers the barcode, from the texture its background was drawn
  // from. null when the canvas has no camera image (a transparent overlay over the video).
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
    // A phone held upright streams portrait frames; the app's landscape request would make Chrome crop the clip.
    const stream = await getUserMedia({ video: { width: W, height: H, resizeMode: 'none' }, audio: false });
    const video = document.getElementById('video');
    const probe = Object.assign(document.createElement('canvas'), { width: 480, height: 1 }).getContext('2d', { willReadFrequently: true });
    video.requestVideoFrameCallback(function onFrame(now, m) {
      probe.drawImage(video, 0, H - 12, 480, 1, 0, 0, 480, 1);
      const i = decode(probe.getImageData(0, 0, 480, 1).data, 4, 0);
      S.shown.push({ i, cap: m.captureTime, pres: m.presentationTime, now });
      // The first second fixes the clip's start; later the clip loops and its indices start over.
      if (offsets.length < FPS) offsets.push(m.captureTime - (i * 1000) / FPS);
      S.t0 = median(offsets);
      video.requestVideoFrameCallback(onFrame);
    });
    return stream;
  };
  // A 60 Hz gyro reporting the clip's pose at the time of the event; frame i shows the pose at i / FPS.
  setInterval(() => {
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
// Where a point of the anchor's frame belongs on screen in frame i: the LCD center is DISTANCE in front of the
// starting camera on a wall facing it.
function truth(i, [x, y, z]) {
  return project(new THREE.Vector3(x, y, z - DISTANCE).applyQuaternion(trueRotation(i).invert()));
}
const drawn = (m, p) => project(new THREE.Vector3(...p).applyMatrix4(new THREE.Matrix4().fromArray(m)));
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b), at = (k) => s[Math.floor(k * (s.length - 1))] ?? NaN;
  return { med: at(0.5), p95: at(0.95), max: at(1) };
};

function analyze({ t0, shown, renders }) {
  // The compositor starts a frame every vsync. It shows a camera frame from the first vsync after its presentation
  // time, and the overlay drawn in a requestAnimationFrame from that callback's vsync if the work ended within one
  // vsync, else from the first vsync after it ended. Camera frames the main thread never saw are placed on a line
  // fitted to those it saw.
  const VSYNC = 1000 / 60;
  const first = shown.filter((s) => s.i > 0 && s.cap < t0 + SECONDS * 1000 - VSYNC);
  const n = first.length, mi = first.reduce((s, x) => s + x.i, 0) / n, mp = first.reduce((s, x) => s + x.pres, 0) / n;
  const slope = first.reduce((s, x) => s + (x.i - mi) * (x.pres - mp), 0) / first.reduce((s, x) => s + (x.i - mi) ** 2, 0);
  const presented = new Map(first.map((s) => [s.i, s.pres]));
  const presAt = (i) => presented.get(i) ?? mp + slope * (i - mi);
  const onScreenAt = (r) => r.now + VSYNC * Math.max(0, Math.ceil((r.end - r.now) / VSYNC - 1));
  const jitter = stats(first.map((s) => Math.abs(s.cap - t0 - (s.i * 1000) / FPS)));
  const clipTime = (ms) => (ms - t0) / 1000;
  const inWindow = renders.filter((r) => clipTime(r.end) > WINDOW[0] && clipTime(r.end) < WINDOW[1]);
  const ticks = [];
  let k = renders.findIndex((r) => clipTime(r.now) >= WINDOW[0]), shownI = 0;
  for (let tau = renders[k].now; clipTime(tau) < WINDOW[1]; tau += VSYNC) {
    while (renders[k + 1] && onScreenAt(renders[k + 1]) <= tau + 1) k++;
    while (presAt(shownI + 1) <= tau) shownI++;
    const r = renders[k];
    const i = r.drawn ?? shownI;
    ticks.push({
      visible: r.visible, lag: i - r.i,
      a: dist(drawn(r.m, POINTS.a), truth(i, POINTS.a)), b: dist(drawn(r.m, POINTS.b), truth(i, POINTS.b)),
      aSync: dist(drawn(r.m, POINTS.a), truth(r.i, POINTS.a)), bSync: dist(drawn(r.m, POINTS.b), truth(r.i, POINTS.b)),
      offB: drawn(r.m, POINTS.b).map((v, j) => v - truth(i, POINTS.b)[j]),
    });
  }
  const seen = ticks.filter((t) => t.visible);
  const shake = [];
  for (let j = 1; j < ticks.length; j++) if (ticks[j].visible && ticks[j - 1].visible) shake.push(dist(ticks[j].offB, ticks[j - 1].offB));
  const gyro = inWindow.map((r) => F * new THREE.Quaternion(...r.q).angleTo(trueRotation(r.i)));
  const intervals = inWindow.slice(1).map((r, j) => r.end - inWindow[j].end);
  const handsAt = renders.find((r) => r.hands);
  const captured = new Map(first.map((s) => [s.i, s.cap]));
  const stamp = stats(inWindow.map((r) => r.frameTime - (captured.get(r.i) ?? t0 + (r.i * 1000) / FPS)));
  return {
    tracked: seen.length / Math.max(ticks.length, 1),
    a: stats(seen.map((t) => t.a)), b: stats(seen.map((t) => t.b)),
    aSync: stats(seen.map((t) => t.aSync)), bSync: stats(seen.map((t) => t.bSync)),
    shake: stats(shake), lag: stats(seen.map((t) => t.lag)), gyro: stats(gyro),
    detect: stats(inWindow.map((r) => r.ms[0])), hands: stats(inWindow.map((r) => r.ms[1])), render: stats(inWindow.map((r) => r.ms[2])),
    interval: stats(intervals), depth: stats(inWindow.filter((r) => r.visible).map((r) => -r.m[14])), jitter,
    stamp, drawn: inWindow.filter((r) => r.drawn != null).length / inWindow.length,
    fromCanvas: inWindow.filter((r) => r.drawnFrom === 'canvas').length / inWindow.length,
    drawnMismatch: inWindow.filter((r) => r.drawn != null && r.drawn !== r.i).length, handsFrom: handsAt ? clipTime(handsAt.end) : null,
  };
}

async function run(clip, origin, cpu) {
  const browser = await launch([
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`,
  ]);
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && console.log(`console: ${m.text()}`));
    await page.route('**/site/main.js', async (route) => {
      route.fulfill({ body: instrument(await (await route.fetch()).text()), contentType: 'text/javascript' });
    });
    if (!opts.hands) await page.route('**/hand_landmarker.task', (route) => route.abort());
    await page.addInitScript(sim, { poseSrc: pose.toString(), decodeSrc, W, H, FPS });
    await page.goto(`${origin}/site/index.html`);
    await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 120000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.click('#go');
    await page.waitForFunction((end) => __steady.t0 !== null && performance.now() > __steady.t0 + end, (WINDOW[1] + 0.3) * 1000,
      { timeout: 60000, polling: 200 });
    const data = await page.evaluate(() => ({ t0: __steady.t0, shown: __steady.shown, renders: __steady.renders }));
    data.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
    });
    return data;
  } finally {
    await browser.close();
  }
}

const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const triple = (s) => `${f(s.med)}/${f(s.p95)}/${f(s.max)}`;
const failures = [];
function report(name, data) {
  const r = analyze(data);
  console.log(`${name} on ${data.gpu ?? 'an unrecorded GPU'}`);
  console.log(`  tracked ${(r.tracked * 100).toFixed(0)}% of the window${r.handsFrom === null ? '' : `, hands from ${r.handsFrom.toFixed(1)} s`}`);
  console.log(`  on screen: (a) ${triple(r.a)}  (b) ${triple(r.b)}  shake of (b) ${triple(r.shake)}`);
  console.log(`  against the frame the app processed: (a) ${triple(r.aSync)}  (b) ${triple(r.bSync)}  gyro rotation ${triple(r.gyro)}`);
  console.log(`  gyro looked up at the capture time ${f(r.stamp.med)} ms (median, p95 ${f(r.stamp.p95)}, max ${f(r.stamp.max)})`);
  console.log(`  shown minus processed frame ${triple(r.lag)}; overlay updates every ${triple(r.interval)} ms`);
  console.log(`  ms per update: detect ${triple(r.detect)}  hands ${triple(r.hands)}  render ${triple(r.render)}`);
  console.log(`  canvas shows the camera image in ${(r.drawn * 100).toFixed(0)}% of updates (barcode visible on the canvas in `
    + `${(r.fromCanvas * 100).toFixed(0)}%, else read from the background texture), ${r.drawnMismatch} of them not the processed frame`);
  console.log(`  anchor depth ${r.depth.med.toFixed(3)} m (truth ${DISTANCE}); capture time off the 30 fps grid ${triple(r.jitter)} ms`);
  if (r.a.p95 > MAX_P95) failures.push(`${name}: (a) p95 ${f(r.a.p95)} px is over ${MAX_P95}`);
  if (r.lag.med > 0) failures.push(`${name}: the screen shows a camera frame ${r.lag.med} newer than the anchor's at the median`);
}

console.log('px in the 720x1280 frame as median/p95/max; (a) LCD center, (b) 0.15 m right, 0.1 m up');
if (positionals.length) {
  for (const file of positionals) report(file, JSON.parse(readFileSync(file, 'utf8')));
} else {
  const { origin, close } = await serve(root);
  try {
    const clip = await makeClip(origin);
    await withGpu(async () => {
      for (const cpu of opts.cpu.split(',').map(Number)) for (let n = 1; n <= +opts.runs; n++) {
        const data = await run(clip, origin, cpu);
        const file = `${out}/steady-cpu${cpu}${opts.hands ? '-hands' : ''}-${n}.json`;
        writeFileSync(file, JSON.stringify(data));
        report(`cpu ${cpu}x, hands ${opts.hands ? 'loaded' : 'blocked'}, run ${n} (${file})`, data);
      }
    });
  } finally {
    close();
  }
}
for (const failure of failures) console.log(`FAIL ${failure}`);
if (failures.length) process.exit(1);
