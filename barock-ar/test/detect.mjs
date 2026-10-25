import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('python3', ['-m', 'http.server', '8124', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const CENTERS = { '0442': [776, 952], '0443': [742, 928], '0444': [722, 985], '0445': [748, 948], '0446': [775, 672] };
const frames = [];
for (const [photo, [cx, cy]] of Object.entries(CENTERS))
  for (const [dist, size] of [['near', 900], ['mid', 1300], ['far', 1800]]) frames.push({ photo, dist, view: [cx, cy, size] });
for (const [photo, cx, cy, size] of [['0442', 750, 1600, 700], ['0442', 300, 400, 700], ['0444', 230, 700, 900], ['0444', 250, 300, 700], ['0445', 750, 1600, 700], ['0446', 220, 300, 800], ['0446', 900, 1600, 700], ['0443', 1100, 1600, 800]])
  frames.push({ photo, dist: 'neg', view: [cx, cy, size] });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 360 * 5, height: 480 * 5 } });
await page.goto('http://localhost:8124/test/detect.html');
await page.waitForFunction('window.ready');
const res = await page.evaluate((f) => window.run(f), frames);
mkdirSync(`${root}test/out`, { recursive: true });
await page.screenshot({ path: `${root}test/out/detect-sheet.jpg`, quality: 70 });
await browser.close();
server.kill();

for (const r of res) console.log(r.photo, r.dist.padEnd(4), r.hit ? `HIT ${JSON.stringify(r.hit)}` : 'miss');
const hits = res.filter((r) => r.dist !== 'neg' && r.hit).length;
const falsePositives = res.filter((r) => r.dist === 'neg' && r.hit).length;
console.log(`\nthermostat frames detected: ${hits}/15 (0446 is a glancing top-down shot, expected to miss)`);
console.log(`false positives: ${falsePositives}/8`);
console.log('contact sheet: test/out/detect-sheet.jpg');
if (hits < 12 || falsePositives > 0) process.exit(1);
