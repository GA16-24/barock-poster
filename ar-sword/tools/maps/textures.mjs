// Procedural textures painted as SVG and rasterized by sharp. All are near white so the vertex color
// carries the tint; the ground map is the exception and carries its own colors.
import sharp from 'sharp';

const webp = (svg, size, q = 82) => sharp(Buffer.from(svg)).resize(size, size).webp({ quality: q }).toBuffer();
const noise = (id, freq, oct, seed = 1) => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`;

export function facadeTexture() {
  // 2 bays x 2 floors per tile
  const win = (x, y) => `
    <rect x="${x - 3}" y="${y - 3}" width="70" height="104" fill="#f6f2ea"/>
    <rect x="${x}" y="${y}" width="64" height="98" fill="#2c3238"/>
    <rect x="${x + 30}" y="${y}" width="4" height="98" fill="#e9e4da"/>
    <rect x="${x}" y="${y + 40}" width="64" height="4" fill="#e9e4da"/>
    <rect x="${x - 26}" y="${y}" width="22" height="98" fill="#6f7f66"/><rect x="${x + 68}" y="${y}" width="22" height="98" fill="#6f7f66"/>
    <rect x="${x - 6}" y="${y + 98}" width="76" height="8" fill="#d8d2c6"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${noise('n', 0.03, 3)}
    <rect width="512" height="512" fill="#f2efe8"/><rect width="512" height="512" filter="url(#n)" opacity="0.12"/>
    <rect y="246" width="512" height="10" fill="#d9d4c8"/><rect y="502" width="512" height="10" fill="#d9d4c8"/>
    ${win(96, 92)}${win(352, 92)}${win(96, 348)}${win(352, 348)}</svg>`;
  return webp(svg, 512);
}

export function timberTexture() {
  const beam = '#4a3424';
  const win = (x, y) => `<rect x="${x}" y="${y}" width="56" height="80" fill="#2a2f34"/><rect x="${x + 26}" y="${y}" width="4" height="80" fill="#d9d2c4"/><rect x="${x - 4}" y="${y + 80}" width="64" height="8" fill="${beam}"/>`;
  const floor = (y) => `
    <rect x="0" y="${y}" width="512" height="16" fill="${beam}"/><rect x="0" y="${y + 236}" width="512" height="16" fill="${beam}"/>
    ${[0, 128, 256, 384].map((x) => `<rect x="${x}" y="${y}" width="14" height="252" fill="${beam}"/>`).join('')}
    <path d="M14 ${y + 236} L128 ${y + 16} M256 ${y + 16} L384 ${y + 236}" stroke="${beam}" stroke-width="12"/>
    <path d="M14 ${y + 140} L128 ${y + 140} M384 ${y + 140} L512 ${y + 140}" stroke="${beam}" stroke-width="10"/>
    ${win(162, y + 70)}${win(290, y + 70)}${win(420, y + 70)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${noise('n', 0.04, 3, 3)}
    <rect width="512" height="512" fill="#f1ebdd"/><rect width="512" height="512" filter="url(#n)" opacity="0.14"/>
    ${floor(0)}${floor(256)}</svg>`;
  return webp(svg, 512);
}

// One 8 m bay, 16 m tall: ashlar courses, plus one tall arched window for church walls.
export function stoneTexture(window = true) {
  let courses = '';
  for (let y = 0, row = 0; y < 512; y += 16, row++) {
    courses += `<rect x="0" y="${y + 14}" width="512" height="2" fill="#bdb3a3"/>`;
    for (let x = (row % 2) * 32; x < 512; x += 64) courses += `<rect x="${x}" y="${y}" width="2" height="16" fill="#bdb3a3"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${noise('n', 0.02, 4, 7)}
    <rect width="512" height="512" fill="#efe9de"/>${courses}<rect width="512" height="512" filter="url(#n)" opacity="0.18"/>
    ${window ? `<path d="M200 420 L200 150 Q256 70 312 150 L312 420 Z" fill="#3a3f45" stroke="#d6cdbd" stroke-width="10"/>
    <path d="M256 104 L256 420 M200 230 L312 230 M200 320 L312 320" stroke="#8a8478" stroke-width="5"/>` : ''}</svg>`;
  return webp(svg, 512);
}

export function roofTexture() {
  let rows = '';
  for (let y = 0; y < 256; y += 16) {
    rows += `<rect x="0" y="${y + 12}" width="256" height="4" fill="#9c9590"/>`;
    for (let x = (y / 16) % 2 ? 8 : 0; x < 256; x += 16) rows += `<rect x="${x}" y="${y}" width="1.5" height="12" fill="#b8b1aa"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">${noise('n', 0.05, 3, 11)}
    <rect width="256" height="256" fill="#f4efea"/>${rows}<rect width="256" height="256" filter="url(#n)" opacity="0.25"/></svg>`;
  return webp(svg, 256);
}

export function woodTexture() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.12" numOctaves="3" seed="5" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    <rect width="256" height="256" fill="#ffffff"/><rect width="256" height="256" filter="url(#g)" opacity="0.45"/></svg>`;
  return webp(svg, 256);
}

