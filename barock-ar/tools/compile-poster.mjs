import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../test/browser.mjs';
import { serve } from '../test/serve.mjs';

const root = new URL('..', import.meta.url).pathname;
const { origin, close } = await serve(root);
let browser;
try {
  browser = await launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const started = performance.now();
    const { Compiler } = await import('/site/vendor/mindar/mindar-image.prod.js');
    const image = new Image();
    image.src = '/site/img/poster.png';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width / 2;
    canvas.height = image.height / 2;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const compiler = new Compiler();
    await compiler.compileImageTargets([canvas], () => {});
    const bytes = compiler.exportData();
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { base64: btoa(binary), bytes: bytes.length, width: canvas.width, height: canvas.height, ms: performance.now() - started };
  });
  mkdirSync(`${root}site/targets`, { recursive: true });
  writeFileSync(`${root}site/targets/poster.mind`, Buffer.from(result.base64, 'base64'));
  console.log(`poster target: ${result.width} x ${result.height}, ${result.bytes} bytes, compiled in ${(result.ms / 1000).toFixed(1)} s`);
} finally {
  await browser?.close();
  close();
}
