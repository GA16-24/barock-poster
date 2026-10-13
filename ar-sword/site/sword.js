export const SWORD_HEIGHT = 0.2;

export const PALETTE = {
  o: '#1a1c2c', w: '#f4f4f4', s: '#94b0c2', d: '#566c86', g: '#ffcd75',
  G: '#ef7d57', r: '#b13e53', b: '#5d275d', B: '#333c57',
};

export const SPRITE = [
  '.....o.....',
  '....owo....',
  ...Array(18).fill('...owsdo...'),
  '.ooooooooo.',
  'oggggrggggo',
  'oGGGGGGGGGo',
  '.ooooooooo.',
  '....obo....',
  '....oBo....',
  '....obo....',
  '....oBo....',
  '....obo....',
  '...ogggo...',
  '...oGrGo...',
  '...ogGgo...',
  '....ooo....',
];

export const voxel = SWORD_HEIGHT / SPRITE.length;
export const swordWidth = SPRITE[0].length * voxel;

export function buildSword(THREE) {
  const cells = [];
  SPRITE.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && cells.push({ x, y, ch })));

  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(voxel, voxel, voxel),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    cells.length,
  );
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  cells.forEach(({ x, y, ch }, i) => {
    m.makeTranslation((x - (SPRITE[0].length - 1) / 2) * voxel, ((SPRITE.length - 1) / 2 - y) * voxel, 0);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.set(PALETTE[ch]));
  });

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
