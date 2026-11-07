import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}test/out/upgrades`;
mkdirSync(out, { recursive: true });

const server = await serve(root);
let browser;
let failed = false;
try {
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  const modelRequests = { theater: [], worlds: [], portal: [] };
  let requestingVariant = 'theater';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/site/models/upgrades/kimi-')) modelRequests[requestingVariant].push(path);
  });
  await page.goto(`${server.origin}/site/upgrades.html`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('[role="tab"]').count(), 3, 'exactly three variants');
  assert.equal(await page.locator('.back-link').getAttribute('href'), 'index.html', 'back link');

  const variants = [
    { id: 'theater', title: 'Das lebendige Theater', models: 5, asset: '/site/models/upgrades/kimi-proscenium.glb', file: '01-theater.png' },
    { id: 'worlds', title: 'Zwei Welten', models: 4, asset: '/site/models/upgrades/kimi-crown.glb', file: '02-worlds.png' },
    { id: 'portal', title: 'Das Zeitportal', models: 5, asset: '/site/models/upgrades/kimi-armillary.glb', file: '03-portal.png' },
  ];
  for (const [index, variant] of variants.entries()) {
    requestingVariant = variant.id;
    if (index) await page.locator(`[data-variant="${variant.id}"]`).click();
    await page.waitForFunction(({ id, models }) => {
      const hook = window.__upgrades;
      return hook?.activeVariant === id && hook.modelCount >= models && hook.renderedFrames > 20;
    }, variant, { timeout: 30000 });
    await page.waitForTimeout(500);

    const evidence = await page.evaluate(() => ({
      active: window.__upgrades.activeVariant,
      meshes: window.__upgrades.meshCount,
      models: window.__upgrades.modelCount,
      triangles: window.__upgrades.triangles,
      drawCalls: window.__upgrades.drawCalls,
      frames: window.__upgrades.renderedFrames,
      yaw: window.__upgrades.rotation.yaw,
    }));
    assert.equal(evidence.active, variant.id, 'active variant');
    assert.deepEqual(modelRequests[variant.id], [variant.asset], 'expected Kimi model requested by active variant');
    assert.ok(evidence.meshes > 20, 'real mesh content');
    assert.ok(evidence.triangles > 1000, 'rendered triangles');
    assert.ok(evidence.drawCalls > 0, 'visible draw calls');
    assert.equal(await page.locator('#scene-title').textContent(), variant.title, 'variant description');
    assert.equal(await page.locator(`[data-variant="${variant.id}"]`).getAttribute('aria-selected'), 'true', 'selected tab');

    const canvas = page.locator('#stage');
    const bounds = await canvas.boundingBox();
    assert.ok(bounds.width > 500 && bounds.height > 400, 'visible canvas size');
    await page.waitForTimeout(180);
    assert.ok(await page.evaluate(() => window.__upgrades.renderedFrames) > evidence.frames, 'animation continues');
    const screenshot = await page.screenshot({ path: `${out}/${variant.file}`, fullPage: true });
    assert.ok(screenshot.length > 30000, 'nonempty screenshot');

    const startX = bounds.x + bounds.width * 0.45;
    const startY = bounds.y + bounds.height * 0.42;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 105, startY + 24, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const yaw = await page.evaluate(() => window.__upgrades.rotation.yaw);
    assert.ok(Math.abs(yaw - evidence.yaw) > 0.35, 'drag rotates the scene');
    console.log(`${variant.id}: ${evidence.meshes} meshes, ${evidence.models} models, ${evidence.triangles} triangles, drag ${yaw.toFixed(3)} rad`);
  }

  await page.locator('[data-variant="theater"]').click();
  await page.waitForFunction(() => window.__upgrades.activeVariant === 'theater');
  assert.deepEqual(await page.evaluate(() => window.__upgrades.loadedVariants.sort()), ['portal', 'theater', 'worlds'], 'scenes remain cached');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  mobile.on('pageerror', (error) => errors.push(error.message));
  mobile.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await mobile.goto(`${server.origin}/site/upgrades.html`, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__upgrades?.activeVariant === 'theater' && window.__upgrades.renderedFrames > 20, null, { timeout: 30000 });
  await mobile.screenshot({ path: `${out}/04-mobile.png`, fullPage: true });
  const mobileCanvas = await mobile.locator('#stage').boundingBox();
  const touchX = mobileCanvas.x + mobileCanvas.width * 0.4;
  const touchY = mobileCanvas.y + mobileCanvas.height * 0.4;
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] });
  for (let i = 1; i <= 8; i++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX + i * 9, y: touchY + i * 2 }] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(350);
  assert.ok(await mobile.evaluate(() => window.__upgrades.rotation.yaw) > 0.3, 'touch drag rotates the scene');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no mobile horizontal overflow');
  assert.deepEqual(errors, [], 'no browser or page errors');
  console.log('mobile: touch drag and responsive layout passed');
  console.log(`Screenshots: ${out}`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser?.close();
  server.close();
}
if (failed) process.exit(1);
