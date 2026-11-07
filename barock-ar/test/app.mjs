import { launch } from './browser.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
mkdirSync(out, { recursive: true });

// A portrait phone camera holds the supplied trigger image against a plain wall.
const y4m = `${out}/fake-camera.y4m`;
execFileSync('ffmpeg', [
  '-nostdin', '-v', 'error', '-y',
  '-loop', '1', '-t', process.env.CAMERA_SECONDS ?? '3', '-i', process.env.CAMERA_IMAGE ?? `${root}site/img/poster.png`,
  '-vf', `scale=600:-1,pad=720:1280:60:420:color=0xc9b9a3,scale=405:720,fps=${process.env.CAMERA_FPS ?? 15},setsar=1,format=yuv420p`,
  y4m,
]);

const server = spawn('python3', ['-m', 'http.server', '8125', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await launch([
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${y4m}`,
]);
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const modelRequests = [];
  page.on('request', (r) => { if (r.url().includes('/site/models/')) modelRequests.push(r.url()); });
  page.on('console', (m) => m.type() === 'error' && console.log(`page error: ${m.text()}`));
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  if (process.env.SAFARI_COMPAT) await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'VideoFrame', { value: undefined, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { value: undefined, configurable: true });
  });
  if (process.env.VIDEOFRAME_FAILURE) await page.addInitScript(() => {
    globalThis.VideoFrame = class {
      constructor() {
        throw new DOMException('The video element has no frame', 'InvalidStateError');
      }
    };
  });
  if (process.env.IPHONE) await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(navigator, 'platform', { value: 'iPhone' });
  });
  await page.goto(process.env.APP_URL ?? 'http://localhost:8125/site/index.html');
  await page.screenshot({ path: `${out}/start.png` });
  if (modelRequests.length) throw new Error(`${modelRequests.length} model requests started before Start`);
  await page.click('#go');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'GEFUNDEN', null, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 60000 });
  if (process.env.IPHONE && await page.evaluate(() => globalThis.__ar.timing().videoTimestamp !== null))
    throw new Error('iPhone mode did not use direct video pixels');
  console.log('video', await page.evaluate(() => [video.videoWidth, video.videoHeight]));
  for (let i = 1; i <= 3; i++) {
    await page.screenshot({ path: `${out}/app-${i}.png` });
    console.log(`screenshot ${out}/app-${i}.png status=${await page.textContent('#status')}`);
    await page.waitForTimeout(1000);
  }
} catch (e) {
  failed = true;
  console.log(`FAIL: ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failed) process.exit(1);
