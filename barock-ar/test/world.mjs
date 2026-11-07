import { launch } from './browser.mjs';
import { withGpu } from './gpu-lock.mjs';
import { serve } from './serve.mjs';
import { POSTER_WIDTH_M } from '../site/poster.js';

// A synthetic phone pans across the poster while reporting matching gyro readings. The anchor is compared with the
// poster's known position while tracked, while covered for 0.4 s, and after the poster leaves the frame.
const root = new URL('..', import.meta.url).pathname;
const photo = `${root}site/img/poster.png`;

const deg = Math.PI / 180;
const yaw = (t) => (t < 2 ? 0 : t < 4 ? (t - 2) * 7.5 : t < 6 ? 15 + (t - 4) * 15 : t < 7 ? 45 : t < 9 ? 45 - (t - 7) * 22.5 : 0) * deg;
const COVER = [2.8, 3.2];
const END = 10;
const DISTANCE = 1.4 * POSTER_WIDTH_M / 0.841;

async function run(browser, origin, gyro) {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`console: ${m.text()}`));
  await page.route('**/sim/poster.png', (route) => route.fulfill({ path: photo }));
  await page.addInitScript(({ yawSrc, COVER, gyro, posterWidth, distance }) => {
    const yaw = eval(yawSrc), deg = Math.PI / 180;
    navigator.mediaDevices.getUserMedia = async () => {
      const THREE = await import('/site/vendor/three.module.js');
      const gl = document.createElement('canvas');
      gl.width = 720; gl.height = 1280;
      const renderer = new THREE.WebGLRenderer({ canvas: gl });
      const canvas = document.createElement('canvas');
      canvas.width = 720; canvas.height = 1280;
      const ctx = canvas.getContext('2d');
      const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      probe.canvas.width = 720; probe.canvas.height = 1280;
      const indexOf = (source) => {
        probe.drawImage(source, 0, 1268, 480, 1, 0, 1268, 480, 1);
        const px = probe.getImageData(0, 1268, 480, 1).data;
        let n = 0;
        for (let b = 0; b < 12; b++) if (px[(b * 40 + 20) * 4] > 128) n |= 1 << b;
        return n;
      };
      let drawn;
      const AppFrame = globalThis.VideoFrame;
      globalThis.VideoFrame = class extends AppFrame {
        constructor(source, init) {
          super(source, init);
          if (source === document.getElementById('video')) drawn = indexOf(this);
        }
      };
      const angles = [], times = [];
      renderer.setClearColor(0xc9b9a3);
      const scene = new THREE.Scene();
      const map = await new THREE.TextureLoader().loadAsync('/sim/poster.png');
      map.colorSpace = THREE.SRGBColorSpace;
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(posterWidth, posterWidth * 1365 / 2048), new THREE.MeshBasicMaterial({ map }));
      poster.position.z = -distance;
      const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.88 * posterWidth / 0.841, 0.64 * posterWidth / 0.841), new THREE.MeshBasicMaterial({ color: 0xc9b9a3 }));
      cover.position.set(0, 0, -distance + 0.001);
      scene.add(poster, cover);
      const cam = new THREE.PerspectiveCamera((2 * Math.atan(640 / 960)) / deg, 720 / 1280, 0.01, 10);
      const start = performance.now();
      globalThis.__samples = [];
      globalThis.__simStart = start;
      (function tick() {
        const t = (performance.now() - start) / 1000, a = yaw(t);
        cam.rotation.set(0, a, 0);
        cover.visible = t > COVER[0] && t < COVER[1];
        renderer.render(scene, cam);
        ctx.drawImage(gl, 0, 0);
        const index = angles.push(a) - 1;
        times.push(t);
        for (let b = 0; b < 12; b++) { ctx.fillStyle = (index >> b) & 1 ? '#fff' : '#000'; ctx.fillRect(b * 40, 1256, 40, 24); }
        if (gyro) dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a / deg, beta: 90, gamma: 0 }));
        const anchor = globalThis.__anchor, video = document.getElementById('video');
        if (anchor && video.videoWidth) {
          const shown = drawn ?? indexOf(video);
          globalThis.__samples.push({ t: times[shown] ?? t, a: angles[shown] ?? a, lag: index - shown, visible: anchor.children[0].visible, m: [...anchor.matrix.elements], timing: globalThis.__ar?.timing() });
        }
        requestAnimationFrame(tick);
      })();
      const streamStart = performance.now(), stream = canvas.captureStream(30);
      const video = document.getElementById('video'), request = video.requestVideoFrameCallback.bind(video);
      video.requestVideoFrameCallback = (callback) => request((now, metadata) => {
        const frame = new VideoFrame(video), captureTime = streamStart + frame.timestamp / 1000;
        frame.close();
        callback(now, { ...metadata, captureTime });
      });
      return stream;
    };
  }, { yawSrc: yaw.toString(), COVER, gyro, posterWidth: POSTER_WIDTH_M, distance: DISTANCE });
  await page.goto(`${origin}/site/index.html`);
  await page.click('#go');
  await page.waitForFunction((end) => globalThis.__samples?.at(-1)?.t > end, END, { timeout: 120000, polling: 500 });
  const { samples, simStart } = await page.evaluate(() => ({ samples: globalThis.__samples, simStart: globalThis.__simStart }));
  await page.close();

  const rows = samples.map((s) => {
    const gt = [360 + (960 * DISTANCE * Math.sin(s.a)) / (DISTANCE * Math.cos(s.a)), 640];
    const app = [360 + (960 * s.m[12]) / -s.m[14], 640 - (960 * s.m[13]) / -s.m[14]];
    const halfX = POSTER_WIDTH_M / 2, halfY = halfX * 1365 / 2048;
    const corners = [[-halfX, halfY], [halfX, halfY], [halfX, -halfY], [-halfX, -halfY]].map(([x, y]) => {
      const cx = Math.cos(s.a) * x + DISTANCE * Math.sin(s.a), cz = -Math.sin(s.a) * x - DISTANCE * Math.cos(s.a);
      return [360 + 960 * cx / -cz, 640 - 960 * y / -cz];
    });
    const inView = corners.every(([x, y]) => x > 0 && x < 720 && y > 0 && y < 1280);
    return { ...s, app, gt, err: Math.hypot(app[0] - gt[0], app[1] - gt[1]), inView };
  });
  const p95 = (xs) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(0.95 * (xs.length - 1))] : 0);
  const max = (xs) => Math.max(0, ...xs);
  const tracked = rows.filter((r) => r.visible && r.inView && r.t > 1 && !(r.t > COVER[0] && r.t < COVER[1] + 0.3));
  const covered = rows.filter((r) => r.t > COVER[0] && r.t < COVER[1]);
  const shownCovered = covered.filter((r) => r.visible);
  const leftAt = rows.find((r) => r.t > 4 && !r.inView)?.t;
  const out = rows.filter((r) => r.t > 4 && r.t < 7 && r.visible && !r.inView);
  const lags = rows.map((r) => r.lag).sort((x, y) => x - y);
  console.log(`  video lag behind the sim: median ${lags[lags.length >> 1]} frames`);
  console.log(`  tracked: p95 error ${p95(tracked.map((r) => r.err)).toFixed(1)} px over ${tracked.length} frames`);
  console.log(`  poster covered 0.4 s: shown ${shownCovered.length}/${covered.length} frames, max error ${max(shownCovered.map((r) => r.err)).toFixed(1)} px`);
  const worst = out.reduce((a, b) => a.err > b.err ? a : b, { err: 0 });
  console.log(`  poster left the frame at ${leftAt?.toFixed(2)} s; scene held ${out.length ? (out.at(-1).t - leftAt).toFixed(2) : '0.00'} s after, max error ${max(out.map((r) => r.err)).toFixed(1)} px at t=${worst.t?.toFixed(2)} angle=${(worst.a / deg)?.toFixed(1)} lag=${worst.lag}`);
  if (worst.app) console.log(`  worst held projection: app=${worst.app.map((v) => v.toFixed(1))} truth=${worst.gt.map((v) => v.toFixed(1))} matrix=${worst.m.map((v) => v.toFixed(3))} timing=${JSON.stringify(worst.timing)} sim-frame-time=${(worst.timing?.frameTime - simStart)?.toFixed(1)} shown-time=${(worst.t * 1000).toFixed(1)}`);
  return [
    p95(tracked.map((r) => r.err)) < 20 || 'tracked scene strays from the poster',
    max(shownCovered.map((r) => r.err)) < 30 || 'scene drifts while the poster is covered',
    max(out.map((r) => r.err)) < 70 || 'scene stays on screen instead of staying in the room',
    rows.at(-1).visible || 'poster not reacquired',
  ].filter((x) => x !== true);
}

let failures = [];
await withGpu(async () => {
  const { origin, close } = await serve(root);
  let browser;
  try {
    browser = await launch(['--autoplay-policy=no-user-gesture-required']);
    console.log('gyro:');
    failures.push(...await run(browser, origin, true));
    console.log('no gyro:');
    failures.push(...await run(browser, origin, false));
  } finally {
    await browser?.close();
    close();
  }
});
for (const f of failures) console.log(`FAIL: ${f}`);
if (failures.length) process.exit(1);
