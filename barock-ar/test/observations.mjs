import { mkdirSync, writeFileSync } from 'node:fs';
import { A1, makeClip } from './steady.mjs';
import { launch } from './browser.mjs';
import { withGpu } from './gpu-lock.mjs';
import { serve } from './serve.mjs';

const root = new URL('..', import.meta.url).pathname;
const output = `${root}test/out/observations-no-gyro-raw.json`;
const { W, H, FPS, WINDOW } = A1;
const decodeSrc = `(px, stride, offset) => {
  let n = 0;
  for (let b = 0; b < 12; b++) if (px[offset + (b * 40 + 20) * stride] > 128) n |= 1 << b;
  return n;
}`;

function splice(src, needle, replacement) {
  if (!src.includes(needle)) throw new Error(`Instrumentation anchor missing: ${needle.trim()}`);
  return src.replace(needle, replacement);
}

function instrumentMain(source) {
  let src = source;
  src = splice(src, '  focal = FOCAL_PER_LONG_SIDE * Math.max(frameW, frameH);\n',
    '  focal = FOCAL_PER_LONG_SIDE * Math.max(frameW, frameH);\n  __observations.resize(vw, vh, frameW, frameH, focal);\n');
  src = splice(src, '  workCtx.drawImage(image, 0, 0, frameW, frameH);\n',
    '  workCtx.drawImage(image, 0, 0, frameW, frameH);\n  __observations.processed(workCtx, lastFrameTiming?.frameTime);\n');
  src = splice(src, '  return !!hit;\n', '  __observations.detected(!!hit, hit?.acquired === true);\n  return !!hit;\n');
  src = splice(src, '    renderer.render(scene, camera);\n',
    '    renderer.render(scene, camera);\n'
    + '    __observations.rendered(renderNow, [d1 - d0, 0, 0], anchor.matrix.toArray(), stage.visible, renderer.getContext(),\n'
    + '      scene.background?.isTexture ? renderer.properties.get(scene.background).__webglTexture : null);\n');
  src = splice(src, '    const fresh = await detect(image);\n', '    const d0 = performance.now();\n    const fresh = await detect(image);\n    const d1 = performance.now();\n');
  return src;
}

function instrumentPoster(source) {
  let src = source;
  src = splice(src, '      async update(canvas) {\n',
    '      async update(canvas) {\n        __observations.trackerStart(raw !== null);\n'
    + '        const miss = (reason, detail = null) => { __observations.miss(reason, detail); return null; };\n');
  src = splice(src, '        if (disposed) return null;\n', "        if (disposed) return miss('disposed');\n");
  src = splice(src, '            if (!matched.modelViewTransform || !hasBroadCoverage(matched.debugExtra, keyframes, targetDimensions)) return null;\n',
    '            __observations.acquisition(matched.modelViewTransform);\n'
    + "            if (!matched.modelViewTransform) return miss('acquisition-no-model-view');\n"
    + "            if (!hasBroadCoverage(matched.debugExtra, keyframes, targetDimensions)) return miss('acquisition-narrow-coverage');\n");
  src = splice(src, '            const features = await controller.track(canvas, previous, 0);\n',
    '            const features = await controller.track(canvas, previous, 0);\n            __observations.tracking(features);\n');
  src = splice(src, '              return null;\n            }\n            raw = await controller.trackUpdate(previous, features);',
    "              return miss('tracking-insufficient-correspondences', { count: features.worldCoords.length });\n            }\n            raw = await controller.trackUpdate(previous, features);\n            if (raw !== null) __observations.trackUpdate(raw);");
  src = splice(src, '              return null;\n            }\n          }\n          const matrix = metricPosterMatrix',
    "              return miss('tracking-update-failed');\n            }\n          }\n          const matrix = metricPosterMatrix");
  src = splice(src, '          const m = matrix.elements, halfW = physicalWidthM / 2',
    '          __observations.metric(matrix.toArray());\n          const m = matrix.elements, halfW = physicalWidthM / 2');
  src = splice(src, '          if (!valid) {\n            raw = null;\n            return null;\n          }',
    "          if (!valid) {\n            raw = null;\n            return miss('invalid-pose');\n          }");
  src = splice(src, '          if (first && ++confirmations < 3) return null;',
    "          if (first && ++confirmations < 3) return miss('warmup-confirmation', { confirmations });");
  src = splice(src, '          return { matrix, acquired: acquired || (first && confirmations === 3) };',
    '          const result = { matrix, acquired: acquired || (first && confirmations === 3) };\n          __observations.accepted(result);\n          return result;');
  src = splice(src, '        } catch {\n          raw = null;\n          return null;\n        }',
    "        } catch (error) {\n          raw = null;\n          return miss('exception', { message: error?.message ?? String(error) });\n        }");
  return src;
}

