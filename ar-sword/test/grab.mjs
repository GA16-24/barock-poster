import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const fixtures = `${root}test/hands`;
const out = `${root}test/out/hands`;
mkdirSync(out, { recursive: true });

const FPS = 30, W = 405, H = 720, FRAMES = 165;
// Frame windows of the fake camera: empty wall, open hand at A, fist at A, open at A, move to B, open at B.
const OPEN_FROM = 30, FIST_FROM = 60, OPEN_AGAIN = 90, MOVE_FROM = 120, MOVE_TO = 135;
const A = { x: 0.3, y: 0.55 }, B = { x: 0.72, y: 0.62 };
// Cutout scale and palm center (mean of wrist and the four knuckles) in cutout pixels, checked by eye on test/out/hands/cutouts.png.
const OPEN = { scale: 0.6, palm: [195, 212] };
const FIST = { scale: 0.26, palm: [48, 197] };
const ARM = 400;

const magick = (...args) => execFileSync('magick', args);
// Each cutout is extended by stretching its bottom row, so the forearm runs out of the frame like a real reaching arm.
const extendArm = (src, dst) => magick(src, '-trim', '+repage', '(', '+clone', '-gravity', 'south', '-crop', 'x1+0+0', '+repage', '-scale', `100%x${ARM * 100}%`, ')', '-append', dst);
magick(`${fixtures}/right_hands.jpg`, '-crop', '360x382+360+0', '+repage', '-alpha', 'set', '-fuzz', '12%', '-fill', 'none',
  '-draw', 'color 0,0 floodfill', '-draw', 'color 359,0 floodfill', '-draw', 'color 0,200 floodfill', '-draw', 'color 359,200 floodfill', `${out}/open.png`);
// The fist sits on a gray studio wall: background is gray and bright, skin is either colorful or dark. Holes (the ring) are filled.
magick(`${fixtures}/clenched_fist.jpg`, '-channel', 'R',
  '-fx', '(max(max(u.r,u.g),u.b)-min(min(u.r,u.g),u.b) > 0.06 || 0.3*u.r+0.59*u.g+0.11*u.b < 0.45) ? 1 : 0', '+channel', '-separate', '-delete', '1,2',
  '-morphology', 'Open', 'Disk:2', '-morphology', 'Close', 'Disk:4', '-fill', 'red', '-draw', 'color 900,20 floodfill',
  '-fill', 'white', '+opaque', 'red', '-fill', 'black', '-opaque', 'red', '-blur', '0x1.2', `${out}/fist-mask.png`);
magick(`${fixtures}/clenched_fist.jpg`, `${out}/fist-mask.png`, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', '-rotate', '-90', `${out}/fist.png`);
extendArm(`${out}/open.png`, `${out}/open-arm.png`);
extendArm(`${out}/fist.png`, `${out}/fist-arm.png`);
const dot = ([x, y]) => `circle ${x},${y} ${x + 6},${y}`;
magick('(', `${out}/open-arm.png`, '-crop', 'x420+0+0', '+repage', '-fill', 'red', '-draw', dot(OPEN.palm), ')',
  '(', `${out}/fist-arm.png`, '-crop', 'x420+0+0', '+repage', '-fill', 'red', '-draw', dot(FIST.palm), ')',
  '-background', '#2060a0', '+append', '-flatten', `${out}/cutouts.png`);

const ease = `clip((n-${MOVE_FROM})/${MOVE_TO - MOVE_FROM},0,1)`;
const at = (cut, axis, size) => {
  const i = axis === 'x' ? 0 : 1;
  const from = A[axis] * size - cut.palm[i] * cut.scale, to = B[axis] * size - cut.palm[i] * cut.scale;
  return `${from.toFixed(1)}+(${(to - from).toFixed(1)})*${ease}`;
};
const barcode = Array.from({ length: 8 }, (_, b) => `drawbox=x=${b * 12}:y=0:w=12:h=12:color=white:t=fill:enable='mod(floor(n/${2 ** b}),2)'`).join(',');
const y4m = `${out}/fake-camera.y4m`;
execFileSync('ffmpeg', [
  '-nostdin', '-v', 'error', '-y',
  '-loop', '1', '-t', `${FRAMES / FPS}`, '-i', `${root}test/photos/0442.jpg`,
  '-loop', '1', '-t', `${FRAMES / FPS}`, '-i', `${out}/open-arm.png`,
  '-loop', '1', '-t', `${FRAMES / FPS}`, '-i', `${out}/fist-arm.png`,
  '-filter_complex', [
    `[0:v]scale=-2:${H},crop=${W}:${H},fps=${FPS},setsar=1[bg]`,
    `[1:v]scale=iw*${OPEN.scale}:-1[open]`,
    `[2:v]scale=iw*${FIST.scale}:-1[fist]`,
    `[bg][open]overlay=x='${at(OPEN, 'x', W)}':y='${at(OPEN, 'y', H)}':enable='between(n,${OPEN_FROM},${FIST_FROM - 1})+gte(n,${OPEN_AGAIN})'[a]`,
    `[a][fist]overlay=x='${at(FIST, 'x', W)}':y='${at(FIST, 'y', H)}':enable='between(n,${FIST_FROM},${OPEN_AGAIN - 1})'[b]`,
    `[b]drawbox=x=0:y=0:w=96:h=12:color=black:t=fill,${barcode},format=yuv420p[o]`,
  ].join(';'),
  '-map', '[o]', '-frames:v', `${FRAMES}`, y4m,
]);

const expected = (f) => {
  if (f < OPEN_FROM) return null;
  if (f < MOVE_FROM) return A;
  const k = Math.min(1, (f - MOVE_FROM) / (MOVE_TO - MOVE_FROM));
  return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k };
};

