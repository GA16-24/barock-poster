import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FRAME_STYLES, MAP, CORNICE, ARCH, PRINT, ZONES } from './catalog.js';
import { canvasTexture } from './book.js';
import { POSTER_WIDTH_M } from './poster.js?v=7';

// What holds the props: shadow-box niches with their drapes, the cornice, the arch around the poster, the map
// console, dust and the gold links between things. Everything here is procedural, so the room has no extra assets to load.
const WARM = new THREE.Color(1, 0.78, 0.4);
const BORDER = 0.022;
const GILT = { color: 0xd8aa4a, metalness: 0.9, roughness: 0.3 };

function outline(shape, w, h) {
  const p = new THREE.Shape();
  if (shape === 'oval') p.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
  else p.moveTo(-w / 2, -h / 2).lineTo(w / 2, -h / 2).lineTo(w / 2, h / 2).lineTo(-w / 2, h / 2).closePath();
  return p;
}

// A flat moulding: an outline with a hole, `thick` deep, its back at z0. Bevels grow the solid by `bevel` all round.
function ring(shape, w, h, border, z0, thick, bevel) {
  const s = outline(shape, w - 2 * bevel, h - 2 * bevel);
  s.holes.push(outline(shape, w - 2 * border + 2 * bevel, h - 2 * border + 2 * bevel));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick - 2 * bevel, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 48 });
  return g.translate(0, 0, z0 + bevel);
}

// The frame is the outer moulding (group 0) and, if `lip`, a gilt inner lip (group 1).
const frameGeos = new Map();
function frameGeometry(shape, w, h, depth, lip) {
  const key = [shape, w, h, depth, lip].join();
  if (!frameGeos.has(key)) {
    const layers = [ring(shape, w, h, BORDER, depth - 0.032, 0.032, 0.005)];
    if (lip) layers.push(ring(shape, w - 2 * BORDER + 0.014, h - 2 * BORDER + 0.014, 0.011, depth - 0.02, 0.026, 0.003));
    frameGeos.set(key, mergeGeometries(layers, true));
  }
  return frameGeos.get(key);
}

// A fixed seed, so every load draws the same grain.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function grain(ctx, w, h, base, dark, light, n) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = rnd() < 0.5 ? dark : light;
    ctx.globalAlpha = 0.08 + rnd() * 0.2;
    ctx.lineWidth = 0.5 + rnd() * 2.5;
    const y = rnd() * h, a = rnd() * 6.3, k = 2 + rnd() * 6;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin((x / w) * k + a) * 6 + Math.sin(x / 17 + a) * 1.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// Shadow baked into the edges of a lining, so things read as sitting inside the box.
function edges(ctx, w, h, k = 0.7) {
  for (const [x0, y0, x1, y1] of [[0, 0, 0, h * 0.5], [0, h, 0, h * 0.75], [0, 0, w * 0.3, 0], [w, 0, w * 0.7, 0]]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${k})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
function speckle(ctx, w, h, n, a, b) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? a : b},${0.05 + rnd() * 0.12})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2);
  }
}
function weave(ctx, w, h, a) {
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  for (let i = 0; i < w; i += 3) ctx.fillRect(i, 0, 1, h);
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  for (let i = 0; i < h; i += 3) ctx.fillRect(0, i, w, 1);
}
function damask(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 6, w / 2, h / 2, w * 0.78);
  g.addColorStop(0, '#245466');
  g.addColorStop(1, '#0b1f2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(236,210,140,0.16)';
  ctx.fillStyle = 'rgba(236,210,140,0.22)';
  for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x + 16, y);
    ctx.lineTo(x + 32, y + 16);
    ctx.lineTo(x + 16, y + 32);
    ctx.lineTo(x, y + 16);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 16, y + 16, 2.2, 0, 7);
    ctx.fill();
  }
}

