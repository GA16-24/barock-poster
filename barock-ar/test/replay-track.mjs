import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { detectScreen } from '../site/detect.js';
import { poseFromQuad } from '../site/pose.js';
import { createWallTracker } from '../site/track.js';

// Runs a phone video through the detector and both pose paths at 30 fps and reports how far the LCD normal turns
// between consecutive frames. The phone turns by at most a few degrees per frame, so anything above 10° is error.
const [video, size = '720x1280'] = process.argv.slice(2);
if (!video) throw new Error('usage: npm run test:track -- <phone video> [WxH]');
const [W, H] = size.split('x').map(Number), FPS = 30, f = 0.75 * Math.max(W, H);
const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', video, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 2 ** 31 });
const n = raw.length / (W * H);
const tracker = createWallTracker();
const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), m = new THREE.Matrix4();
const normalOf = (q) => new THREE.Vector3(0, 0, 1).applyQuaternion(q);
const turns = { homography: [], tracked: [] };
let prior = null, last = null, hits = 0;
for (let i = 0; i < n; i++) {
  const hit = detectScreen(raw.subarray(i * W * H, (i + 1) * W * H), W, H, last === i - 1 ? prior : null);
  if (!hit) continue;
  if (last !== i - 1) tracker.reset();
  hits++;
  const h = normalOf(new THREE.Quaternion().setFromRotationMatrix(m.fromArray(poseFromQuad(hit.quad, f, W / 2, H / 2))));
  tracker.update(hit.quad, f, W / 2, H / 2, i / FPS, pos, quat);
  const t = normalOf(quat);
  if (last === i - 1) {
    turns.homography.push(h.angleTo(prior.h));
    turns.tracked.push(t.angleTo(prior.t));
  }
  prior = { ...hit, h, t };
  last = i;
}
console.log(`detected ${hits}/${n} frames, tilt flipped ${tracker.flips} times`);
for (const [name, a] of Object.entries(turns)) {
  const d = a.map((x) => (x * 180) / Math.PI).sort((x, y) => x - y);
  const p = (k) => d[Math.floor(k * (d.length - 1))].toFixed(1);
  console.log(`${name.padEnd(10)} normal turn per frame: median ${p(0.5)}°, p90 ${p(0.9)}°, p99 ${p(0.99)}°, over 10°: ${d.filter((x) => x > 10).length}/${d.length}`);
}
