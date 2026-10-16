// OSM elements -> plain 2D features in local meters (x east, y north), clipped to the map circle.

export function projector([lat0, lon0]) {
  const k = 111_320;
  const kx = k * Math.cos((lat0 * Math.PI) / 180);
  return (p) => [(p.lon - lon0) * kx, (p.lat - lat0) * k];
}

const same = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;

export const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
};

const openRing = (r) => (r.length > 1 && same(r[0], r[r.length - 1]) ? r.slice(0, -1) : r);

// Joins way segments end to end into closed rings (multipolygon members).
function assembleRings(lines) {
  const rest = lines.map((l) => l.slice());
  const rings = [];
  while (rest.length) {
    let ring = rest.pop();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const l = rest[i];
        const end = ring[ring.length - 1];
        if (same(l[0], end)) ring = ring.concat(l.slice(1));
        else if (same(l[l.length - 1], end)) ring = ring.concat(l.slice(0, -1).reverse());
        else continue;
        rest.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length > 3) rings.push(openRing(ring));
  }
  return rings;
}

const inRing = ([x, y], r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const inPoly = (p, poly) => inRing(p, poly.outer) && !poly.holes.some((h) => inRing(p, h));

// Every closed area in an element as {outer, holes}, outer counter-clockwise, holes clockwise.
export function polygons(el, xy) {
  let outers = [], inners = [];
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 4) return [];
    const r = el.geometry.map(xy);
    if (!same(r[0], r[r.length - 1])) return [];
    outers = [openRing(r)];
  } else if (el.type === 'relation' && el.members) {
    const lines = (role) => el.members.filter((m) => m.type === 'way' && m.geometry && (m.role || 'outer') === role).map((m) => m.geometry.map(xy));
    outers = assembleRings(lines('outer'));
    inners = assembleRings(lines('inner'));
  }
  const ccw = (r, want) => ((ringArea(r) > 0) === want ? r : r.slice().reverse());
  return outers.map((o) => ({
    outer: ccw(o, true),
    holes: inners.filter((h) => inRing(h[0], o)).map((h) => ccw(h, false)),
  }));
}

// Sutherland-Hodgman against a convex clip ring (CCW). The subject may be concave.
export function clipRing(ring, clip) {
  let out = ring;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out.length >= 3 && Math.abs(ringArea(out)) > 0.5 ? out : null;
}

export const circleRing = (r, n = 96) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);

// Holes that cross the circle are dropped unless `keepCut`; clipped holes are fine for painting, not for meshing.
export function clipPoly(poly, clip, radius, keepCut = false) {
  const far = (r) => r.every(([x, y]) => Math.hypot(x, y) > radius) && !inRing([0, 0], r);
  if (far(poly.outer)) return null;
  const inside = poly.outer.every(([x, y]) => Math.hypot(x, y) <= radius);
  const outer = inside ? poly.outer : clipRing(poly.outer, clip);
  if (!outer) return null;
  const holes = poly.holes.flatMap((h) => {
    if (h.every(([x, y]) => Math.hypot(x, y) < radius - 1)) return [h];
    const c = keepCut ? clipRing(h, clip) : null;
    return c ? [c] : [];
  });
  return { outer, holes };
}

// Splits a polyline into the runs that lie inside the circle.
export function clipLine(line, radius) {
  const runs = [];
  let run = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const pin = Math.hypot(...p) <= radius;
    if (i > 0) {
      const q = line[i - 1];
      const qin = Math.hypot(...q) <= radius;
      if (pin !== qin) {
        let lo = 0, hi = 1;
        for (let k = 0; k < 30; k++) {
          const m = (lo + hi) / 2;
          const inside = Math.hypot(q[0] + (p[0] - q[0]) * m, q[1] + (p[1] - q[1]) * m) <= radius;
          if (inside === qin) lo = m; else hi = m;
        }
        const x = [q[0] + (p[0] - q[0]) * lo, q[1] + (p[1] - q[1]) * lo];
        run.push(x);
        if (!pin) { runs.push(run); run = []; } else run = [x];
      }
    }
    if (pin) run.push(p);
  }
  if (run.length > 1) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

export const lineLength = (l) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);

// Joins polylines that share endpoints into the longest possible chains, keeping the first line's direction.
// `directed` only joins head to tail, so rivers keep flowing downstream.
export function chainLines(lines, directed = false) {
  const rest = lines.map((l) => l.slice());
  const chains = [];
  while (rest.length) {
    let c = rest.shift();
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const l = rest[i];
        if (same(l[0], c[c.length - 1])) c = c.concat(l.slice(1));
        else if (same(l[l.length - 1], c[0])) c = l.concat(c.slice(1));
        else if (directed) continue;
        else if (same(l[l.length - 1], c[c.length - 1])) c = c.concat(l.slice(0, -1).reverse());
        else if (same(l[0], c[0])) c = l.slice(1).reverse().concat(c);
        else continue;
        rest.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push(c);
  }
  return chains.sort((a, b) => lineLength(b) - lineLength(a));
}

// Resamples a polyline to points about `step` meters apart.
export function resample(line, step) {
  const out = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    let d = step - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = line[line.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step * 0.3) out.push(last);
  return out;
}

export function offsetLine(line, d) {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / len) * d, p[1] + ((b[0] - a[0]) / len) * d];
  });
}

