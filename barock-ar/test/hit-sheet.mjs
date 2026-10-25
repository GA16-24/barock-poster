import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';

// Crops the source video around replay-detect hits so a person can confirm each one is the thermostat.
const [log, video, out, filter = 'every:12'] = process.argv.slice(2);
const [mode, arg] = filter.split(':');
const all = readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('HIT')).map((l) => {
  const [t] = l.split(' ');
  const [x, y] = l.match(/c=(\d+),(\d+)/).slice(1).map(Number);
  return { t: +t, x, y, score: +l.match(/score=([\d.]+)/)[1], line: l };
});
const picked = mode === 'every' ? all.filter((_, i) => i % +arg === 0) : all.filter((h) => h.score < +arg);
const dir = `${out}.d`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
// Hits are logged at 720x1280; the source is 1080x1920.
const k = 1.5, half = 90;
picked.slice(0, 48).forEach((h, i) => {
  const X = Math.max(0, Math.min(1080 - 2 * half, Math.round(h.x * k) - half));
  const Y = Math.max(0, Math.min(1920 - 2 * half, Math.round(h.y * k) - half));
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', `${h.t}`, '-i', video, '-frames:v', '1',
    '-vf', `crop=${2 * half}:${2 * half}:${X}:${Y},drawbox=x=${Math.round(h.x * k) - X - 4}:y=${Math.round(h.y * k) - Y - 4}:w=8:h=8:color=red:t=2`,
    `${dir}/${String(i).padStart(3, '0')}.jpg`]);
});
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', `${dir}/%03d.jpg`, '-vf', 'tile=8x6', '-frames:v', '1', out]);
console.log(picked.slice(0, 48).map((h, i) => `${i}: ${h.t} score=${h.score}`).join('\n'));
