import sharp from 'sharp';
const UA = { 'User-Agent': 'barock-poster-school-project/1.0 (x1scsizorr.lobby@outlook.com)' };
const [name, ...qs] = process.argv.slice(2);
const rows = [];
for (const q of qs) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=320`;
  const d = await (await fetch(u, { headers: UA })).json();
  for (const p of Object.values(d.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0]; if (!ii || !/\.(jpe?g|png|webp|tif)/i.test(ii.url)) continue;
    rows.push({ title: p.title, url: ii.url, w: ii.width, h: ii.height, thumb: ii.thumburl, lic: ii.extmetadata?.LicenseShortName?.value, artist: (ii.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').slice(0, 60) });
  }
}
const seen = new Set(); const uniq = rows.filter((r) => !seen.has(r.title) && seen.add(r.title)).slice(0, 24);
const tiles = [];
for (const [i, r] of uniq.entries()) {
  try {
    const buf = Buffer.from(await (await fetch(r.thumb, { headers: UA })).arrayBuffer());
    const img = await sharp(buf).resize(240, 240, { fit: 'contain', background: '#fff' }).png().toBuffer();
    const label = Buffer.from(`<svg width="240" height="24"><rect width="240" height="24" fill="#000"/><text x="4" y="17" font-size="15" fill="#ff0" font-family="sans-serif">${i} ${r.w}x${r.h} ${(r.lic||'').replace(/[<&]/g,'')}</text></svg>`);
    tiles.push({ input: await sharp({ create: { width: 240, height: 264, channels: 3, background: '#fff' } }).composite([{ input: img, top: 24, left: 0 }, { input: label, top: 0, left: 0 }]).png().toBuffer(), i });
  } catch (e) { console.error('thumb fail', r.title); }
  console.log(i, r.title, r.w + 'x' + r.h, r.lic, '|', r.artist);
}
const cols = 6, rowsN = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * 244, height: rowsN * 268, channels: 3, background: '#888' } })
  .composite(tiles.map((t, k) => ({ input: t.input, left: (k % cols) * 244, top: Math.floor(k / cols) * 268 })))
  .jpeg({ quality: 80 }).toFile(`test/out/assets/candidates/${name}.jpg`);
await import('fs').then((fs) => fs.writeFileSync(`test/out/assets/candidates/${name}.json`, JSON.stringify(uniq, null, 1)));
