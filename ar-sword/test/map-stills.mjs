import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import * as THREE from 'three';

// Renders map placements as stills on paused frames of test/out/demo-src.mp4 (made by npm run demo), patching the
// map entries at runtime. Candidates are size@x,y,z[/tilt].
// Usage: node test/map-stills.mjs [--times 3,11,16] [size@x,y,z[/tilt] ...]
const args = process.argv.slice(2);
const timesArg = args.indexOf('--times');
const TIMES = timesArg < 0 ? [3, 11, 16, 20, 26, 32] : args.splice(timesArg, 2)[1].split(',').map(Number);
const parse = (s) => {
  const [size, rest] = s.split('@');
  const [at, tilt = '0'] = rest.split('/');
  return { name: s, size: +size, at: at.split(',').map(Number), tilt: +tilt };
};
const CANDIDATES = (args.length ? args : ['0.5@0,-0.4,0.28/0.75', '0.8@0,-0.45,0.5', '1.0@0,-0.55,0.6', '1.2@0,-0.7,0.72', '1.0@0,-0.62,0.62', '1.2@0,-0.6,0.72']).map(parse);

const f = (v) => v.map((x) => x.toFixed(2)).join(', ');
const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out/map-stills`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function shadowCheck({ min, max }, key) {
  const light = new THREE.OrthographicCamera(...key.bounds);
  light.position.fromArray(key.pos);
  light.lookAt(...key.target);
  light.updateMatrixWorld();
  const toWall = light.position.clone().sub(new THREE.Vector3(...key.target)).normalize();
  const [cx, cz, rx, rz] = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2, (max[2] - min[2]) / 2];
  const rim = [], onWall = [];
  for (let a = 0; a < 6.28; a += 0.26) for (const y of [min[1], max[1]]) {
    const p = new THREE.Vector3(cx + rx * Math.cos(a), y, cz + rz * Math.sin(a));
    rim.push(p);
    onWall.push(p.clone().addScaledVector(toWall, -p.z / toWall.z));
  }
  const ndc = [...rim, ...onWall].map((p) => p.clone().project(light));
  const edge = Math.max(...ndc.flatMap((p) => [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)]));
  return `shadow camera ${edge <= 1 ? 'covers' : 'CLIPS'} the rim and its wall shadow (max |ndc| ${edge.toFixed(2)}); wall shadow reaches y=${Math.min(...onWall.map((p) => p.y)).toFixed(2)}`;
}

const server = spawn('python3', ['-m', 'http.server', '8129', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
// Headless software GL is too slow for the full scene, so this needs the GPU in a visible window (macOS).
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  await page.addInitScript(() => {
    localStorage.setItem('barock-hint-seen', '1');
    navigator.mediaDevices.getUserMedia = async () => {
      // python's http.server ignores Range requests, which leaves the video unseekable; a blob URL is seekable.
      const src = URL.createObjectURL(await (await fetch('/test/out/demo-src.mp4')).blob());
      const v = Object.assign(document.createElement('video'), { src, muted: true, playsInline: true, preload: 'auto' });
      await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
      const canvas = Object.assign(document.createElement('canvas'), { width: 720, height: 1280 });
      const ctx = canvas.getContext('2d');
      // A canvas stream only sends a frame when the canvas is drawn, so the paused frame is redrawn like a live camera.
      setInterval(() => ctx.drawImage(v, 0, 0), 33);
      globalThis.__seek = (t) => new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; });
      return canvas.captureStream(30);
    };
  });
  await page.goto('http://localhost:8129/site/index.html');
  await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 120000 });
  await page.click('#go');
  await page.waitForFunction(() => globalThis.__ar && globalThis.__seek);
  await page.evaluate(() => __ar.setHand(null));
  const key = await page.evaluate(async () => {
    const { stage } = await import('/site/scene.js');
    const l = stage.children.find((o) => o.isDirectionalLight), c = l.shadow.camera;
    return { pos: l.position.toArray(), target: l.target.position.toArray(), bounds: [c.left, c.right, c.top, c.bottom, c.near, c.far] };
  });

  const boxes = new Map();
  for (const t of TIMES) {
    await page.evaluate((t) => __seek(t), t);
    await page.waitForTimeout(3000);
    const found = await page.evaluate(() => document.getElementById('status').textContent === 'GEFUNDEN');
    const pose = await page.evaluate(() => {
      const m = __anchor.matrix.clone().invert().elements;
      return { pos: [m[12], m[13], m[14]], look: [-m[8], -m[9], -m[10]] };
    });
    console.log(`t=${t}s ${found ? 'found' : 'NOT FOUND'} camera at (${f(pose.pos)}) m, looking (${f(pose.look)}): ${pose.pos[2].toFixed(2)} m from the wall, ${pose.pos[1] >= 0 ? '+' : ''}${pose.pos[1].toFixed(2)} m vs thermostat`);
    for (const [i, c] of CANDIDATES.entries()) {
      const box = await page.evaluate(async ({ size, at, tilt }) => {
        const THREE = await import('/site/vendor/three.module.js');
        const { entries } = await import('/site/scene.js');
        const { MAP } = await import('/site/catalog.js');
        let box = null;
        for (const e of entries.filter((e) => e.kind === 'map')) {
          e.rest.fromArray(at);
          e.size = size;
          const inner = e.holder.children[0];
          if (!inner) continue;
          inner.scale.setScalar(size / MAP.size);
          inner.rotation.x = tilt;
          e.holder.remove(inner);
          inner.updateMatrixWorld(true);
          e.box = new THREE.Box3().setFromObject(inner);
          e.holder.add(inner);
          box = { min: e.box.min.clone().add(e.rest).toArray(), max: e.box.max.clone().add(e.rest).toArray() };
        }
        const r = size / 2, centre = new THREE.Vector3(...at);
        const hits = entries.filter((e) => e.kind !== 'map' && e.box).filter((e) => {
          const b = e.box.clone().translate(e.rest);
          const near = centre.clone().clamp(b.min, b.max);
          return Math.hypot(near.x - at[0], near.z - at[2]) < r && b.min.y < box.max[1] && b.max.y > box.min[1];
        });
        return { ...box, hits: hits.map((e) => e.id) };
      }, c);
      boxes.set(c.name, box);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${i}-${t}s.png` });
    }
  }
  for (const c of CANDIDATES) {
    const b = boxes.get(c.name);
    console.log(`${c.name}: box (${f(b.min)}) to (${f(b.max)}), ${b.min[2].toFixed(2)} m off the wall, collides with ${b.hits.join(', ') || 'nothing'}; ${shadowCheck(b, key)}`);
  }
  const inputs = CANDIDATES.flatMap((_, i) => TIMES.flatMap((t) => ['-i', `${out}/${i}-${t}s.png`]));
  const n = CANDIDATES.length * TIMES.length;
  const filter = `${[...Array(n).keys()].map((k) => `[${k}]scale=270:480[s${k}]`).join(';')};${[...Array(n).keys()].map((k) => `[s${k}]`).join('')}xstack=inputs=${n}:grid=${TIMES.length}x${CANDIDATES.length}`;
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '3', `${out}/sheet.jpg`]);
  console.log(`rows: ${CANDIDATES.map((c, i) => `${i}=${c.name}`).join(' ')}; columns t=${TIMES.join(',')}s -> ${out}/sheet.jpg`);
} finally {
  await browser.close();
  server.kill();
}
