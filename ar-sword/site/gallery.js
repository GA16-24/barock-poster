import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FRAME_STYLES, MAP } from './catalog.js';
import { canvasTexture } from './book.js';

// What holds the props: shadow-box niches, the title rules, the map table, dust and the gold links between things.
// Everything here is procedural, so the room has no extra assets to load.
const WARM = new THREE.Color(1, 0.78, 0.4);
const BORDER = 0.026;
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

const frameGeos = new Map();
function frameGeometry(shape, w, h, depth, ridge) {
  const key = [shape, w, h, depth, ridge].join();
  if (!frameGeos.has(key)) {
    const layers = [ring(shape, w, h, BORDER, depth - 0.032, 0.032, 0.005)];
    if (ridge) layers.push(ring(shape, w - 0.008, h - 0.008, 0.011 + 0.004, depth - 0.016, 0.03, 0.004));
    frameGeos.set(key, mergeGeometries(layers));
  }
  return frameGeos.get(key);
}

const backTextures = {};
function backTexture(style) {
  const s = FRAME_STYLES[style];
  return backTextures[style] ??= canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 6, w / 2, h / 2, w * 0.78);
    g.addColorStop(0, s.back[1]);
    g.addColorStop(1, s.back[0]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (s.weave === 'damask') {
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
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      for (let i = 0; i < w; i += 3) {
        ctx.fillRect(i, 0, 1, h);
        ctx.fillRect(0, i, w, 1);
      }
    }
  });
}

