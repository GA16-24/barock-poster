import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

// A synthetic phone pans across the thermostat photo while reporting matching gyro readings, so the sword's
// on-screen position can be compared with where it belongs in the room: while tracked, while the LCD is
// covered for 0.4 s, and after the thermostat leaves the frame.
const root = new URL('..', import.meta.url).pathname;
const photo = `${root}test/out/0442-small.jpg`;
mkdirSync(`${root}test/out`, { recursive: true });
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', `${root}test/photos/0442.jpg`, '-vf', 'scale=1080:1440', photo]);
const server = spawn('python3', ['-m', 'http.server', '8127'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const deg = Math.PI / 180;
const yaw = (t) => (t < 2 ? 0 : t < 4 ? (t - 2) * 7.5 : t < 6 ? 15 + (t - 4) * 15 : t < 7 ? 45 : t < 9 ? 45 - (t - 7) * 22.5 : 0) * deg;
const COVER = [2.8, 3.2];
const END = 10;

async function run(gyro) {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`console: ${m.text()}`));
  await page.route('**/sim/0442.jpg', (route) => route.fulfill({ path: photo }));
  await page.addInitScript(({ yawSrc, COVER, gyro }) => {
    const yaw = eval(yawSrc), deg = Math.PI / 180;
    navigator.mediaDevices.getUserMedia = async () => {
      const THREE = await import('/site/vendor/three.module.js');
      const gl = document.createElement('canvas');
      gl.width = 720; gl.height = 1280;
      const renderer = new THREE.WebGLRenderer({ canvas: gl });
      // The streamed frame carries its index as 12 black or white blocks along the bottom edge, so the angle of the frame the app is showing is known.
      const canvas = document.createElement('canvas');
      canvas.width = 720; canvas.height = 1280;
      const ctx = canvas.getContext('2d');
      const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      probe.canvas.width = 720; probe.canvas.height = 1280;
      const angles = [], times = [];
      renderer.setClearColor(0xc9b9a3);
      const scene = new THREE.Scene();
      const map = await new THREE.TextureLoader().loadAsync('/sim/0442.jpg');
      map.colorSpace = THREE.SRGBColorSpace;
      // 0442 at 540x720 has the LCD center at (279, 325) and 2066 px per meter.
      const k = 2066, photo = new THREE.Mesh(new THREE.PlaneGeometry(540 / k, 720 / k), new THREE.MeshBasicMaterial({ map }));
      photo.position.set(-9 / k, -35 / k, -0.5);
      const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.055), new THREE.MeshBasicMaterial({ color: 0xc9b9a3 }));
      cover.position.set(0, 0, -0.499);
      scene.add(photo, cover);
      const cam = new THREE.PerspectiveCamera((2 * Math.atan(640 / 960)) / deg, 720 / 1280, 0.01, 10);
      const start = performance.now();
      globalThis.__samples = [];
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
          probe.drawImage(video, 0, 0);
          const px = probe.getImageData(0, 1268, 480, 1).data;
          let shown = 0;
          for (let b = 0; b < 12; b++) if (px[(b * 40 + 20) * 4] > 128) shown |= 1 << b;
          globalThis.__samples.push({ t: times[shown] ?? t, a: angles[shown] ?? a, lag: index - shown, visible: anchor.children[0].visible, m: [...anchor.matrix.elements] });
        }
        requestAnimationFrame(tick);
      })();
      return canvas.captureStream(30);
    };
  }, { yawSrc: yaw.toString(), COVER, gyro });
  await page.goto('http://localhost:8127/site/index.html');
  await page.click('#go');
  await page.waitForFunction((end) => globalThis.__samples?.at(-1)?.t > end, END, { timeout: 120000, polling: 500 });
  const samples = await page.evaluate(() => globalThis.__samples);
  await page.close();

  // Ground truth: the LCD center sits 0.5 m in front of the starting camera. Project it and the app's anchor with f = 960.
  const rows = samples.map((s) => {
    const gt = [360 + (960 * 0.5 * Math.sin(s.a)) / (0.5 * Math.cos(s.a)), 640];
    const app = [360 + (960 * s.m[12]) / -s.m[14], 640 - (960 * s.m[13]) / -s.m[14]];
    return { ...s, err: Math.hypot(app[0] - gt[0], app[1] - gt[1]), inView: gt[0] > 0 && gt[0] < 720 };
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
  console.log(`  LCD covered 0.4 s: shown ${shownCovered.length}/${covered.length} frames, max error ${max(shownCovered.map((r) => r.err)).toFixed(1)} px`);
  console.log(`  thermostat left the frame at ${leftAt?.toFixed(2)} s; sword held ${out.length ? (out.at(-1).t - leftAt).toFixed(2) : '0.00'} s after, max error ${max(out.map((r) => r.err)).toFixed(1)} px`);
  return [
    p95(tracked.map((r) => r.err)) < 20 || 'tracked sword strays from the thermostat',
    max(shownCovered.map((r) => r.err)) < 30 || 'sword drifts while the LCD is covered',
    max(out.map((r) => r.err)) < 40 || 'sword stays on screen instead of staying in the room',
    rows.at(-1).visible || 'sword not reacquired',
  ].filter((x) => x !== true);
}

let failures = [];
try {
  console.log('gyro:');
  failures.push(...await run(true));
  console.log('no gyro:');
  failures.push(...await run(false));
} finally {
  await browser.close();
  server.kill();
}
for (const f of failures) console.log(`FAIL: ${f}`);
if (failures.length) process.exit(1);
