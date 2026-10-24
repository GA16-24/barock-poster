import { mkdirSync, rmSync, statSync } from 'node:fs';

// Recording and stills draw with the Mac's GPU in a visible window; two at once halve each other's frame rate and
// break the tracking, so every GPU script holds this lock. A lock older than 15 minutes belongs to a dead run.
const LOCK = '/tmp/barock-gpu.lock';

export async function withGpu(fn) {
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      if (Date.now() - statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs > 15 * 60e3) rmSync(LOCK, { recursive: true, force: true });
      else await new Promise((r) => setTimeout(r, 2000));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}
