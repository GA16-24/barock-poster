import { execFileSync } from 'node:child_process';

// Pulls stills from a demo video at the given seconds and lays them side by side in one contact sheet.
// usage: node test/stills.mjs <video> <sheet.jpg> <seconds...>   (single stills land next to the sheet as <sheet>-<t>.jpg)
const [video, sheet, ...times] = process.argv.slice(2);
if (!video || !sheet || !times.length) throw new Error('usage: node test/stills.mjs <video> <sheet.jpg> <seconds...>');
const base = sheet.replace(/\.jpg$/, '');
const files = times.map((t) => {
  const file = `${base}-${t}.jpg`;
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', t, '-i', video, '-frames:v', '1', '-vf', 'scale=540:-1', file]);
  return file;
});
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `hstack=${files.length}`, sheet]);
console.log(`${sheet} (${files.length} stills)`);
