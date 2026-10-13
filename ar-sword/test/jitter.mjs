import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
mkdirSync(out, { recursive: true });

// A held-still phone: one photo, shaken by a few source pixels per frame (about 1 px in the detection frame).
const y4m = `${out}/shake.y4m`;
execFileSync('ffmpeg', [
  '-nostdin', '-v', 'error', '-y', '-loop', '1', '-t', '4', '-i', `${root}test/photos/0442.jpg`,
  '-vf', "crop=3500:5600:x='300+12*random(1)':y='60+12*random(2)',scale=405:720,fps=15,setsar=1,format=yuv420p",
  y4m,
]);

const server = spawn('python3', ['-m', 'http.server', '8126'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
});

async function measure(rotationSmoothing) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  if (rotationSmoothing !== undefined) {
    await page.route('**/site/main.js', async (route) => {
      const body = (await (await route.fetch()).text()).replace(/ROTATION_SMOOTHING = [\d.]+/, `ROTATION_SMOOTHING = ${rotationSmoothing}`);
      await route.fulfill({ body, contentType: 'text/javascript' });
    });
  }
  await page.goto('http://localhost:8126/site/index.html');
  await page.click('#go');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'SWORD DRAWN', null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const degrees = await page.evaluate(async () => {
    const { Quaternion, Vector3 } = await import('three');
    const samples = [];
    const end = performance.now() + 2500;
    while (performance.now() < end) {
      await new Promise(requestAnimationFrame);
      const q = new Quaternion();
      globalThis.__anchor.matrix.decompose(new Vector3(), q, new Vector3());
      samples.push(q);
    }
    const ref = samples[samples.length >> 1];
    return samples.map((q) => (q.angleTo(ref) * 180) / Math.PI).sort((a, b) => a - b);
  });
  await page.close();
  const p = (k) => degrees[Math.floor(k * (degrees.length - 1))].toFixed(2);
  return `median ${p(0.5)}°, p95 ${p(0.95)}°, max ${p(1)}° over ${degrees.length} frames`;
}

try {
  console.log('raw pose (no rotation smoothing):', await measure(1));
  console.log('shipped smoothing:              ', await measure());
} finally {
  await browser.close();
  server.kill();
}
