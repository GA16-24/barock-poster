// Everything the room shows. Placement is in meters in the thermostat's frame: origin at the LCD center,
// x to the right along the wall, y up, z out of the wall toward the viewer. `size` is the longest side.
// Texts live in data/texts.json under the same ids, so grabbing any object looks up texts[id].

export const ZONES = {
  adel: { title: 'Der Adel', x: -0.8 },
  autoren: { title: 'Drei Dichter', x: 0 },
  volk: { title: 'Das Volk', x: 0.8 },
};

export const ITEMS = [
  { id: 'schloss', zone: 'adel', model: 'models/adel/schloss.glb', size: 0.42, at: [-0.9, -0.3, 0.25] },
  { id: 'krone', zone: 'adel', model: 'models/adel/krone.glb', size: 0.16, at: [-0.75, 0.32, 0.2] },
  { id: 'peruecke', zone: 'adel', model: 'models/adel/peruecke.glb', size: 0.2, at: [-1.0, 0.3, 0.15] },
  { id: 'kutsche', zone: 'adel', model: 'models/adel/kutsche.glb', size: 0.3, at: [-0.55, -0.32, 0.25] },
  { id: 'degen', zone: 'adel', model: 'models/adel/degen.glb', size: 0.36, at: [-1.15, 0.0, 0.12] },
  { id: 'spiegel', zone: 'adel', model: 'models/adel/spiegel.glb', size: 0.3, at: [-0.55, 0.05, 0.05] },
  { id: 'kronleuchter', zone: 'adel', model: 'models/adel/kronleuchter.glb', size: 0.26, at: [-0.8, 0.58, 0.2] },
  { id: 'pokal', zone: 'adel', model: 'models/adel/pokal.glb', size: 0.14, at: [-0.85, 0.02, 0.22] },

  { id: 'bauernhaus', zone: 'volk', model: 'models/volk/bauernhaus.glb', size: 0.42, at: [0.9, -0.3, 0.25] },
  { id: 'pflug', zone: 'volk', model: 'models/volk/pflug.glb', size: 0.32, at: [0.55, -0.32, 0.25] },
  { id: 'sense', zone: 'volk', model: 'models/volk/sense.glb', size: 0.4, at: [1.15, 0.05, 0.12] },
  { id: 'brot', zone: 'volk', model: 'models/volk/brot.glb', size: 0.14, at: [0.75, 0.32, 0.2] },
  { id: 'pestmaske', zone: 'volk', model: 'models/volk/pestmaske.glb', size: 0.2, at: [1.0, 0.3, 0.15] },
  { id: 'helm', zone: 'volk', model: 'models/volk/helm.glb', size: 0.2, at: [0.55, 0.05, 0.12] },
  { id: 'fass', zone: 'volk', model: 'models/volk/fass.glb', size: 0.18, at: [0.85, 0.02, 0.22] },
  { id: 'spinnrad', zone: 'volk', model: 'models/volk/spinnrad.glb', size: 0.26, at: [0.8, 0.58, 0.15] },
];

// Grabbing a head shows the author text and switches the map below the thermostat to that author's place.
// The book (`${id}-werk`) and the map (`${id}-ort`) are grabbable too.
export const AUTHORS = [
  {
    id: 'andreae', name: 'Johann Valentin Andreae', life: '1586–1654',
    head: 'models/heads/andreae.glb', cover: 'img/works/andreae.jpg', map: 'models/maps/tuebingen.glb',
    at: [-0.26, 0.3, 0.15],
  },
  {
    id: 'bidermann', name: 'Jakob Bidermann', life: '1578–1639',
    head: 'models/heads/bidermann.glb', cover: 'img/works/bidermann.jpg', map: 'models/maps/muenchen.glb',
    at: [0, 0.3, 0.15],
  },
  {
    id: 'birken', name: 'Sigmund von Birken', life: '1626–1681',
    head: 'models/heads/birken.glb', cover: 'img/works/birken.jpg', map: 'models/maps/nuernberg.glb',
    at: [0.26, 0.3, 0.15],
  },
];

export const HEAD_SIZE = 0.2;
export const MAP = { size: 0.6, at: [0, -0.38, 0.3] };
export const BOOK = { size: 0.16, at: [-0.36, -0.2, 0.32] };

export const ALL_IDS = [
  ...ITEMS.map((i) => i.id),
  ...AUTHORS.flatMap((a) => [a.id, `${a.id}-werk`, `${a.id}-ort`]),
];
