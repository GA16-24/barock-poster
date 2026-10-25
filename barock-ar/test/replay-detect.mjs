import { execFileSync } from 'node:child_process';
import { detectScreen } from '../site/detect.js';

const [video, size = '720x1280'] = process.argv.slice(2);
if (!video) throw new Error('usage: npm run test:video -- <phone video> [WxH]');
const [W, H] = size.split('x').map(Number), FPS = 15;
const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', video, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 2 ** 31 });
const n = raw.length / (W * H);
let prior = null, hits = 0;
const ms = [];
for (let i = 0; i < n; i++) {
  const gray = raw.subarray(i * W * H, (i + 1) * W * H);
  const t0 = performance.now();
  const hit = detectScreen(gray, W, H, prior);
  ms.push(performance.now() - t0);
  prior = hit;
  if (!hit) { console.log((i / FPS).toFixed(2), '-'); continue; }
  hits++;
  const c = [0, 1].map((k) => Math.round(hit.quad.reduce((s, q) => s + q[k], 0) / 4));
  console.log((i / FPS).toFixed(2), `HIT c=${c} area=${Math.round(hit.area)} score=${hit.score.toFixed(2)} th=${hit.threshold}`);
}
ms.sort((a, b) => a - b);
console.log(`hits ${hits}/${n}, detect ms median ${ms[n >> 1].toFixed(1)} p95 ${ms[Math.floor(n * 0.95)].toFixed(1)}`);
