// Everything the room shows, hung like a picture gallery. Placement is in meters in the thermostat's frame: origin at
// the LCD center, x to the right along the wall, y up, z out of the wall toward the viewer.
// Texts live in data/texts.json under the same ids, so grabbing any object looks up texts[id].

// Every prop gets one shadow-box niche of the same size on a grid. A pair shares a slot: Adel hangs at -x, Volk at +x.
// `fit` is the box an object is scaled into and `reach` caps its depth; round props would otherwise shrink to the
// niche depth, so they may stand out of the niche toward the viewer.
export const NICHE = { w: 0.33, h: 0.37, depth: 0.14, fit: [0.27, 0.3], reach: 0.27, z: 0.085 };
export const COLS = [0.615, 0.955];
export const ROWS = [0.57, 0.19, -0.19, -0.57];

export const ZONES = {
  adel: { title: 'Der Adel', x: -(COLS[0] + COLS[1]) / 2, style: 'adel' },
  autoren: { title: 'Drei Dichter', x: 0, style: 'autoren' },
  volk: { title: 'Das Volk', x: (COLS[0] + COLS[1]) / 2, style: 'volk' },
};
// One gilt cornice runs over both grids and the poets and carries the zone titles; the poets' title sits on the
// cartouche in its middle. `y` is the bottom of its frieze.
export const CORNICE = { halfWidth: COLS[1] + NICHE.w / 2 + 0.02, y: ROWS[0] + NICHE.h / 2 + 0.015, frieze: 0.075 };
export const TITLE_Y = CORNICE.y + CORNICE.frieze / 2;
// A tall gilt portal holds the book niche at its foot and frames the thermostat in its arch. It stays narrow enough
// to clear the thermostat housing inside and the light switch beside it.
export const ARCH = { halfWidth: 0.095, band: 0.014, base: -0.395, spring: 0.02 };

// Black lacquer with a gilt lip on red velvet for the nobility, raw pine on linen for the common people, gilt on
// deep blue for the poets. The names pick canvas textures in gallery.js.
export const FRAME_STYLES = {
  adel: { frame: 'lacquer', lip: true, back: 'velvet', side: 0x2a0a10, drape: 'velvet' },
  volk: { frame: 'pine', lip: false, back: 'linen', side: 0x6b4a2a, drape: 'linen' },
  autoren: { frame: 'gilt', lip: true, back: 'damask', side: 0x081820 },
};

// Antithesis, the signature device of Baroque writing, as the layout rule: both sides have eight things and each has a
// counterpart across the poets. `slot` is [column, row] into COLS and ROWS; `roll` turns a long thin object to
// the niche diagonal; `idle` names its motion: [kind, amplitude]; `candle` puts the one flickering light at the object; `wheel` is the disc (in model coordinates) that turns.
export const PAIRS = [
  { slot: [1, 0], adel: { id: 'kronleuchter', candle: true, idle: ['sway', 0.07] }, volk: { id: 'spinnrad', wheel: { center: [-0.406, 0.366], radius: 0.6, z: [-0.21, -0.03], rate: 1.4 }, idle: ['turn', 0.3] } },
  { slot: [0, 0], adel: { id: 'krone', idle: ['turn', 0.5] }, volk: { id: 'brot', idle: ['breath', 0.014] } },
  { slot: [0, 1], adel: { id: 'peruecke', idle: ['sway', 0.05] }, volk: { id: 'pestmaske', idle: ['turn', 0.35] } },
  { slot: [1, 1], adel: { id: 'spiegel', idle: ['turn', 0.4] }, volk: { id: 'sense', roll: 0.62, idle: ['tilt', 0.05] } },
  { slot: [0, 2], adel: { id: 'degen', roll: -0.62, idle: ['tilt', 0.05] }, volk: { id: 'helm', idle: ['turn', 0.4] } },
  { slot: [1, 2], adel: { id: 'pokal', idle: ['turn', 0.6] }, volk: { id: 'fass', idle: ['breath', 0.012] } },
  { slot: [0, 3], adel: { id: 'schloss', idle: ['turn', 0.18] }, volk: { id: 'bauernhaus', idle: ['turn', 0.18] } },
  { slot: [1, 3], adel: { id: 'kutsche', idle: ['rock', 0.035] }, volk: { id: 'pflug', idle: ['rock', 0.02] } },
];

const side = { adel: -1, volk: 1 };
export const ITEMS = PAIRS.flatMap(({ slot: [col, row], adel, volk }) => [['adel', adel, volk], ['volk', volk, adel]].map(([zone, item, other]) => ({
  zone,
  model: `models/${zone}/${item.id}.glb`,
  at: [side[zone] * COLS[col], ROWS[row], NICHE.z],
  slot: [col, row],
  partner: other.id,
  ...item,
})));

// No portrait of Bidermann survives, so his head is a reconstruction (`reconstruction: true`) and says so.
// Grabbing a head shows the author text and switches the map below the thermostat to that author's place.
// The book (`${id}-werk`) and the map (`${id}-ort`) are grabbable too. The three heads sit in oval medallions.
export const AUTHORS = [
  {
    id: 'andreae', name: 'Johann Valentin Andreae', life: '1586–1654',
    head: 'models/heads/andreae.glb', cover: 'img/works/andreae.jpg', map: 'models/maps/tuebingen.glb',
    at: [-0.285, 0.38, 0.07],
  },
  {
    id: 'bidermann', name: 'Jakob Bidermann', life: '1578–1639', reconstruction: true,
    head: 'models/heads/bidermann.glb', cover: 'img/works/bidermann.jpg', map: 'models/maps/muenchen.glb',
    at: [0, 0.38, 0.07],
  },
  {
    id: 'birken', name: 'Sigmund von Birken', life: '1626–1681',
    head: 'models/heads/birken.glb', cover: 'img/works/birken.jpg', map: 'models/maps/nuernberg.glb',
    at: [0.285, 0.38, 0.07],
  },
];

export const HEAD_SIZE = 0.2;
// Medallion size and the width of the name plate that hangs on its lower rim; the plates are narrower than the
// 0.285 m between medallions, so they cannot overlap at any distance.
export const MEDALLION = { w: 0.27, h: 0.36, depth: 0.13, plate: 0.24, plateDrop: 0.175 };
// The author map is a flat display table 1 m across; the book lies in its own niche below the thermostat.
export const MAP = { size: 1.0, at: [0, -0.7, 0.62] };
export const BOOK = { size: 0.16, at: [0, -0.255, 0.07], niche: { w: 0.16, h: 0.25, depth: 0.12 } };

export const ALL_IDS = [
  ...ITEMS.map((i) => i.id),
  ...AUTHORS.flatMap((a) => [a.id, `${a.id}-werk`, `${a.id}-ort`]),
];
