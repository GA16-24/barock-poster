import * as THREE from 'three';

// A leather-bound quarto standing upright, front facing +Z, origin at its center, `size` tall.
// The front board hinges at the spine (left edge); setOpen(0..1) swings it toward the viewer.
const ASPECT = 0.72;
const THICK = 0.2;
const BOARD = 0.03;

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const t = new THREE.DataTexture(data, w, h);
  t.flipY = true;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function leather(ctx, w, h) {
  ctx.fillStyle = '#4a2416';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '20,8,4' : '120,70,40'},${0.06 + Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 2);
  }
  ctx.strokeStyle = '#b8903f';
  ctx.lineWidth = w * 0.012;
  ctx.strokeRect(w * 0.06, h * 0.05, w * 0.88, h * 0.9);
  ctx.lineWidth = w * 0.005;
  ctx.strokeRect(w * 0.09, h * 0.07, w * 0.82, h * 0.86);
}

function paper(title) {
  return (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.8);
    g.addColorStop(0, '#efe4c8');
    g.addColorStop(1, '#d8c59c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a2a1a';
    ctx.textAlign = 'center';
    ctx.font = `italic ${w * 0.075}px "Iowan Old Style", Palatino, Georgia, serif`;
    const words = title.split(' ');
    let line = '', y = h * 0.3;
    for (const word of words) {
      if (ctx.measureText(`${line} ${word}`).width > w * 0.78 && line) {
        ctx.fillText(line, w / 2, y);
        line = word;
        y += w * 0.1;
      } else line = line ? `${line} ${word}` : word;
    }
    ctx.fillText(line, w / 2, y);
    ctx.fillStyle = 'rgba(60,40,20,0.25)';
    for (let r = y + w * 0.12; r < h * 0.9; r += w * 0.045) ctx.fillRect(w * 0.12, r, w * 0.76 * (0.6 + 0.4 * Math.random()), 2);
  };
}

export function buildBook({ size, cover, title }) {
  const h = size, w = size * ASPECT, t = size * THICK, b = size * BOARD;
  const leatherMat = new THREE.MeshStandardMaterial({ map: canvasTexture(256, 356, leather), roughness: 0.62, metalness: 0.05 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe6d6b0, roughness: 0.95 });
  const pageMat = new THREE.MeshStandardMaterial({ map: canvasTexture(256, 356, paper(title)), roughness: 0.9 });
  const endpaperMat = new THREE.MeshStandardMaterial({ color: 0x7a3b22, roughness: 0.8 });

  const book = new THREE.Group();

  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, b), leatherMat);
  back.position.z = -t / 2 + b / 2;
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(t / 2, t / 2, h, 16, 1, false, Math.PI, Math.PI), leatherMat);
  spine.position.x = -w / 2;
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(w - b * 1.5, h - b * 2, t - 2 * b),
    [edgeMat, edgeMat, edgeMat, edgeMat, pageMat, edgeMat],
  );
  block.position.x = b * 0.25;

  const hinge = new THREE.Group();
  hinge.position.set(-w / 2, 0, t / 2 - b / 2);
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, b),
    [leatherMat, leatherMat, leatherMat, leatherMat, leatherMat, endpaperMat],
  );
  front.position.x = w / 2;
  hinge.add(front);

  const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.85 });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.74, h * 0.78), plateMat);
  plate.position.set(w / 2, 0, b / 2 + 0.0005);
  hinge.add(plate);
  new THREE.TextureLoader().load(
    cover,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const a = tex.image.width / tex.image.height, slot = (w * 0.74) / (h * 0.78);
      plate.scale.set(a < slot ? a / slot : 1, a < slot ? 1 : slot / a, 1);
      plateMat.map = tex;
      plateMat.color.set(0xffffff);
      plateMat.needsUpdate = true;
    },
    undefined,
    () => console.warn(`Titelblatt fehlt: ${cover}`),
  );

  book.add(back, spine, block, hinge);
  book.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    object: book,
    setOpen(v) { hinge.rotation.y = -v * 1.1; },
  };
}