const DRAW = {
  velvet(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 6, w / 2, h / 2, w * 0.75);
    g.addColorStop(0, '#9a2234');
    g.addColorStop(1, '#4a0c18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1800, '30,6,10', '170,50,70');
    edges(ctx, w, h);
  },
  linen(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 6, w / 2, h / 2, w * 0.75);
    g.addColorStop(0, '#d8ccad');
    g.addColorStop(1, '#8e8366');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    weave(ctx, w, h, 0.06);
    edges(ctx, w, h, 0.55);
  },
  damask,
  lacquer: (ctx, w, h) => grain(ctx, w, h, '#16100d', '#050303', '#3a2a1e', 60),
  pine(ctx, w, h) {
    grain(ctx, w, h, '#a8763f', '#5e3b1c', '#c99a62', 160);
    ctx.fillStyle = 'rgba(50,28,10,0.7)';
    for (let y = 0; y < h; y += h / 4) ctx.fillRect(0, y, w, 3);
    speckle(ctx, w, h, 60, '60,36,14', '60,36,14');
  },
  // Drapes: vertical folds as light and dark bands, so squeezing the drape to its side packs the folds tighter.
  velvetDrape(ctx, w, h) {
    for (let x = 0; x < w; x++) {
      const f = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 12);
      ctx.fillStyle = `rgb(${70 + f * 80},${10 + f * 16},${22 + f * 22})`;
      ctx.fillRect(x, 0, 1, h);
    }
    ctx.fillStyle = '#d8aa4a';
    ctx.fillRect(0, h * 0.93, w, h * 0.07);
    ctx.fillStyle = 'rgba(80,50,10,0.6)';
    for (let x = 0; x < w; x += 4) ctx.fillRect(x, h * 0.95, 1, h * 0.05);
  },
  linenDrape(ctx, w, h) {
    for (let x = 0; x < w; x++) {
      const f = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 10);
      ctx.fillStyle = `rgb(${160 + f * 62},${150 + f * 58},${122 + f * 50})`;
      ctx.fillRect(x, 0, 1, h);
    }
    weave(ctx, w, h, 0.05);
    ctx.fillStyle = 'rgba(90,70,40,0.5)';
    ctx.fillRect(0, h * 0.94, w, 2);
  },
};
const textures = {};
function texture(name, repeat = 1) {
  return textures[name + repeat] ??= Object.assign(canvasTexture(256, 256, DRAW[name]), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, repeat: new THREE.Vector2(repeat, repeat) });
}

// The frame UVs are positions in meters, so the grain repeats every third of a meter.
const FRAME_MAT = {
  lacquer: () => new THREE.MeshStandardMaterial({ map: texture('lacquer', 3), roughness: 0.22, metalness: 0.1 }),
  pine: () => new THREE.MeshStandardMaterial({ map: texture('pine', 3), roughness: 0.85 }),
  gilt: () => new THREE.MeshStandardMaterial(GILT),
};