// The frame traces itself: a clockwise wipe from the top around the frame center, with a bright head at the leading
// edge. Shadows come from a depth material that ignores the wipe, so a frame only casts one once it is complete.
function wipe(mat) {
  const draw = { value: 0 };
  mat.userData.draw = draw;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDraw = draw;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFp = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFp;\nuniform float uDraw;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float sw = fract(atan(vFp.x, vFp.y) / 6.2831853);
        if (sw > uDraw) discard;
        totalEmissiveRadiance += vec3(1.0, 0.82, 0.45) * smoothstep(uDraw - 0.07, uDraw, sw) * step(uDraw, 0.999) * 3.0;`);
  };
  mat.customProgramCacheKey = () => 'wipe';
  return mat;
}

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

// A niche is a shallow shadow box: moulded frame, lined sides, a patterned back and a dark veil in front that dims
// whatever hangs behind it. Its back sits on the wall (z = 0) and it opens toward +z.
export function buildNiche({ shape, w, h, depth, style }) {
  const S = FRAME_STYLES[style];
  const group = new THREE.Group();
  const oval = shape === 'oval';
  const ow = w - 2 * BORDER + 0.004, oh = h - 2 * BORDER + 0.004;

  const frameMat = wipe(new THREE.MeshStandardMaterial({ color: S.frame, metalness: S.metal, roughness: S.rough }));
  const frame = new THREE.Mesh(frameGeometry(shape, w, h, depth, S.ridge), frameMat);
  frame.receiveShadow = true;

  const sideMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(S.back[0]).multiplyScalar(0.8), roughness: 1, side: THREE.BackSide });
  const backMat = new THREE.MeshStandardMaterial({ map: backTexture(style), emissiveMap: backTexture(style), emissive: 0x000000, roughness: 0.95 });
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

  const veil = new THREE.Mesh(
    oval ? new THREE.CircleGeometry(0.5, 48) : new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x07050a, transparent: true, opacity: 0, depthWrite: false }),
  );
  veil.scale.set(ow, oh, 1);
  veil.position.z = depth - 0.006;
  veil.renderOrder = 2;
  veil.visible = false;
  group.add(interior, frame, veil);

  return {
    group, depth, w, h, frame, oval,
    // draw: 0..1 the frame traces itself, then the lining unrolls. glow lights the niche, dim darkens it.
    set(draw, glow, dim) {
      frameMat.userData.draw.value = draw >= 1 ? 1.01 : draw;
      interior.visible = draw > 0.8;
      interior.scale.y = Math.max((draw - 0.8) / 0.2, 0.001);
      frame.castShadow = draw >= 1;
      backMat.emissive.copy(WARM).multiplyScalar(glow * 0.4);
      frameMat.emissive.copy(WARM).multiplyScalar(glow * 0.22);
      veil.material.opacity = dim * 0.6;
      veil.visible = dim > 0.01;
    },
  };
}

// A double rule that grows outward from a title, as the gold line that carries each zone name.
export function buildRule(span, gap, y) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xe6bf62, toneMapped: false });
  const half = (span - gap) / 2;
  const halves = [-1, 1].map((s) => {
    const g = new THREE.Group();
    const main = new THREE.Mesh(new THREE.PlaneGeometry(half, 0.004).translate(half / 2, 0, 0), mat);
    const fine = new THREE.Mesh(new THREE.PlaneGeometry(half * 0.8, 0.0015).translate(half * 0.4, -0.009, 0), mat);
    const tip = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.016).rotateZ(Math.PI / 4).translate(half, 0, 0), mat);
    g.add(main, fine, tip);
    g.position.x = (gap / 2) * s;
    g.scale.x = s;
    return { g, tip };
  });
  group.add(...halves.map((h) => h.g));
  group.position.y = y;
  return {
    group,
    set(u) {
      group.visible = u > 0.001;
      for (const { g, tip } of halves) {
        g.scale.x = Math.sign(g.scale.x) * Math.max(u, 0.001);
        tip.visible = u > 0.98;
      }
    },
  };
}

// The display table for the map: a gilt ring under the disc and two scrolled brackets that hold it from the wall.
export function buildTable() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial(GILT);
  const [mx, my, mz] = MAP.at;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(MAP.size * 0.5, 0.012, 8, 72).rotateX(Math.PI / 2), mat);
  ring.position.set(mx, my - 0.106, mz);
  const SEG = 40, RAD = 8;
  const brackets = [-0.22, 0.22].map((x) => {
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(mx + x, my + 0.28, 0.012), new THREE.Vector3(mx + x, my - 0.04, 0.012),
      new THREE.Vector3(mx + x, my - 0.108, 0.08), new THREE.Vector3(mx + x, my - 0.108, mz - 0.42),
    );
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, SEG, 0.011, RAD), mat);
    mesh.receiveShadow = true;
    return mesh;
  });
  group.add(ring, ...brackets);
  return {
    group,
    set(u) {
      group.visible = u > 0.001;
      ring.scale.setScalar(Math.max(u, 0.001));
      for (const b of brackets) b.geometry.setDrawRange(0, Math.floor(u * SEG) * RAD * 6);
    },
  };
}

// A little floating dust in the light, drifting upward and wrapping around.
export function buildDust(n = 70) {
  const seeds = Array.from({ length: n }, () => ({ x: Math.random() * 2.4 - 1.2, y: Math.random() * 1.6, z: 0.1 + Math.random() * 0.6, s: 0.01 + Math.random() * 0.02, p: Math.random() * 6.28 }));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffe2a0, size: 0.008, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  points.frustumCulled = false;
  return {
    points,
    update(t) {
      const a = geo.attributes.position;
      seeds.forEach((d, i) => a.setXYZ(i, d.x + Math.sin(t * 0.3 + d.p) * 0.04, ((d.y + t * d.s) % 1.6) - 0.8, d.z + Math.cos(t * 0.23 + d.p) * 0.03));
      a.needsUpdate = true;
    },
  };
}

// A gold thread drawn from one thing to another, with a bead of light running along it. `set` aims it at a new path
// and restarts the draw; `goal` 0 pulls it back to where it started.
const SEGMENTS = 56;
export function createLink() {
  const group = new THREE.Group();
  group.visible = false;
  const core = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xf6dc96, toneMapped: false }));
  const halo = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xe0a83a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c4, toneMapped: false }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  group.add(core, halo, bead, glow);
  let curve = null, p = 0, goal = 0;
  return {
    group,
    set(points) {
      curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      for (const [m, r, radial] of [[core, 0.0028, 6], [halo, 0.008, 8]]) {
        m.geometry.dispose();
        m.geometry = new THREE.TubeGeometry(curve, SEGMENTS, r, radial);
        m.userData.radial = radial;
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
