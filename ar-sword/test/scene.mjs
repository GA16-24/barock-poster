import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { ITEMS, AUTHORS, ZONES } from '../site/catalog.js';

// A synthetic room: a plain wall with the thermostat photo at real scale, seen by a phone 1.8 m away that pans
// to the center, the left (Der Adel) and the right (Das Volk) while reporting matching gyro readings.
const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out/scene`;
mkdirSync(out, { recursive: true });
const photo = `${root}test/out/0442-small.jpg`;
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', `${root}test/photos/0442.jpg`, '-vf', 'scale=1080:1440', photo]);

const texts = JSON.parse(readFileSync(`${root}site/data/texts.json`, 'utf8'));

const onDisk = (p) => existsSync(`${root}site/${p}`);
const zoneOf = (id) => ITEMS.find((i) => i.id === id)?.zone ?? 'autoren';
const expected = [
  ...ITEMS.filter((i) => onDisk(i.model)).map((i) => i.id),
  ...AUTHORS.filter((a) => onDisk(a.head)).map((a) => a.id),
  ...AUTHORS.filter((a) => onDisk(a.map)).map((a) => `${a.id}-ort`),
  ...AUTHORS.map((a) => `${a.id}-werk`),
];
console.log(`models on disk: ${expected.length - AUTHORS.length} of ${ITEMS.length + 2 * AUTHORS.length}, plus ${AUTHORS.length} procedural books`);

const DISTANCE = 1.8;
const PAN = { center: 0, left: Math.atan(ZONES.adel.x / -DISTANCE), right: Math.atan(ZONES.volk.x / -DISTANCE) };

const server = spawn('python3', ['-m', 'http.server', '8135', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
// The simulated pan advances once per rendered frame, and software rendering of all models is too slow for it,
// so on macOS the test draws with the real GPU, which needs a visible window.
const gpu = process.platform === 'darwin';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !gpu,
  args: [
    ...(gpu ? ['--use-angle=metal', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.route('**/sim/0442.jpg', (route) => route.fulfill({ path: photo }));

  await page.addInitScript(({ DISTANCE }) => {
    globalThis.__yaw = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const THREE = await import('/site/vendor/three.module.js');
      const canvas = document.createElement('canvas');
      canvas.width = 720; canvas.height = 1280;
      const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0xc9b9a3);
      const scene = new THREE.Scene();
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshBasicMaterial({ color: 0xc9b9a3 }));
      wall.position.z = -DISTANCE - 0.001;
      const map = await new THREE.TextureLoader().loadAsync('/sim/0442.jpg');
      map.colorSpace = THREE.SRGBColorSpace;
      // The photo was shot close and slightly oblique. Shrunk onto a wall 1.8 m away, its baked-in perspective would
      // read as a 20 degree turn, so the photo is rectified: every vertex of a fine grid takes its texture coordinate
      // from the LCD's homography, which puts the LCD square to the camera at the origin at its real 6.1 x 4.5 cm.
      const { toGray, detectScreen } = await import('/site/detect.js');
      const { homography } = await import('/site/pose.js');
      const img = map.image, pc = document.createElement('canvas');
      pc.width = img.width; pc.height = img.height;
      const px = pc.getContext('2d');
      px.drawImage(img, 0, 0);
      const H = homography(detectScreen(toGray(px.getImageData(0, 0, pc.width, pc.height).data, pc.width * pc.height), pc.width, pc.height, null).quad);
      const grid = new THREE.PlaneGeometry(0.24, 0.31, 48, 48);
      grid.translate(0, -0.015, 0);
      const pos = grid.attributes.position, uv = grid.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const X = pos.getX(i), Y = pos.getY(i), w = H[2][0] * X + H[2][1] * Y + H[2][2];
        uv.setXY(i, (H[0][0] * X + H[0][1] * Y + H[0][2]) / w / img.width, 1 - (H[1][0] * X + H[1][1] * Y + H[1][2]) / w / img.height);
      }
      const thermostat = new THREE.Mesh(grid, new THREE.MeshBasicMaterial({ map }));
      thermostat.position.z = -DISTANCE;
      scene.add(wall, thermostat);
      const cam = new THREE.PerspectiveCamera(2 * Math.atan(640 / 960) * 180 / Math.PI, 720 / 1280, 0.01, 10);
      let yaw = 0, last = performance.now();
      (function tick() {
        // The app pairs each video frame with the newest gyro reading, and the video runs a few ticks behind the sim,
        // so the pan is limited per tick as well as per second to keep that mismatch small on a slow software renderer.
        const now = performance.now(), step = Math.min(0.35 * (now - last) / 1000, 0.007);
        last = now;
        yaw += Math.max(-step, Math.min(step, globalThis.__yaw - yaw));
        globalThis.__simYaw = yaw;
        cam.rotation.set(0, yaw, 0);
        renderer.render(scene, cam);
        dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: yaw * 180 / Math.PI, beta: 90, gamma: 0 }));
        requestAnimationFrame(tick);
      })();
      return canvas.captureStream(30);
    };
  }, { DISTANCE });

  await page.goto('http://localhost:8135/site/index.html');
  await page.screenshot({ path: `${out}/start.png` });
  await page.click('#go');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'GEFUNDEN', null, { timeout: 20000 });
  check(true, 'thermostat detected');
  await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 60000 });
  await page.waitForFunction((ids) => ids.every((id) => globalThis.__ar.objects().find((o) => o.id === id)?.loaded), expected, { timeout: 60000 });
  check(true, `all ${expected.length} expected objects loaded`);

  const panTo = async (name) => {
    await page.evaluate((y) => { globalThis.__yaw = y; }, PAN[name]);
    await page.waitForFunction((y) => Math.abs(globalThis.__simYaw - y) < 1e-3, PAN[name], { timeout: 90000 });
    await page.waitForTimeout(1500);
  };

  const active = AUTHORS[0].id;
  const inactive = (id) => AUTHORS.some((a) => a.id !== active && (id === `${a.id}-ort` || id === `${a.id}-werk`));
  for (const name of ['center', 'left', 'right']) {
    await panTo(name);
    const zone = { center: 'autoren', left: 'adel', right: 'volk' }[name];
    const mine = expected.filter((id) => zoneOf(id) === zone && !inactive(id));
    await page.waitForFunction((mine) => mine.every((id) => globalThis.__ar.objects().find((o) => o.id === id).shown), mine, { timeout: 20000 });
    const objects = (await page.evaluate(() => globalThis.__ar.objects())).filter((o) => mine.includes(o.id));
    const outside = objects.filter((o) => !(o.x > 0 && o.x < 390 && o.y > 0 && o.y < 844));
    await page.screenshot({ path: `${out}/${name}.png` });
    check(objects.length > 0 && outside.length === 0, `${name}: ${objects.length - outside.length} of ${objects.length} objects in view${outside.length ? `, outside: ${outside.map((o) => `${o.id}@${o.x.toFixed(0)},${o.y.toFixed(0)}`).join(' ')}` : ''}`);
    check(await page.textContent('#status') === 'GEFUNDEN', `${name}: scene still shown`);
  }

  await panTo('center');
  await page.waitForTimeout(1000);
  const shown = (await page.evaluate(() => globalThis.__ar.objects())).filter((o) => o.shown && o.loaded && o.x > 40 && o.x < 350 && o.y > 120 && o.y < 700);
  const pickFor = (kinds) => shown.find((o) => kinds.includes(o.kind)) ?? shown[0];
  const title = () => page.textContent('#card h2');

  const tapped = pickFor(['item', 'book']);
  await page.mouse.click(tapped.x, tapped.y);
  await page.waitForTimeout(1200);
  check(await title() === texts[tapped.id].title, `tap on ${tapped.id} shows "${await title()}"`);
  await page.screenshot({ path: `${out}/card-tap-${tapped.id}.png` });
  await page.click('#card .close');
  await page.waitForSelector('#card', { state: 'hidden', timeout: 1000 }).catch(() => {});
  check(await page.isHidden('#card'), 'close button hides the card');

  const grabbed = pickFor(['head', 'map']);
  const hand = { x: grabbed.u, y: grabbed.v, closed: false, grab: false, release: false };
  await page.evaluate((h) => globalThis.__ar.setHand(h), hand);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/hand-hover-${grabbed.id}.png` });
  check(await page.isVisible('#cursor.over'), 'hand cursor shows over an object');
  await page.evaluate((h) => globalThis.__ar.setHand({ ...h, closed: true, grab: true }), hand);
  await page.waitForTimeout(1500);
  check(await title() === texts[grabbed.id].title, `hand grab on ${grabbed.id} shows "${await title()}"`);
  await page.screenshot({ path: `${out}/card-hand-${grabbed.id}.png` });
  await page.evaluate(() => globalThis.__ar.setHand(null));

  await page.click('#card .close');
  const other = AUTHORS[1];
  await page.click(`.label.name >> text=${other.name.split(' ').at(-1)}`);
  await page.waitForTimeout(3000);
  check(await title() === texts[other.id].title, `name plate ${other.id} shows "${await title()}"`);
  const after = await page.evaluate(() => globalThis.__ar.objects());
  const isShown = (id) => after.find((o) => o.id === id).shown;
  if (onDisk(other.map)) check(isShown(`${other.id}-ort`) && !isShown(`${AUTHORS[0].id}-ort`), `map switched to ${other.id}`);
  check(isShown(`${other.id}-werk`) && !isShown(`${AUTHORS[0].id}-werk`), `book switched to ${other.id}`);
  await page.screenshot({ path: `${out}/card-plate-${other.id}.png` });

  const raf = await page.evaluate(() => new Promise((resolve) => {
    const times = [];
    const tick = (t) => (times.push(t) < 121 ? requestAnimationFrame(tick) : resolve((times.at(-1) - times[0]) / 120));
    requestAnimationFrame(tick);
  }));
  const work = await page.evaluate(() => globalThis.__ar.frameMs());
  console.log(`  frame: ${raf.toFixed(1)} ms between frames, ${work.toFixed(1)} ms app work per frame (${gpu ? 'Metal GPU' : "swiftshader"}, not a phone)`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  failures.push(e.message);
  console.log(`FAIL: ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) process.exit(1);
