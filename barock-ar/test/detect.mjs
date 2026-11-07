import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from './browser.mjs';
import { serve } from './serve.mjs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}test/out`, { recursive: true });
const { origin, close } = await serve(root);
let browser;
try {
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 1600 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log(`page error: ${e.message}`); });
  page.on('console', (m) => m.type() === 'error' && console.log(`console error: ${m.text()}`));
  await page.route('**/test/poster-source.png', (route) => route.fulfill({ path: `${root}site/img/poster.png` }));
  await page.route('**/test/thermostat.jpg', (route) => route.fulfill({ path: `${root}test/photos/0442.jpg` }));
  await page.route('**/test/printed-poster.jpg', (route) => route.fulfill({ path: `${root}test/photos/our-dimension.jpg` }));
  await page.route('**/test/distant-poster.jpg', (route) => route.fulfill({ path: `${root}test/photos/our-dimension.jpg` }));
  await page.route('**/test/phone-video-frame.png', (route) => route.fulfill({ path: `${root}test/photos/phone-video-frame.png` }));
  await page.goto(`${origin}/test/detect.html`);
  await page.waitForFunction(() => globalThis.ready, null, { timeout: 60000 });
  const results = await page.evaluate(() => globalThis.run());
  await page.screenshot({ path: `${root}test/out/detect-sheet.jpg`, fullPage: true, type: 'jpeg', quality: 85 });
  const failures = [];
  for (const r of results) {
    console.log(`${r.name.padEnd(16)} ${r.found ? 'HIT ' : 'miss'} attempts=${r.attempts} time=${r.ms.toFixed(0)}ms${r.maxCornerError === null ? '' : ` max-corner=${r.maxCornerError.toFixed(1)}px`}${r.details ? ` ${JSON.stringify(r.details)}` : ''}`);
    if (r.found !== r.expected) failures.push(`${r.name}: unexpected recognition result`);
    if (r.expected) {
      if (!r.acquired) failures.push(`${r.name}: result was not a fresh acquisition`);
      if (r.maxCornerError > r.limit) failures.push(`${r.name}: corner error ${r.maxCornerError.toFixed(1)} px exceeds ${r.limit} px`);
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`poster recognition: ${results.filter((r) => r.expected).length} precise positives, ${results.filter((r) => !r.expected).length} rejected negatives`);
} finally {
  await browser?.close();
  close();
}
