import { chromium } from 'playwright';

// Where the GPU scripts can draw with a real GPU: a Mac uses Chrome on Metal in a visible window; the Arch box has
// no Google Chrome, but its system Chromium reaches the GPU headless through Vulkan. Anything else falls back to
// SwiftShader, which is too slow for the full scene.
const mac = process.platform === 'darwin', linux = process.platform === 'linux';
export const gpu = mac || linux;
export const gpuName = mac ? 'Metal GPU' : linux ? 'Vulkan GPU' : 'swiftshader';

export function launch(args = []) {
  return chromium.launch({
    ...(linux ? { executablePath: '/usr/bin/chromium' } : { channel: 'chrome' }),
    headless: !mac,
    args: [
      ...(mac ? ['--use-angle=metal', '--enable-gpu']
        : linux ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist']
        : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      ...args,
    ],
  });
}