function captureSim({ decodeSrc, W, H, FPS }) {
  const decode = eval(decodeSrc);
  const copy = (value) => value == null ? null : JSON.parse(JSON.stringify(value));
  const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const S = globalThis.__observations = {
    t0: null, shown: [], observations: [], resizes: [], epoch: 0, current: null, calibration: null,
  };
  const offsets = [];
  S.resize = (vw, vh, inputWidth, inputHeight, focal) => {
    S.epoch++;
    S.calibration = {
      videoWidth: vw, videoHeight: vh, inputWidth, inputHeight, focal,
      K: [[focal, 0, inputWidth / 2], [0, focal, inputHeight / 2], [0, 0, 1]],
    };
    S.resizes.push({ epoch: S.epoch, now: performance.now(), ...S.calibration });
  };
  S.processed = (ctx, timestamp) => {
    const frameIndex = decode(ctx.getImageData(0, H - 12, 480, 1).data, 4, 0);
    S.current = {
      observationIndex: S.observations.length, epoch: S.epoch, frameIndex, timestamp, processedAt: performance.now(),
      calibration: copy(S.calibration), trackerHadPrevious: null, rawAcquisitionModelViewTransform: null,
      modelViewTransform: null, tracking: null, metricMatrix: null, hit: null, acquired: false,
      missReason: null, missDetail: null, render: null,
    };
    S.observations.push(S.current);
  };
  S.trackerStart = (hadPrevious) => { if (S.current) S.current.trackerHadPrevious = hadPrevious; };
  S.acquisition = (mv) => { if (S.current) S.current.rawAcquisitionModelViewTransform = copy(mv); };
  S.tracking = ({ worldCoords, screenCoords }) => {
    if (S.current) S.current.tracking = { worldCoords: copy(worldCoords), screenCoords: copy(screenCoords) };
  };
  S.trackUpdate = (mv) => { if (S.current) S.current.modelViewTransform = copy(mv); };
  S.metric = (matrix) => { if (S.current) S.current.metricMatrix = copy(matrix); };
  S.miss = (reason, detail) => {
    if (S.current) Object.assign(S.current, { missReason: reason, missDetail: copy(detail) });
  };
  S.accepted = (hit) => {
    if (S.current) Object.assign(S.current, { hit: true, acquired: hit.acquired, metricMatrix: hit.matrix.toArray() });
  };
  S.detected = (hit, acquired) => {
    if (S.current) Object.assign(S.current, { hit, acquired, missReason: hit ? null : S.current.missReason });
  };

  const row = new Uint8Array(4 * 4096);
  let fb = null;
  const decodeRow = (w) => {
    let n = 0;
    for (let b = 0; b < 12; b++) {
      const bits = [8, 20, 32].map((dx) => {
        const j = 4 * Math.floor(((b * 40 + dx) / W) * w), [r, g, bl, a] = row.subarray(j, j + 4);
        if (a < 250) return null;
        return r > 175 && g > 175 && bl > 175 ? 1 : r < 80 && g < 80 && bl < 80 ? 0 : null;
      });
      if (bits.some((x) => x === null || x !== bits[0])) return null;
      n |= bits[0] << b;
    }
    return n;
  };
  const drawnFrame = (gl, background) => {
    gl.readPixels(0, Math.floor((12 / H) * gl.drawingBufferHeight), gl.drawingBufferWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    const onCanvas = decodeRow(gl.drawingBufferWidth);
    if (onCanvas !== null) return { drawn: onCanvas, drawnFrom: 'canvas' };
    if (!background) return { drawn: null, drawnFrom: null };
    gl.bindFramebuffer(gl.FRAMEBUFFER, (fb ??= gl.createFramebuffer()));
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, background, 0);
    gl.readPixels(0, 12, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { drawn: decodeRow(W), drawnFrom: 'texture' };
  };
  S.rendered = (now, ms, m, visible, gl, background) => {
    if (!S.current) return;
    const o = S.current;
    o.render = {
      now, end: performance.now(), ms, m, visible, hands: false, ...drawnFrame(gl, background),
      i: o.frameIndex, frameTime: o.timestamp, q: [0, 0, 0, 1], hit: o.hit, acquired: o.acquired,
    };
  };

  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async () => {
    const stream = await getUserMedia({ video: { width: W, height: H, resizeMode: 'none' }, audio: false });
    const video = document.getElementById('video');
    const probe = Object.assign(document.createElement('canvas'), { width: 480, height: 1 }).getContext('2d', { willReadFrequently: true });
    video.requestVideoFrameCallback(function onFrame(now, metadata) {
      probe.drawImage(video, 0, H - 12, 480, 1, 0, 0, 480, 1);
      const i = decode(probe.getImageData(0, 0, 480, 1).data, 4, 0);
      S.shown.push({ i, cap: metadata.captureTime, pres: metadata.presentationTime, now });
      if (offsets.length < FPS) offsets.push(metadata.captureTime - (i * 1000) / FPS);
      S.t0 = median(offsets);
      video.requestVideoFrameCallback(onFrame);
    });
    return stream;
  };
}

mkdirSync(`${root}test/out`, { recursive: true });
const { origin, close } = await serve(root);
try {
  await withGpu(async () => {
    const clip = await makeClip(origin);
    console.log(`Clip: ${clip}`);
    const browser = await launch([
      '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`,
    ]);
    try {
      const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
      page.on('pageerror', (error) => console.error(`page error: ${error.message}`));
      page.on('console', (message) => message.type() === 'error' && console.error(`console: ${message.text()}`));
      await page.route(/\/site\/main\.js(?:\?.*)?$/, async (route) => {
        await route.fulfill({ body: instrumentMain(await (await route.fetch()).text()), contentType: 'text/javascript' });
      });
      await page.route(/\/site\/poster\.js(?:\?.*)?$/, async (route) => {
        await route.fulfill({ body: instrumentPoster(await (await route.fetch()).text()), contentType: 'text/javascript' });
      });
      await page.route('**/hand_landmarker.task', (route) => route.abort());
      await page.addInitScript(captureSim, { decodeSrc, W, H, FPS });
      await page.goto(`${origin}/site/index.html`);
      await page.click('#go');
      await page.waitForFunction(() => document.getElementById('progress-text').textContent === 'Bereit', null, { timeout: 120000 });
      await page.waitForFunction((end) => __observations.t0 !== null && performance.now() > __observations.t0 + end,
        (WINDOW[1] + 0.3) * 1000, { timeout: 90000, polling: 200 });
      const data = await page.evaluate(() => ({
        t0: __observations.t0, shown: __observations.shown, observations: __observations.observations,
        resizes: __observations.resizes, userAgent: navigator.userAgent,
      }));
      data.gpu = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
      });
      const rendered = data.observations.filter((o) => o.render).length;
      if (!rendered || data.observations.some((o) => o.hit === null)) throw new Error('Incomplete observation capture');
      writeFileSync(output, JSON.stringify({ schema: 1, kind: 'a1-no-gyro-observations', clip, spec: A1, ...data }));
      console.log(`Wrote ${output}: ${data.observations.length} observations, ${rendered} rendered frames`);
    } finally {
      await browser.close();
    }
  });
} finally {
  close();
}