const PORT = 8134;
const server = spawn('python3', ['-m', 'http.server', `${PORT}`, '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

// On macOS the hand model runs on the real GPU; on swiftshader one inference can take 200 to 400 ms under load,
// slow enough to lose a fist between samples.
const gpu = process.platform === 'darwin' && !process.env.HANDS_NO_WEBGL;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !gpu,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
    // HANDS_NO_WEBGL=1 checks that createHands gives up cleanly, so the app can fall back to taps.
    ...(process.env.HANDS_NO_WEBGL
      ? ['--disable-gpu', '--disable-software-rasterizer']
      : gpu ? ['--use-angle=metal', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
});
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};
async function checkTracking(page, delegate) {
  check(delegate, `hand model loaded (delegate ${delegate})`);
  if (!delegate) return;

  // Two full passes of the looping fake camera.
  await page.waitForFunction((n) => {
    let wraps = 0;
    for (let i = 1; i < log.length; i++) if (log[i].frame < log[i - 1].frame - 50) wraps++;
    return wraps >= n;
  }, 3, { timeout: 60000, polling: 200 });
  await page.waitForFunction(() => Object.values(snaps).every(Boolean) && Object.keys(snaps).length === snapFrames.length, null, { timeout: 10000 });
  const { log, snaps, video } = await page.evaluate(() => ({ log, snaps, video: [document.getElementById('video').videoWidth, document.getElementById('video').videoHeight] }));
  console.log(`fake camera ${video.join('x')}, ${log.length} updates logged`);

  for (const [f, url] of Object.entries(snaps)) {
    const file = `${out}/frame-${String(f).padStart(3, '0')}.png`;
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`annotated ${file}`);
  }

  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const inferences = log.map((e) => e.inferenceMs).filter((ms, i, all) => ms > 0 && ms !== all[i - 1]);
  // A change shows up after the 100 ms debounce plus up to two samples, and hands.js samples at most every other
  // frame, so windows skip that much after each change.
  const sample = Math.max(median(inferences), 2000 / FPS);
  const lag = Math.ceil(((100 + 2 * sample) / 1000) * FPS);
  console.log(`checks skip ${lag} frames after each change`);

  const starts = [];
  for (let i = 1; i < log.length; i++) if (log[i].frame < log[i - 1].frame - 50) starts.push(i);
  const passes = starts.slice(0, -1).map((s, k) => log.slice(s, starts[k + 1]));
  passes.forEach((pass, p) => {
    const tag = `pass ${p + 1}:`;
    const inWindow = (from, to) => pass.filter((e) => e.frame >= from && e.frame < to);
    const settled = [...inWindow(OPEN_FROM + lag, MOVE_FROM), ...inWindow(MOVE_TO + lag, FRAMES)];
    const found = settled.filter((e) => e.hand).length / settled.length;
    check(found >= 0.9, `${tag} hand found in ${(found * 100).toFixed(0)}% of frames with a hand`);
    // A log entry's frame label can trail the video by one frame, so the hand arriving at frame OPEN_FROM may be
    // logged as OPEN_FROM - 1. A hand left over from the end of the loop would still sit at B, not A.
    const wall = inWindow(OPEN_FROM - 7, OPEN_FROM - 1);
    check(wall.every((e) => !e.hand), `${tag} hand dropped on the empty wall`);
    if (wall.some((e) => e.hand)) console.log(`  ${tag} empty wall: ${wall.map((e) => `${e.frame}:${e.hand ? `hand@${e.hand.x.toFixed(2)},${e.hand.y.toFixed(2)}` : '-'}`).join(' ')}`);
    console.log(`  ${tag} while moving: ${inWindow(MOVE_FROM, MOVE_TO + lag).map((e) => `${e.frame}:${e.hand ? 'hand' : '-'}`).join(' ')}`);

    const offset = (e) => {
      const s = expected(e.frame);
      return [e.hand.x - s.x, e.hand.y - s.y];
    };
    const worst = Math.max(...settled.filter((e) => e.hand).map((e) => Math.max(...offset(e).map(Math.abs))));
    check(worst < 0.08, `${tag} palm point within ${(worst * 100).toFixed(1)}% of the known spot (limit 8%)`);
    const bias = (from, to) => {
      const o = inWindow(from, to).filter((e) => e.hand).map(offset);
      return o.length ? `${(median(o.map((d) => d[0])) * 100).toFixed(1)}%, ${(median(o.map((d) => d[1])) * 100).toFixed(1)}%` : 'n/a';
    };
    console.log(`  ${tag} median offset x, y: open at A ${bias(OPEN_FROM + lag, FIST_FROM)}; fist ${bias(FIST_FROM + lag, OPEN_AGAIN)}; open at B ${bias(MOVE_TO + lag, FRAMES)}`);

    const grabs = pass.filter((e) => e.hand?.grab), releases = pass.filter((e) => e.hand?.release);
    const latency = (es, from) => es.map((e) => ((e.frame - from) / FPS * 1000).toFixed(0));
    check(grabs.length === 1 && grabs[0].frame >= FIST_FROM && grabs[0].frame < OPEN_AGAIN,
      `${tag} one grab, at frame ${grabs.map((e) => e.frame)} (fist from ${FIST_FROM}, latency ${latency(grabs, FIST_FROM)} ms)`);
    check(releases.length === 1 && releases[0].frame >= OPEN_AGAIN && releases[0].frame < MOVE_FROM,
      `${tag} one release, at frame ${releases.map((e) => e.frame)} (open from ${OPEN_AGAIN}, latency ${latency(releases, OPEN_AGAIN)} ms)`);
    const openClosed = [...inWindow(OPEN_FROM, FIST_FROM), ...inWindow(MOVE_FROM, FRAMES)].filter((e) => e.hand?.closed);
    check(openClosed.length === 0, `${tag} never closed while the hand is open (${openClosed.length} frames)`);
    const fistOpen = inWindow(FIST_FROM + lag, OPEN_AGAIN).filter((e) => e.hand && !e.hand.closed);
    check(fistOpen.length === 0, `${tag} stays closed through the fist (${fistOpen.length} open frames)`);

    const raws = (from, to) => inWindow(from, to).filter((e) => e.raw && e.hand).map((e) => e.raw);
    const range = (xs, k) => xs.length ? `${Math.min(...xs.map((r) => r[k])).toFixed(2)}..${Math.max(...xs.map((r) => r[k])).toFixed(2)}` : 'n/a';
    const open = [...raws(OPEN_FROM + lag, FIST_FROM), ...raws(OPEN_AGAIN + lag, FRAMES)], fist = raws(FIST_FROM + lag, OPEN_AGAIN);
    console.log(`  ${tag} open hand: fist ${range(open, 'fist')}, pinch ${range(open, 'pinch')}; fist: fist ${range(fist, 'fist')}, pinch ${range(fist, 'pinch')}`);
  });

  const sorted = [...inferences].sort((a, b) => a - b);
  console.log(`timing (Chrome, ${delegate} delegate on ${gpu ? 'Metal' : 'swiftshader'}; phone GPUs differ):`);
  console.log(`  update() mean ${avg(log.map((e) => e.updateMs)).toFixed(1)} ms over ${log.length} calls`);
  console.log(`  inference mean ${avg(inferences).toFixed(1)} ms, median ${median(inferences).toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms over ${inferences.length} runs`);
}

try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const foreign = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (new URL(url).hostname === '127.0.0.1') return route.continue();
    foreign.push(url);
    return route.abort();
  });
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log(`page ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  const spots = Array.from({ length: FRAMES }, (_, f) => expected(f));
  await page.addInitScript(`window.snapFrames = [24, 45, 75, 105, 128, 160]; window.spots = ${JSON.stringify(spots)};`);
  await page.goto(`http://127.0.0.1:${PORT}/test/hands/index.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
  const delegate = await page.evaluate(() => window.delegate);
  if (process.env.HANDS_NO_WEBGL) check(delegate === null, 'without WebGL createHands returns null');
  else await checkTracking(page, delegate);
  check(foreign.length === 0, `no requests to foreign servers${foreign.length ? `: ${[...new Set(foreign)].join(', ')}` : ''}`);
} catch (e) {
  failures.push(e.message);
  console.log(`FAIL: ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) {
  console.log(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