// Turns the part of a single-mesh model that lies in a disc (the spinning wheel) about the wall normal. The disc is
// given in the model's own coordinates: `center` [x, y], `radius`, and the `z` range the wheel occupies, so the
// frame and the treadle beside it stay put. Returns the uniform that holds the angle.
export function spinPart(mat, { center, radius, z }) {
  const angle = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAngle = angle;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uAngle;\nmat2 spinM(vec3 p) {
        vec2 d = p.xy - vec2(${center[0]}, ${center[1]});
        float on = step(length(d), ${radius}) * step(${z[0]}, p.z) * step(p.z, ${z[1]});
        float a = uAngle * on;
        return mat2(cos(a), sin(a), -sin(a), cos(a));
      }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { mat2 R = spinM(position); objectNormal.xy = R * objectNormal.xy; }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { mat2 R = spinM(position); vec2 c = vec2(${center[0]}, ${center[1]}); transformed.xy = c + R * (position.xy - c); }`);
  };
  mat.customProgramCacheKey = () => `spin${center}${radius}${z}`;
  return angle;
}

// A niche is a shallow shadow box: moulded frame, lined sides, a colored back and a dark veil in front that dims
// whatever hangs behind it. Its back sits on the wall (z = 0) and it opens toward +z. Cases of the two estates also
// have a pair of drapes that part from the middle and gather at the sides of the opening.
export function buildNiche({ shape, w, h, depth, style }) {
  const S = FRAME_STYLES[style];
  const group = new THREE.Group();
  const oval = shape === 'oval';
  const ow = w - 2 * BORDER + 0.004, oh = h - 2 * BORDER + 0.004;

  const frameMats = [FRAME_MAT[S.frame](), new THREE.MeshStandardMaterial(GILT)];
  const frame = new THREE.Mesh(frameGeometry(shape, w, h, depth, S.lip), frameMats);
  frame.receiveShadow = true;

  const sideMat = new THREE.MeshStandardMaterial({ color: S.side, roughness: 1, side: THREE.BackSide });
  const backMat = new THREE.MeshStandardMaterial({ map: texture(S.back), emissiveMap: texture(S.back), emissive: 0x000000, roughness: 0.95 });
  const sides = oval
    ? new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, depth, 48, 1, true).rotateX(Math.PI / 2).translate(0, 0, depth / 2), sideMat)
    : new THREE.Mesh(new THREE.BoxGeometry(1, 1, depth).translate(0, 0, depth / 2), sideMat);
  sides.scale.set(ow, oh, 1);
  const back = new THREE.Mesh(oval ? new THREE.CircleGeometry(0.5, 48) : new THREE.PlaneGeometry(1, 1), backMat);
  back.scale.set(ow, oh, 1);
  back.position.z = 0.004;
  sides.receiveShadow = back.receiveShadow = true;
  const interior = new THREE.Group();
  interior.add(sides, back);

  const drapes = S.drape ? [-1, 1].map((s) => {
    const m = new THREE.Mesh(drapeGeometry, new THREE.MeshStandardMaterial({ map: texture(`${S.drape}Drape`), roughness: S.drape === 'velvet' ? 0.75 : 0.95, side: THREE.DoubleSide }));
    m.position.set(s * ow / 2, 0, depth - 0.014);
    m.receiveShadow = true;
    interior.add(m);
    return m;
  }) : [];

  const veil = new THREE.Mesh(
    oval ? new THREE.CircleGeometry(0.5, 48) : new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x07050a, transparent: true, opacity: 0, depthWrite: false }),
  );
  veil.scale.set(ow, oh, 1);
  veil.position.z = depth - 0.006;
  veil.renderOrder = 2;
  veil.visible = false;
  // Soft shade on the real wall around the case, so it reads as mounted there rather than pasted over the image.
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * HALO, h * HALO), new THREE.MeshBasicMaterial({ map: haloTexture(oval), transparent: true, depthWrite: false }));
  halo.position.z = 0.002;
  group.add(halo, interior, frame, veil);

  return {
    group,
    // grow: 0..1 the closed case comes out of the wall. open: 0..1 the drapes part. glow lights the niche, dim darkens it.
    set(grow, glow, dim, open = 1) {
      group.visible = grow > 0.001;
      group.scale.set(0.9 + 0.1 * grow, 0.9 + 0.1 * grow, Math.max(grow, 0.001));
      frame.castShadow = grow >= 1;
      for (const d of drapes) d.scale.set(-Math.sign(d.position.x) * (ow / 2) * (1 - 0.93 * open), oh, 1);
      backMat.emissive.copy(WARM).multiplyScalar(glow * 0.4);
      for (const m of frameMats) m.emissive.copy(WARM).multiplyScalar(glow * 0.22);
      veil.material.opacity = dim * 0.6;
      veil.visible = dim > 0.01;
    },
  };
}
// Black with an alpha that is full under the case and fades out over its margin; the case covers the inside.
const HALO = 1.5;
const halos = {};
function haloTexture(oval) {
  return halos[oval] ??= canvasTexture(128, 128, (ctx, w, h) => {
    const img = ctx.createImageData(w, h), inner = 1 / HALO;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.abs((x + 0.5) / w * 2 - 1), v = Math.abs((y + 0.5) / h * 2 - 1);
      const out = oval ? Math.hypot(u, v) - inner : Math.hypot(Math.max(u - inner, 0), Math.max(v - inner, 0));
      img.data[(y * w + x) * 4 + 3] = 150 * Math.max(0, 1 - out / (1 - inner)) ** 2.2;
    }
    ctx.putImageData(img, 0, 0);
  });
}

// One drape half, its hinge at x = 0 and its free edge at x = 1, rippled in z so the folds catch the light.
const drapeGeometry = (() => {
  const g = new THREE.PlaneGeometry(1, 1, 24, 1).translate(0.5, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.006 * Math.sin(p.getX(i) * Math.PI * 6));
  g.computeVertexNormals();
  return g;
})();

function cartoucheTexture() {
  return canvasTexture(1024, 384, (ctx, w, h) => {
    const cx = w / 2, cy = h * 0.56;
    const rim = ctx.createLinearGradient(0, 0, 0, h);
    rim.addColorStop(0, '#fbe7a6');
    rim.addColorStop(0.45, '#c99a3c');
    rim.addColorStop(1, '#6e4c16');
    ctx.fillStyle = rim;
    ctx.strokeStyle = '#5a3c10';
    ctx.lineWidth = 5;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 330, cy - 60);
      ctx.bezierCurveTo(cx + s * 470, cy - 130, cx + s * 515, cy + 30, cx + s * 440, cy + 80);
      ctx.bezierCurveTo(cx + s * 400, cy + 100, cx + s * 360, cy + 60, cx + s * 395, cy + 40);
      ctx.bezierCurveTo(cx + s * 430, cy + 20, cx + s * 420, cy - 50, cx + s * 330, cy + 40);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI;
      ctx.lineTo(cx + Math.cos(a) * 70, cy - 112 + Math.sin(a) * 62 * (i % 2 ? 0.7 : 1));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, 360, 118, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const field = ctx.createRadialGradient(cx, cy - 20, 20, cx, cy, 340);
    field.addColorStop(0, '#1f4a5c');
    field.addColorStop(1, '#081820');
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 332, 94, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}
// The gilt cornice over everything: a lacquer frieze between a bead below and a moulded cap above, with the poets'
// cartouche in the middle. It grows outward from the cartouche.
export function buildCornice() {
  const { halfWidth: hw, y, frieze } = CORNICE;
  const group = new THREE.Group();
  const gilt = new THREE.MeshStandardMaterial(GILT);
  // The key light mirrors almost straight into the viewer off the flat frieze and cartouche; glossy, they read as a
  // pale grey band.
  const lacquer = new THREE.MeshStandardMaterial({ map: texture('lacquer', 3), roughness: 0.85, metalness: 0.1 });
  const band = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2 * hw, frieze, 0.05).translate(0, y + frieze / 2, 0.025), lacquer);
  const bead = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 2 * hw, 10).rotateZ(Math.PI / 2).translate(0, y, 0.05), gilt);
  const profile = new THREE.Shape().moveTo(0, 0).lineTo(0.056, 0).lineTo(0.06, 0.007)
    .bezierCurveTo(0.062, 0.02, 0.085, 0.018, 0.088, 0.032).lineTo(0.088, 0.044).lineTo(0, 0.044).closePath();
  const cap = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 2 * hw, bevelEnabled: false, curveSegments: 8 })
    .rotateY(-Math.PI / 2).translate(hw, y + frieze, 0), gilt);
  for (const m of [body, bead, cap]) m.castShadow = m.receiveShadow = true;
  band.add(body, bead, cap);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.195), new THREE.MeshStandardMaterial({ map: cartoucheTexture(), alphaTest: 0.5, metalness: 0.35, roughness: 0.75 }));
  plate.position.set(0, y + frieze / 2 - 0.004, 0.095);
  group.add(band, plate);
  return {
    group,
    set(grow, pop) {
      band.visible = grow > 0.001;
      band.scale.x = Math.max(grow, 0.001);
      plate.visible = pop > 0.001;
      plate.scale.setScalar(Math.max(pop, 0.001));
    },
  };
}

// The gilt portal: a sill with a scroll at each foot, two jambs and a round head with keystone and finial. It rises
// from its sill.
export function buildArch() {
  const { halfWidth: w, band, base, spring } = ARCH, i = w - band, top = spring - base;
  const shape = new THREE.Shape().moveTo(-w, 0).lineTo(w, 0).lineTo(w, top).absarc(0, top, w, 0, Math.PI, false).closePath();
  shape.holes.push(new THREE.Path().moveTo(-i, band).lineTo(-i, top).absarc(0, top, i, Math.PI, 0, true).lineTo(i, band).closePath());
  const gilt = new THREE.MeshStandardMaterial(GILT);
  const parts = [
    new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 32 }),
    new THREE.BoxGeometry(0.022, 0.03, 0.024).translate(0, top + w, 0.008),
    new THREE.SphereGeometry(0.012, 12, 8).translate(0, top + w + 0.025, 0.008),
    new THREE.BoxGeometry(2 * w + 0.05, 0.018, 0.06).translate(0, 0.009, 0.026),
    ...[-1, 1].map((s) => new THREE.TorusGeometry(0.024, 0.006, 6, 20, Math.PI * 1.3).rotateZ(s > 0 ? -0.15 : Math.PI + 0.15 - Math.PI * 0.3).translate(s * (w + 0.026), 0.024, 0.008)),
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), gilt);
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.position.set(0, base, 0.004);
  group.add(mesh);
  return {
    group,
    set(u) {
      group.visible = u > 0.001;
      group.scale.set(0.6 + 0.4 * u, Math.max(u, 0.001), 1);
    },
  };
}

// The round dark console under the map, with a gilt rim, held from the wall by an arm and two braces. It slides out
// of the wall.
export function buildConsole() {
  const [mx, my, mz] = MAP.at;
  const top = my - 0.106, radius = MAP.size / 2 + 0.02;
  const lacquer = new THREE.MeshStandardMaterial({ map: texture('lacquer', 2), roughness: 0.3, metalness: 0.1 });
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts = [new THREE.CylinderGeometry(radius, radius - 0.025, 0.035, 64).translate(mx, top - 0.0175, mz), box(0.34, 0.03, mz, mx, top - 0.05, mz / 2)];
  for (const x of [-0.16, 0.16]) {
    const run = mz - 0.12, drop = 0.3;
    parts.push(new THREE.BoxGeometry(0.03, Math.hypot(run, drop), 0.03).rotateX(Math.atan2(run, drop)).translate(mx + x, top - 0.05 - drop / 2, run / 2), box(0.06, 0.38, 0.02, mx + x, top - 0.2, 0.01));
  }
  const body = new THREE.Mesh(mergeGeometries(parts), lacquer);
  body.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.003, 0.008, 8, 96).rotateX(Math.PI / 2).translate(mx, top, mz), new THREE.MeshStandardMaterial(GILT));
  const group = new THREE.Group();
  group.add(body, rim);
  return {
    group,
    set(u) {
      group.visible = u > 0.001;
      group.scale.z = Math.max(u, 0.001);
    },
  };
}

// Motes of gold dust drifting up through the light, each a soft glowing disc that twinkles on its own beat.
const moteTexture = () => canvasTexture(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,240,200,0.85)');
  g.addColorStop(0.45, 'rgba(255,200,110,0.22)');
  g.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});
// Over the estates the gold takes the poster's colors: orange toward the Adel, teal toward the Volk.
const GOLD = new THREE.Color(1, 0.86, 0.6);
const tintAt = (x) => GOLD.clone().lerp(new THREE.Color(ZONES[x < 0 ? 'adel' : 'volk'].tone), Math.min(1, Math.abs(x) / 1.1) * 0.75);
export function buildDust(n = 90) {
  const seeds = Array.from({ length: n }, () => ({ x: Math.random() * 2.4 - 1.2, y: Math.random() * 1.6, z: 0.1 + Math.random() * 0.6, s: 0.01 + Math.random() * 0.02, p: Math.random() * 6.28, f: 1.5 + Math.random() * 3 }));
  for (const d of seeds) d.tint = tintAt(d.x);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: moteTexture(), vertexColors: true, size: 0.022, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  points.frustumCulled = false;
  return {
    points,
    update(t) {
      const a = geo.attributes.position, c = geo.attributes.color;
      seeds.forEach((d, i) => {
        const y = (d.y + t * d.s) % 1.6;
        // Fade in at the bottom and out at the top, so no mote pops at the wrap.
        const k = Math.min(1, y * 4, (1.6 - y) * 4) * (0.35 + 0.65 * Math.max(0, Math.sin(t * d.f + d.p)) ** 3);
        a.setXYZ(i, d.x + Math.sin(t * 0.3 + d.p) * 0.04, y - 0.8, d.z + Math.cos(t * 0.23 + d.p) * 0.03);
        c.setXYZ(i, d.tint.r * k, d.tint.g * k, d.tint.b * k);
      });
      a.needsUpdate = c.needsUpdate = true;
    },
  };
}

// The poster's own ink, lit from inside: a plane over the print that adds the letters' colors back onto them, so the
// printed word glows in register with the paper. `set` drives it each frame:
//   reveal  0..1  at the entrance a ring of light blooms out from the middle of the underline across the word;
//   focus   [side, strength]  side 0 lights the orange (Adel) end, 1 the teal (Volk) end, 0.5 the whole word;
//   lock    0..1  how sure the pose is; held poses drift a little, and a glow beside the letters would show it.
// A gleam also crosses the word from B to k every few seconds, and a spark runs along the underline toward the focus.
export function buildPrint() {
  const uniforms = {
    map: { value: null }, time: { value: 0 }, reveal: { value: 0 }, focus: { value: new THREE.Vector2(0.5, 0) }, lock: { value: 0 },
    line: { value: new THREE.Vector2(PRINT.underline.v, PRINT.underline.half) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D map; uniform float time, reveal, lock; uniform vec2 focus, line;
      varying vec2 vUv;
      void main() {
        vec4 ink = texture2D(map, vUv);
        float d = length((vUv - vec2(0.5, line.x)) * vec2(1.5, 1.0));
        float ring = exp(-pow((d - reveal * 0.9) / 0.07, 2.0)) * (1.0 - reveal);
        float sweep = exp(-pow((vUv.x + 0.25 * vUv.y - mix(-0.3, 1.5, fract(time / 7.0))) / 0.04, 2.0));
        float side = abs(focus.x - 0.5) < 0.01 ? 1.0 : exp(-pow((vUv.x - focus.x) / 0.3, 2.0));
        float lit = 0.12 * reveal + 1.6 * ring + 0.9 * sweep + focus.y * side * (0.35 + 0.12 * sin(time * 3.0));
        float onLine = step(abs(vUv.y - line.x), 0.009) * step(abs(vUv.x - 0.5), line.y);
        // Toward the focused end, or end to end for the whole word.
        float dir = abs(focus.x - 0.5) < 0.01 ? 0.0 : sign(focus.x - 0.5), run = fract(time * 0.6);
        float spark = dir == 0.0 ? 0.5 + line.y * (2.0 * run - 1.0) : 0.5 + dir * line.y * run;
        lit += onLine * focus.y * 3.0 * exp(-pow((vUv.x - spark) / 0.015, 2.0));
        gl_FragColor = vec4(ink.rgb * lit + vec3(1.0, 0.9, 0.7) * sweep * 0.35, ink.a * lock);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.position.z = 0.001;
  mesh.visible = false;
  new THREE.TextureLoader().load(PRINT.letters, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    uniforms.map.value = t;
    mesh.scale.set(POSTER_WIDTH_M, POSTER_WIDTH_M * t.image.height / t.image.width, 1);
  }, undefined, () => console.warn(`Schrift des Plakats fehlt: ${PRINT.letters}`));
  return {
    mesh,
    set(t, reveal, focus, lock) {
      uniforms.time.value = t;
      uniforms.reveal.value = reveal;
      uniforms.focus.value.copy(focus);
      uniforms.lock.value = lock;
      mesh.visible = !!uniforms.map.value && lock > 0.01 && reveal > 0;
    },
  };
}

// A gold thread drawn from one thing to another, with a bead of light running along it. `set` aims it at a new path
// and restarts the draw; `goal` 0 pulls it back to where it started.
const SEGMENTS = 56;
const THREAD = new THREE.Color(0xf6dc96);
export function createLink() {
  const group = new THREE.Group();
  group.visible = false;
  const core = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const halo = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c4, toneMapped: false }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  group.add(core, halo, bead, glow);
  let curve = null, p = 0, goal = 0;
  return {
    group,
    // `from` and `to` color the ends; a thread between the estates runs from the poster's orange to its teal.
    set(points, from = THREAD, to = THREAD) {
      curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      for (const [m, r, radial, k] of [[core, 0.0038, 6, 1], [halo, 0.011, 8, 0.85]]) {
        m.geometry.dispose();
        m.geometry = new THREE.TubeGeometry(curve, SEGMENTS, r, radial);
        m.userData.radial = radial;
        const colors = new Float32Array(m.geometry.attributes.position.count * 3), c = new THREE.Color();
        for (let i = 0; i < colors.length / 3; i++) c.lerpColors(from, to, Math.floor(i / (radial + 1)) / SEGMENTS).multiplyScalar(k).toArray(colors, i * 3);
        m.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      p = 0;
      goal = 1;
    },
    release() { goal = 0; },
    update(t, dt) {
      p += (goal - p) * (1 - Math.exp(-dt * (goal ? 4 : 9)));
      group.visible = !!curve && p > 0.01;
      if (!group.visible) return;
      for (const m of [core, halo]) m.geometry.setDrawRange(0, Math.floor(p * SEGMENTS) * m.userData.radial * 6);
      const u = ((t * 0.5) % 1) * p;
      bead.position.copy(curve.getPointAt(u));
      glow.position.copy(bead.position);
      glow.scale.setScalar(0.8 + 0.3 * Math.sin(t * 9));
    },
  };
}