// Moving-average smoothing that keeps the end points.
export function smoothLine(line, passes = 2) {
  let l = line;
  for (let k = 0; k < passes; k++) {
    l = l.map((p, i) => (i === 0 || i === l.length - 1 ? p : [(l[i - 1][0] + 2 * p[0] + l[i + 1][0]) / 4, (l[i - 1][1] + 2 * p[1] + l[i + 1][1]) / 4]));
  }
  return l;
}

const num = (v) => {
  if (v == null) return undefined;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
const compass = (v) => (v == null ? undefined : COMPASS[String(v).toUpperCase()] ?? num(v));

const ROAD_WIDTH = {
  primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 6, living_street: 6, pedestrian: 9,
  service: 4, footway: 2.5, path: 2, cycleway: 2.5, steps: 2.5, track: 3,
};

const AREA_KIND = (t) => {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water) return 'water';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (t.landuse === 'vineyard') return 'vineyard';
  if (t.landuse === 'farmland' || t.landuse === 'allotments' || t.landuse === 'orchard') return 'farmland';
  if (['grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery'].includes(t.landuse) || t.leisure === 'park' || t.leisure === 'garden' || t.natural === 'grassland' || t.leisure === 'pitch' || t.leisure === 'playground') return 'grass';
  if (t.place === 'islet' || t.place === 'island') return 'island';
  if (t.place === 'square' || t['area:highway'] || (t.highway && t.area === 'yes') || t.amenity === 'parking' || t.man_made === 'bridge') return 'plaza';
  return null;
};

export function extract(elements, center, radius) {
  const xy = projector(center);
  const clip = circleRing(radius);
  const f = { buildings: [], parts: [], water: [], areas: [], roads: [], rivers: [], trees: [], walls: [], bridges: [], named: [] };

  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node') {
      const p = xy(el);
      if (t.natural === 'tree' && Math.hypot(...p) < radius - 4) f.trees.push(p);
      continue;
    }
    const isPart = t['building:part'] && t['building:part'] !== 'no';
    const isBuilding = t.building && t.building !== 'no' && !t.tunnel && t.location !== 'underground';
    if (isBuilding || isPart) {
      if (t.building === 'roof' && !isPart) continue;
      if (num(t.layer) < 0 || num(t['building:levels:underground']) && !t['building:levels'] && t.location === 'underground') continue;
      for (const poly of polygons(el, xy)) {
        const c = clipPoly(poly, clip, radius);
        if (!c) continue;
        const b = {
          id: el.id, name: t.name, outer: c.outer, holes: c.holes, clipped: c.outer !== poly.outer,
          height: num(t.height), minHeight: num(t.min_height) ?? (num(t['building:min_level']) != null ? num(t['building:min_level']) * 3.2 : 0),
          levels: num(t['building:levels']), roofShape: t['roof:shape'], roofHeight: num(t['roof:height']), roofLevels: num(t['roof:levels']),
          color: t['building:colour'], roofColor: t['roof:colour'], material: t['building:material'], roofDirection: compass(t['roof:direction']), kind: t.building || t['building:part'],
          landmark: ['church', 'cathedral', 'chapel', 'castle', 'tower'].includes(t.building) || ['church', 'tower'].includes(t['building:part']) || t.historic === 'castle' || t.amenity === 'place_of_worship' || t.man_made === 'tower',
        };
        (isPart ? f.parts : f.buildings).push(b);
      }
      if (t.name) f.named.push({ name: t.name, el });
      continue;
    }
    if (t.barrier === 'city_wall' || t.historic === 'citywalls') {
      if (el.geometry) for (const run of clipLine(el.geometry.map(xy), radius)) f.walls.push(run);
      continue;
    }
    const kind = AREA_KIND(t);
    if (kind && (el.type === 'relation' || (el.geometry && el.geometry.length > 3 && same(xy(el.geometry[0]), xy(el.geometry[el.geometry.length - 1]))))) {
      if (t.water === 'fountain' || t.covered === 'yes' || t.tunnel || num(t.layer) < 0 || t.location === 'underground') continue;
      for (const poly of polygons(el, xy)) {
        const c = clipPoly(poly, clip, radius, true);
        if (!c) continue;
        if (kind === 'water') f.water.push({ ...c, name: t.name });
        else f.areas.push({ ...c, kind, name: t.name });
        if (t.man_made === 'bridge') f.bridges.push(c);
      }
      if (t.name) f.named.push({ name: t.name, el });
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const line = el.geometry.map(xy);
    if (t.waterway === 'river' || t.waterway === 'canal' || t.waterway === 'stream') {
      if (t.tunnel || num(t.layer) < 0) continue;
      for (const run of clipLine(line, radius)) f.rivers.push({ name: t.name || '', kind: t.waterway, line: run });
    } else if (t.highway && ROAD_WIDTH[t.highway] && !t.tunnel && !(num(t.layer) < 0) && t.indoor !== 'yes' && t.level == null) {
      const width = num(t.width) ?? ROAD_WIDTH[t.highway];
      for (const run of clipLine(line, radius + 30)) f.roads.push({ name: t.name || '', kind: t.highway, width, bridge: t.bridge === 'yes' || t.bridge === 'viaduct', line: run, surface: t.surface });
    } else if (t.natural === 'tree_row') {
      for (const run of clipLine(line, radius - 4)) f.trees.push(...resample(run, 9));
    }
    if (t.name) f.named.push({ name: t.name, el });
  }
  return f;
}
