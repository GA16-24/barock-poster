import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { detectScreen } from '../site/detect.js';
import { createWallTracker } from '../site/track.js';

// Plays a phone video through the detector and wall tracker the way site/main.js does without a gyro, and measures
// how much the far ends of the scene shake on screen, in px of the 720x1280 detection frame:
// - jerk, |p[i+1] - 2 p[i] + p[i-1]| of a point's projection. A hand-held phone moves smoothly at 30 fps, so the LCD's
//   own jerk is about 1 px and anything well above that is noise.
// - lag, half the distance between where the tracker puts a point running forward through the video and where it
//   puts it running backward. Smoothing that trails a moving phone leans opposite ways in the two runs. So does the
//   sign of the tilt, which the LCD barely shows from 2 m, so even an unsmoothed tracker scores about 20 px here.
// Only frames where the point is on screen count. It fails above the MAX limits.
const [video = new URL('out/IMG_0447.MOV', import.meta.url).pathname] = process.argv.slice(2);
const W = 720, H = 1280, FPS = 30, f = 0.75 * H;
const MAX = { jerk: { median: 3, p90: 10 }, lag: { median: 30, p90: 60 } };
const POINTS = { adelTop: [-1.12, 0.76, 0], volkBottom: [1.12, -0.76, 0], poets: [0, 0.6, 0] };

const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', video, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 2 ** 31 });
const n = raw.length / (W * H);
const project = (p, position, q) => {
  const c = new THREE.Vector3(...p).applyQuaternion(q).add(position);
  return [W / 2 + (f * c.x) / -c.z, H / 2 - (f * c.y) / -c.z];
};
const hits = [];
let prior = null, last = -2;
for (let i = 0; i < n; i++) {
  const hit = detectScreen(raw.subarray(i * W * H, (i + 1) * W * H), W, H, last === i - 1 ? prior : null);
  if (!hit) continue;
  hits.push({ i, quad: hit.quad });
  prior = hit;
  last = i;
}
// Each run returns, per frame index, the projected points; time runs backward in the reverse run.
function run(order, flips) {
  const tracker = createWallTracker(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const shown = new Map();
  let prev = null;
  for (const { i, quad } of order) {
    if (prev === null || Math.abs(i - prev) !== 1) tracker.reset();
    prev = i;
    if (!tracker.update(quad, f, W / 2, H / 2, Math.abs(i - order[0].i) / FPS, position, quaternion)) continue;
    shown.set(i, Object.fromEntries(Object.entries(POINTS).map(([k, p]) => [k, project(p, position, quaternion)])));
  }
  flips.push(tracker.flips);
  return shown;
}
const flips = [];
const forward = run(hits, flips), backward = run(hits.toReversed(), flips);
const frames = [...forward].map(([i, shown]) => ({ i, shown, back: backward.get(i) }));

const onScreen = ([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H;
const pct = (a, k) => a.toSorted((x, y) => x - y)[Math.floor(k * (a.length - 1))];
const median = (a) => pct(a, 0.5);
const failures = [];
console.log(`detected ${hits.length}/${n} frames, tilt flipped ${flips.join(' and ')} times forward and backward`);
for (const k of Object.keys(POINTS)) {
  const jerk = [], lag = [];
  frames.forEach((b, j) => {
    if (!onScreen(b.shown[k])) return;
    const [a, c] = [frames[j - 1], frames[j + 1]];
    if (a?.i === b.i - 1 && c?.i === b.i + 1 && onScreen(a.shown[k]) && onScreen(c.shown[k])) {
      jerk.push(Math.hypot(...[0, 1].map((d) => c.shown[k][d] - 2 * b.shown[k][d] + a.shown[k][d])));
    }
    if (b.back) lag.push(Math.hypot(...[0, 1].map((d) => b.shown[k][d] - b.back[k][d])) / 2);
  });
  const stats = { jerk, lag };
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
