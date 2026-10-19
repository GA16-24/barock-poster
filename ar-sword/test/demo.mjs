import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

// Plays a phone video into the app as its camera, in real time, and records what the screen shows.
// The video has no motion data, so the scene only stays while the thermostat is in view.
const [video, output = 'test/out/demo.mp4'] = process.argv.slice(2);
if (!video) throw new Error('usage: npm run demo -- <phone video> [out.mp4]');
const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
const frames = `${out}/demo-frames`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', video, '-vf', 'scale=720:1280,fps=30', '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${out}/demo-src.mp4`]);

const server = spawn('python3', ['-m', 'http.server', '8128', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
// Software rendering cannot keep up with the full scene, so on macOS the page draws with the GPU in a visible window.
const gpu = process.platform === 'darwin';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !gpu,
  args: [
    ...(gpu ? ['--use-angle=metal', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--autoplay-policy=no-user-gesture-required',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const v = Object.assign(document.createElement('video'), { src: '/test/out/demo-src.mp4', muted: true, playsInline: true });
      await v.play();
      globalThis.__source = v;
      globalThis.__shown = [];
      // A stream captured from the video element itself makes every drawImage in the app read the frame back
      // from the GPU (about 130 ms on an M1); a canvas stream behaves like a camera.
      const canvas = Object.assign(document.createElement('canvas'), { width: 720, height: 1280 });
      const ctx = canvas.getContext('2d');
      v.requestVideoFrameCallback(function onFrame() {
        ctx.drawImage(v, 0, 0);
        __shown.push(document.getElementById('status').textContent === 'GEFUNDEN');
        v.requestVideoFrameCallback(onFrame);
      });
      return canvas.captureStream(30);
    };
  });
  await page.goto('http://localhost:8128/site/index.html');
  await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 120000 });

  const cdp = await page.context().newCDPSession(page);
  const shots = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    shots.push(metadata.timestamp);
    writeFileSync(`${frames}/${String(shots.length).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
  await page.waitForTimeout(1000);
  await page.click('#go');
  await page.waitForFunction(() => globalThis.__source?.ended, null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(500);
  await cdp.send('Page.stopScreencast');
  const shown = await page.evaluate(() => __shown);
  console.log(`scene shown on ${shown.filter(Boolean).length}/${shown.length} source frames, ${(await page.evaluate(() => __ar.frameMs())).toFixed(1)} ms per app frame`);

  // The screencast only sends a frame when the page changes, so each frame lasts until the next one.
  const list = shots.map((t, i) => `file '${frames}/${String(i + 1).padStart(5, '0')}.jpg'\nduration ${((shots[i + 1] ?? t + 0.1) - t).toFixed(4)}`);
  writeFileSync(`${frames}/list.txt`, `${list.join('\n')}\nfile '${frames}/${String(shots.length).padStart(5, '0')}.jpg'\n`);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${frames}/list.txt`, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
  console.log(`${shots.length} screen frames over ${(shots.at(-1) - shots[0]).toFixed(1)} s -> ${output}`);
} finally {
  await browser.close();
  server.kill();
}
