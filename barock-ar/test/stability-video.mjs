import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { launch } from './browser.mjs';
import { withGpu } from './gpu-lock.mjs';
import { serve } from './serve.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out`;
const clip = `${out}/steady-a1-0aeca71a7111.y4m`;
mkdirSync(out, { recursive: true });

function revertGyroStabilityFix(body) {
  return body.replace('let raw = null, disposed = false, confirmations = 0, emitted = false, misses = 0;', 'let raw = null, disposed = false, confirmations = 0, emitted = false;')
    .replace('if (features.worldCoords.length < 12) {\n              misses++;\n              if (misses >= 3) raw = null;\n              return null;\n            }', 'if (features.worldCoords.length < 12) {\n              raw = null;\n              return null;\n            }')
    .replace('raw = await controller.trackUpdate(previous, features);\n            if (raw === null) {\n              misses++;\n              if (misses < 3) raw = previous;\n              return null;\n            }', 'raw = await controller.trackUpdate(previous, features);\n            if (raw === null) return null;')
    .replace('          misses = 0;\n', '');
}

const { origin, close } = await serve(root);
await withGpu(async () => {
  const browser = await launch([
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`,
  ]);
  try {
    for (const mode of ['before', 'after']) {
      const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on('pageerror', (e) => console.log(`${mode} page error: ${e.message}`));
      if (mode === 'before') {
        await page.route(/\/site\/main\.js(?:\?.*)?$/, async (route) => {
          const body = (await (await route.fetch()).text()).replace('          }\n    lastSeen', '          quat.slerp(targetQuat, worldFromCamera ? ROTATION_SMOOTHING : 1);\n      }\n    lastSeen');
          await route.fulfill({ body, contentType: 'text/javascript' });
        });
        await page.route(/\/site\/poster\.js(?:\?.*)?$/, async (route) => {
          await route.fulfill({ body: revertGyroStabilityFix(await (await route.fetch()).text()), contentType: 'text/javascript' });
        });
      }
      await page.goto(`${origin}/site/index.html`);
      await page.click('#go');
      await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 120000 });
      await page.waitForFunction(() => document.getElementById('status').textContent === 'GEFUNDEN', null, { timeout: 30000 });
      const frames = `${out}/stability-video/${mode}`;
      rmSync(frames, { recursive: true, force: true });
      mkdirSync(frames, { recursive: true });
      const cdp = await context.newCDPSession(page), shots = [];
      cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
        shots.push(metadata.timestamp);
        writeFileSync(`${frames}/${String(shots.length).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'));
        await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
      await page.waitForTimeout(12000);
      await cdp.send('Page.stopScreencast');
      const list = shots.map((t, i) => `file '${frames}/${String(i + 1).padStart(4, '0')}.jpg'\nduration ${Math.max(1 / 30, (shots[i + 1] ?? t + 0.1) - t).toFixed(4)}`);
      writeFileSync(`${frames}/list.txt`, `${list.join('\n')}\nfile '${frames}/${String(shots.length).padStart(4, '0')}.jpg'\n`);
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${frames}/list.txt`, '-vf', 'fps=30', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', `${out}/stability-${mode}.mp4`]);
      await context.close();
      console.log(`${mode}: ${shots.length} frames`);
    }
  } finally {
    await browser.close();
    close();
  }
});
