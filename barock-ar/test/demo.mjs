import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { withGpu } from './gpu-lock.mjs';

// Plays a phone video into the app as its camera, in real time, and records what the screen shows.
// The video has no motion data, so the scene only stays while the thermostat is in view.
// --tap 6.5:birken taps the object with that id when the clip reaches 6.5 s, with a real pointer at its screen
// position; --from and --to cut the clip first (tap times count from the cut). --watch krone,brot prints, every
// half second, which of those objects are wholly on screen and how big, to choose tap times.
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { tap: { type: 'string', multiple: true, default: [] }, from: { type: 'string' }, to: { type: 'string' }, watch: { type: 'string', default: '' } },
});
const [video, output = 'test/out/demo.mp4'] = positionals;
if (!video) throw new Error('usage: npm run demo -- <phone video> [out.mp4] [--from s] [--to s] [--tap s:id ...]');
const VIEW = { width: 405, height: 720 };
const taps = opts.tap.map((s) => ({ t: +s.split(':')[0], id: s.split(':')[1] })).sort((a, b) => a.t - b.t);
const cut = [...(opts.from ? ['-ss', opts.from] : []), ...(opts.to ? ['-to', opts.to] : [])];
const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
const frames = `${out}/demo-frames`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...cut, '-i', video, '-vf', 'scale=720:1280,fps=30', '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${out}/demo-src.mp4`]);

await withGpu(async () => {
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
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
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
      // A fingertip where each tap lands, so the video shows what was touched.
      addEventListener('pointerdown', (ev) => {
        const dot = Object.assign(document.createElement('div'), { className: 'demo-tap' });
        dot.style.cssText = `position:fixed;left:${ev.clientX - 22}px;top:${ev.clientY - 22}px;width:44px;height:44px;border-radius:50%;`
          + 'background:rgba(255,255,255,.55);box-shadow:0 0 0 2px rgba(255,255,255,.9),0 2px 10px rgba(0,0,0,.5);pointer-events:none;z-index:99';
        document.body.append(dot);
        dot.animate([{ transform: 'scale(.6)', opacity: 1 }, { transform: 'scale(1)', opacity: 1, offset: 0.3 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 900, easing: 'ease-out' })
          .finished.then(() => dot.remove());
      }, true);
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
    await page.evaluate((ids) => {
      globalThis.__watch = [];
      if (!ids.length) return;
      // A rect that touches the viewport edge is cut off by it.
      const whole = (r) => r[0] > 0 && r[1] > 0 && r[2] < innerWidth && r[3] < innerHeight;
      setInterval(() => {
        if (!globalThis.__source || __source.ended) return;
        const seen = __ar.objects().filter((o) => ids.includes(o.id) && o.shown && o.rect && whole(o.rect));
        __watch.push(`${__source.currentTime.toFixed(1)}s ${seen.map((o) => `${o.id} ${(o.rect[2] - o.rect[0]).toFixed(0)}x${(o.rect[3] - o.rect[1]).toFixed(0)}`).join(', ')}`);
      }, 500);
    }, opts.watch ? opts.watch.split(',') : []);
    for (const { t, id } of taps) {
      await page.waitForFunction((t) => globalThis.__source?.currentTime >= t, t, { timeout: 300000, polling: 'raf' });
      const o = (await page.evaluate(() => __ar.objects())).find((o) => o.id === id);
      if (!o?.shown || !(o.x > 0 && o.x < VIEW.width && o.y > 0 && o.y < VIEW.height)) {
        console.log(`tap ${id} at ${t}s: not on screen, skipped`);
        continue;
      }
      const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#card, .label') ? 'the card or a label' : __anchor.children[0].visible ? 'the scene' : 'a frame where the scene was lost', [o.x, o.y]);
      await page.mouse.click(o.x, o.y);
      const got = await page.evaluate(() => __ar.selected());
      console.log(`tap ${id} at ${t}s on (${o.x.toFixed(0)}, ${o.y.toFixed(0)}) -> selected ${got}${got === id ? '' : ` (the tap landed on ${under})`}`);
    }
    await page.waitForFunction(() => globalThis.__source?.ended, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(500);
    await cdp.send('Page.stopScreencast');
    const shown = await page.evaluate(() => __shown);
    console.log(`scene shown on ${shown.filter(Boolean).length}/${shown.length} source frames, ${(await page.evaluate(() => __ar.frameMs())).toFixed(1)} ms per app frame`);
    const perSecond = [];
    for (let i = 0; i < shown.length; i += 30) perSecond.push(Math.round((shown.slice(i, i + 30).filter(Boolean).length / 30) * 9));
    console.log(`shown per second (0-9): ${perSecond.join('')}`);
    for (const line of await page.evaluate(() => __watch)) console.log(`watch ${line}`);

    // The screencast only sends a frame when the page changes, so each frame lasts until the next one.
    const list = shots.map((t, i) => `file '${frames}/${String(i + 1).padStart(5, '0')}.jpg'\nduration ${((shots[i + 1] ?? t + 0.1) - t).toFixed(4)}`);
    writeFileSync(`${frames}/list.txt`, `${list.join('\n')}\nfile '${frames}/${String(shots.length).padStart(5, '0')}.jpg'\n`);
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${frames}/list.txt`, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
    console.log(`${shots.length} screen frames over ${(shots.at(-1) - shots[0]).toFixed(1)} s -> ${output}`);
  } finally {
    await browser.close();
    server.kill();
  }
});