// Tileable ripple normal map from a noise height field.
export async function waterNormalTexture() {
  const size = 256;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${noise('n', '0.03 0.06', 3, 9)}<rect width="${size}" height="${size}" filter="url(#n)"/></svg>`;
  const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const h = (x, y) => data[((y + size) % size) * size + ((x + size) % size)] / 255;
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 3, dy = (h(x, y + 1) - h(x, y - 1)) * 3;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 3;
    out[i] = (-dx / l * 0.5 + 0.5) * 255; out[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out[i + 2] = (1 / l * 0.5 + 0.5) * 255;
  }
  return sharp(out, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 90 }).toBuffer();
}

const path = (ring) => 'M' + ring.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z';
const polyPath = (p) => [p.outer, ...p.holes].map(path).join('');
const linePath = (l) => 'M' + l.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L');

const AREA_FILL = { island: '#6f8746', grass: '#6f8746', forest: '#4b6230', scrub: '#6a7444', farmland: '#9b9160', vineyard: '#7b8848', plaza: '#a89d8b' };
const ROAD_FILL = (r) => (['footway', 'path', 'cycleway', 'track'].includes(r.kind) && !/sett|cobble|paving|asphalt/.test(r.surface || '') ? '#b4a689' : '#9a8f7f');

// Ground map seen from above, north up. Also returns raw masks (1 px per meter) used for terrain and scattering.
export async function groundTexture(f, radius, groundColor, size = 2048) {
  const r = radius;
  const view = `viewBox="${-r} ${-r} ${2 * r} ${2 * r}"`;
  const flip = (inner) => `<g transform="scale(1,-1)">${inner}</g>`;
  const roads = f.roads.slice().sort((a, b) => a.width - b.width);
  const areaOrder = ['farmland', 'vineyard', 'grass', 'scrub', 'forest', 'plaza'];
  const islands = f.areas.filter((a) => a.kind === 'island');
  const areas = f.areas.filter((a) => a.kind !== 'island').sort((a, b) => areaOrder.indexOf(a.kind) - areaOrder.indexOf(b.kind));
  const buildings = [...f.buildings, ...f.parts];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ${view}>
    <defs>${noise('n', 0.35, 4, 2).replace('x="0" y="0" width="100%" height="100%"', `x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" filterUnits="userSpaceOnUse"`)}
      <filter id="ao" filterUnits="userSpaceOnUse" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}"><feGaussianBlur stdDeviation="2.2"/></filter>
      <filter id="soft" filterUnits="userSpaceOnUse" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}"><feGaussianBlur stdDeviation="1.2"/></filter></defs>
    <rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" fill="${groundColor}"/>
    ${flip(`
      ${areas.map((a) => `<path d="${polyPath(a)}" fill="${AREA_FILL[a.kind]}" fill-rule="evenodd"/>`).join('')}
      <g fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#soft)">
        ${roads.filter((x) => !x.bridge).map((x) => `<path d="${linePath(x.line)}" stroke="${ROAD_FILL(x)}" stroke-width="${x.width}"/>`).join('')}
      </g>
      ${f.water.map((w) => `<path d="${polyPath(w)}" fill="#33464a" fill-rule="evenodd"/>`).join('')}
      ${islands.map((a) => `<path d="${polyPath(a)}" fill="${AREA_FILL.island}" fill-rule="evenodd"/>`).join('')}
      <g filter="url(#ao)" opacity="0.55">${buildings.map((b) => `<path d="${polyPath(b)}" fill="#1d1a16" stroke="#1d1a16" stroke-width="1.5"/>`).join('')}
        ${f.trees.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#1d1f12"/>`).join('')}</g>
    `)}
    <rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" filter="url(#n)" opacity="0.16"/></svg>`;
  const texture = await sharp(Buffer.from(svg)).resize(size, size).webp({ quality: 80 }).toBuffer();

  const px = Math.round(2 * r);
  const mask = async (inner) => {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ${view}><rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" fill="#000"/>${flip(inner)}</svg>`;
    const { data } = await sharp(Buffer.from(s)).greyscale().raw().toBuffer({ resolveWithObject: true });
    return (x, y) => {
      const i = Math.floor(x + r), j = Math.floor(r - y);
      return i < 0 || j < 0 || i >= px || j >= px ? 0 : data[j * px + i] / 255;
    };
  };
  const water = await mask(`<g filter="url(#b)"><defs><filter id="b" filterUnits="userSpaceOnUse" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}"><feGaussianBlur stdDeviation="5"/></filter></defs>${f.water.map((w) => `<path d="${polyPath(w)}" fill="#fff" fill-rule="evenodd"/>`).join('')}${islands.map((a) => `<path d="${polyPath(a)}" fill="#000"/>`).join('')}</g>`);
  const blocked = await mask(`${buildings.map((b) => `<path d="${polyPath(b)}" fill="#fff" stroke="#fff" stroke-width="3"/>`).join('')}
    ${f.water.map((w) => `<path d="${polyPath(w)}" fill="#fff" fill-rule="evenodd"/>`).join('')}
    <g fill="none" stroke="#fff">${f.roads.map((x) => `<path d="${linePath(x.line)}" stroke-width="${x.width + 2}"/>`).join('')}</g>`);
  return { texture, water, blocked };
}
