import { FilesetResolver, HandLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

const WASM = new URL('./vendor/mediapipe/wasm', import.meta.url).href;
const MODEL = new URL('./models/mediapipe/hand_landmarker.task', import.meta.url).href;

// Weight of the newest sample for the palm point.
const SMOOTHING = 0.6;
// Mean fingertip-to-palm-center distance over palm size: 1.05 to 1.3 for an open hand, about 0.25 in a fist.
const FIST = { close: 0.6, open: 0.8 };
// Thumb tip to index tip over palm size.
const PINCH = { close: 0.3, open: 0.45 };
const DEBOUNCE_MS = 100;
// A hand missing for one or two inferences is kept, so a closed hand does not drop its object.
const LOST_MS = 250;

const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8;
const MCPS = [5, 9, 13, 17];
const TIPS = [8, 12, 16, 20];

const frameReady = (video) =>
  video.readyState >= 2 ? Promise.resolve() : new Promise((ok) => video.addEventListener('loadeddata', ok, { once: true }));

async function load(video) {
  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks(WASM);
  } catch (e) {
    console.warn('hands: wasm failed', e);
    return null;
  }
  await frameReady(video);
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      // A delegate can load and still fail on the first frame (the video upload needs WebGL even on CPU),
      // so one warm-up run decides. It also takes the slow first inference out of the app's frame loop.
      landmarker.detectForVideo(video, performance.now());
      return { landmarker, delegate };
    } catch (e) {
      // A failed landmarker is not closed: close() posts usage statistics to a Google server.
      console.warn(`hands: ${delegate} delegate failed`, e);
    }
  }
  return null;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mean = (points) => {
  const m = { x: 0, y: 0, z: 0 };
  for (const p of points) {
    m.x += p.x / points.length;
    m.y += p.y / points.length;
    m.z += p.z / points.length;
  }
  return m;
};

// World landmarks are metric 3D around the hand, so the ratios hold when the hand tilts or moves away.
function measure(image, world) {
  const palmIds = [WRIST, ...MCPS];
  const center = mean(palmIds.map((i) => world[i]));
  const palm = MCPS.reduce((s, i) => s + dist(world[WRIST], world[i]), 0) / MCPS.length;
  const point = mean(palmIds.map((i) => image[i]));
  return {
    x: point.x,
    y: point.y,
    fist: TIPS.reduce((s, i) => s + dist(world[i], center), 0) / TIPS.length / palm,
    pinch: dist(world[THUMB_TIP], world[INDEX_TIP]) / palm,
    landmarks: image,
  };
}

export async function createHands(video) {
  const loaded = await load(video);
  if (!loaded) return null;
  const { landmarker } = loaded;

  let ranLast = false;
  let lastVideoTime = -1;
  let lastSeen = -Infinity;
  let hand = null;
  let closed = false;
  let pendingSince = null;

  // Returns 'grab' on the first close inference, or 'release' after an open inference persists for the debounce interval.
  function settle(m, now) {
    const raw = closed
      ? m.fist < FIST.open || m.pinch < PINCH.open
      : m.fist < FIST.close || m.pinch < PINCH.close;
    if (raw === closed) {
      pendingSince = null;
      return null;
    }
    pendingSince ??= now;
    if (!raw && now - pendingSince < DEBOUNCE_MS) return null;
    closed = raw;
    pendingSince = null;
    return closed ? 'grab' : 'release';
  }

  function infer(now) {
    const t0 = performance.now();
    const result = landmarker.detectForVideo(video, t0);
    hands.inferenceMs = performance.now() - t0;

    if (!result.landmarks.length) {
      if (hand && now - lastSeen >= LOST_MS) {
        const last = hand;
        hand = null;
        pendingSince = null;
        if (closed) {
          closed = false;
          return { ...last, closed: false, grab: false, release: true };
        }
      }
      return hand && { ...hand, grab: false, release: false };
    }

    const m = measure(result.landmarks[0], result.worldLandmarks[0]);
    const prev = hand;
    // A hand that comes into view already closed has to open first, so reaching in with a loose fist grabs nothing.
    if (!prev) closed = m.fist < FIST.close || m.pinch < PINCH.close;
    lastSeen = now;
    const edge = settle(m, now);
    hands.raw = m;
    hand = {
      x: prev ? prev.x + (m.x - prev.x) * SMOOTHING : m.x,
      y: prev ? prev.y + (m.y - prev.y) * SMOOTHING : m.y,
      closed,
      grab: edge === 'grab',
      release: edge === 'release',
    };
    return hand;
  }

  const hands = {
    delegate: loaded.delegate,
    inferenceMs: 0,
    raw: null,
    update(now) {
      const ready = video.readyState >= 2 && video.currentTime !== lastVideoTime;
      if (ranLast || !ready) {
        ranLast = false;
        return hand && { ...hand, grab: false, release: false };
      }
      ranLast = true;
      lastVideoTime = video.currentTime;
      return infer(now);
    },
  };
  return hands;
}
