import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { detectScreen } from '../site/detect.js';
import { createWallTracker } from '../site/track.js';

// Plays a phone video through the detector and wall tracker the way site/main.js does without a gyro, and measures
// how much the far ends of the scene shake on screen, in px of the 720x1280 detection frame:
// - jerk, |p[i+1] - 2 p[i] + p[i-1]| of a point's projection. A hand-held phone moves smoothly at 30 fps, so the LCD's
//   own jerk is about 1 px and anything well above that is noise.
// - drift, how far a point sits from the median of its unfiltered positions over the surrounding second. Smoothing
//   that lags behind a walking user shows up here.
// Only frames where the point is on screen count. It fails above the MAX limits.
const [video = new URL('out/IMG_0447.MOV', import.meta.url).pathname] = process.argv.slice(2);
const W = 720, H = 1280, FPS = 30, f = 0.75 * H;
const MAX = { jerk: { median: 3, p90: 10 }, drift: { median: 15, p90: 50 } };
const POINTS = { adelTop: [-1.12, 0.76, 0], volkBottom: [1.12, -0.76, 0], poets: [0, 0.6, 0] };

const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', video, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 2 ** 31 });
const n = raw.length / (W * H);
const tracker = createWallTracker(), bare = createWallTracker({ raw: true });
const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), tp = new THREE.Vector3(), tq = new THREE.Quaternion();
const project = (p, position, q) => {
  const c = new THREE.Vector3(...p).applyQuaternion(q).add(position);
  return [W / 2 + (f * c.x) / -c.z, H / 2 - (f * c.y) / -c.z];
};
const frames = [];
let prior = null, last = -2;
for (let i = 0; i < n; i++) {
  const hit = detectScreen(raw.subarray(i * W * H, (i + 1) * W * H), W, H, last === i - 1 ? prior : null);
  if (!hit) continue;
  const fresh = last !== i - 1;
  if (fresh) { tracker.reset(); bare.reset(); }
  prior = hit;
  last = i;
  if (!bare.update(hit.quad, f, W / 2, H / 2, i / FPS, tp, tq)) continue;
  const unfiltered = Object.fromEntries(Object.entries(POINTS).map(([k, p]) => [k, project(p, tp, tq)]));
  tracker.update(hit.quad, f, W / 2, H / 2, i / FPS, tp, tq);
  if (fresh) { pos.copy(tp); quat.copy(tq); } else { pos.lerp(tp, 0.5); quat.copy(tq); }
  frames.push({ i, shown: Object.fromEntries(Object.entries(POINTS).map(([k, p]) => [k, project(p, pos, quat)])), unfiltered });
}

const onScreen = ([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H;
const pct = (a, k) => a.toSorted((x, y) => x - y)[Math.floor(k * (a.length - 1))];
const median = (a) => pct(a, 0.5);
const failures = [];
console.log(`detected ${frames.length}/${n} frames, tilt flipped ${tracker.flips} times`);
for (const k of Object.keys(POINTS)) {
  const jerk = [], drift = [];
  frames.forEach((b, j) => {
    if (!onScreen(b.shown[k])) return;
    const [a, c] = [frames[j - 1], frames[j + 1]];
    if (a?.i === b.i - 1 && c?.i === b.i + 1 && onScreen(a.shown[k]) && onScreen(c.shown[k])) {
      jerk.push(Math.hypot(...[0, 1].map((d) => c.shown[k][d] - 2 * b.shown[k][d] + a.shown[k][d])));
    }
    const near = frames.filter((o) => Math.abs(o.i - b.i) <= FPS / 2);
    if (near.length < FPS * 0.8) return;
    drift.push(Math.hypot(...[0, 1].map((d) => b.shown[k][d] - median(near.map((o) => o.unfiltered[k][d])))));
  });
  const stats = { jerk, drift };
  const line = Object.entries(stats).map(([name, a]) => {
    const m = median(a), p = pct(a, 0.9);
    if (m > MAX[name].median || p > MAX[name].p90) failures.push(`${k} ${name}`);
    return `${name} median ${m.toFixed(1)} p90 ${p.toFixed(1)}`;
  });
  console.log(`${k.padEnd(10)} ${jerk.length} frames on screen: ${line.join(', ')}`);
}
if (failures.length) {
  console.log(`FAIL: ${failures.join(', ')} over ${JSON.stringify(MAX)}`);
  process.exit(1);
}
console.log('PASS');
