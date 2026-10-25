import { spawn } from 'node:child_process';

// Serves `root` on a free port and resolves to its origin once python listens. A fixed port once let one checkout's
// test load another checkout's page, so the server picks its own port and a server that dies early fails the run.
export function serve(root) {
  const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', up = false;
  return new Promise((resolve, reject) => {
    const read = (d) => {
      log += d;
      const port = !up && log.match(/Serving HTTP on 127\.0\.0\.1 port (\d+)/)?.[1];
      if (!port) return;
      up = true;
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.kill() });
    };
    server.stdout.on('data', read);
    server.stderr.on('data', read);
    server.on('exit', (code) => {
      const e = new Error(`http.server for ${root} exited with ${code}:\n${log}`);
      if (up && !server.killed) console.error(`FAIL: ${e.message}`);
      reject(e);
    });
  });
}
