import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
mkdirSync(out, { recursive: true });

// Two slow pans over the thermostat, portrait like a phone held upright. The photo is extended on the right
// with a mirrored copy because a real phone sees the wall around the sword, but the photos end just right of the thermostat.
const y4m = `${out}/fake-camera.y4m`;
const pan = (i, x0) => `[${i}:v]scale=1500:-1,split[a${i}][b${i}];[b${i}]hflip,crop=400:2000:0:0[m${i}];[a${i}][m${i}]hstack,crop=1125:2000:x='${x0}-12*t':y=0,scale=405:720,fps=15,setsar=1[v${i}]`;
execFileSync('ffmpeg', [
  '-nostdin', '-v', 'error', '-y',
  '-loop', '1', '-t', '1.5', '-i', `${root}test/photos/0443.jpg`,
  '-loop', '1', '-t', '1.5', '-i', `${root}test/photos/0442.jpg`,
  '-filter_complex', `${pan(0, 400)};${pan(1, 470)};[v0][v1]concat=n=2:v=1,format=yuv420p[o]`,
  '-map', '[o]', y4m,
]);

const server = spawn('python3', ['-m', 'http.server', '8125', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({
  channel: 'chrome',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && console.log(`page error: ${m.text()}`));
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  await page.goto(process.env.APP_URL ?? 'http://localhost:8125/site/index.html');
  await page.screenshot({ path: `${out}/start.png` });
  await page.click('#go');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'SWORD DRAWN', null, { timeout: 15000 });
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
