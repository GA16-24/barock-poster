// Downloads OSM data (Overpass) and terrain tiles (AWS terrarium) once and caches them under cache/,
// so every later build runs offline.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const CACHE = new URL('./cache/', import.meta.url).pathname;
const UA = 'barock-poster-maps/1.0 (school project)';
export const FETCH_RADIUS = 650;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(file, download) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const buf = await download();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p + '.tmp', buf);
  fs.renameSync(p + '.tmp', p);
  return buf;
}

function overpassQuery([lat, lon]) {
  const a = `(around:${FETCH_RADIUS},${lat},${lon})`;
  return `[out:json][timeout:180];
(
  way["building"]${a}; relation["building"]${a};
  way["building:part"]${a}; relation["building:part"]${a};
  way["highway"]${a}; way["area:highway"]${a};
  way["place"="square"]${a};
  way["natural"]${a}; relation["natural"]${a};
  way["waterway"]${a}; relation["waterway"]${a};
  way["water"]${a}; relation["water"]${a};
  way["landuse"]${a}; relation["landuse"]${a};
  way["leisure"]${a}; relation["leisure"]${a};
  way["amenity"="parking"]${a};
  way["barrier"="city_wall"]${a}; way["historic"="citywalls"]${a};
  way["man_made"="bridge"]${a};
  node["natural"="tree"]${a};
);
out geom;`;
}

export async function osm(city) {
  const buf = await cached(`${city.id}-osm.json`, async () => {
    const body = new URLSearchParams({ data: overpassQuery(city.center) });
    for (let attempt = 0, wait = 10_000; attempt < 8; attempt++, wait *= 2) {
      const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body, headers: { 'User-Agent': UA } });
      const text = await res.text();
      if (res.ok && text.startsWith('{')) return Buffer.from(text);
      console.log(`overpass ${res.status}, retry in ${wait / 1000}s`);
      await sleep(wait);
    }
    throw new Error('overpass kept failing');
  });
  return JSON.parse(buf.toString()).elements;
}

const Z = 15;
const tileXY = (lat, lon) => {
  const n = 2 ** Z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
};

// Returns elevation(lat, lon) in meters, bilinear over the cached z15 terrarium tiles.
export async function dem(city) {
  const [lat, lon] = city.center;
  const dLat = FETCH_RADIUS / 111_320;
  const dLon = FETCH_RADIUS / (111_320 * Math.cos((lat * Math.PI) / 180));
  const [x0, y0] = tileXY(lat + dLat, lon - dLon).map(Math.floor);
  const [x1, y1] = tileXY(lat - dLat, lon + dLon).map(Math.floor);
  const tiles = new Map();
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const png = await cached(`dem/${Z}-${tx}-${ty}.png`, async () => {
        const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
        if (!res.ok) throw new Error(`dem tile ${tx}/${ty}: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      });
      const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const h = new Float32Array(256 * 256);
      for (let i = 0; i < h.length; i++) h[i] = data[i * 3] * 256 + data[i * 3 + 1] + data[i * 3 + 2] / 256 - 32768;
      tiles.set(`${tx},${ty}`, h);
    }
  }
  const sample = (px, py) => {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return NaN;
    return t[(py - ty * 256) * 256 + (px - tx * 256)];
  };
  return (la, lo) => {
    const [fx, fy] = tileXY(la, lo).map((v) => v * 256 - 0.5);
    const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    return (sample(ix, iy) * (1 - u) + sample(ix + 1, iy) * u) * (1 - v) + (sample(ix, iy + 1) * (1 - u) + sample(ix + 1, iy + 1) * u) * v;
  };
}
