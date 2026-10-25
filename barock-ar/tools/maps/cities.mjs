// One entry per map. `center` is [lat, lon], `radius` in meters. Landmarks are OSM names the build
// looks up and logs, so a wrong center shows up as a missing landmark. Street names pick the paths movers use.
export const CITIES = {
  tuebingen: {
    id: 'tuebingen',
    title: 'Tübingen, Altstadt am Neckar',
    center: [48.51943, 9.05436],
    radius: 330,
    focus: [0.3, -0.05],
    landmarks: ['Stiftskirche St. Georg', 'Kapelle des evangelischen Stifts', 'Hölderlinturm', 'Platanenallee', 'Eberhardsbrücke', 'Schloss Hohentübingen'],
    style: { levels: [3, 4], timber: 0.45, ground: '#7d7d55', walls: ['#ece4d0', '#e4d4b0', '#efe6d6', '#dcc9a2', '#e6dccb', '#d9bfa0', '#e9e2cf'] },
    movers: {
      river: { names: ['Neckar'], kind: 'raft', count: 3 },
      swans: { names: ['Neckar'], count: 4 },
      streets: [
        { names: ['Platanenallee'], count: 6, len: 170 },
        { names: ['Eberhardsbrücke', 'Mühlstraße'], count: 3, len: 140 },
        { names: ['Am Markt', 'Kirchgasse', 'Marktgasse', 'Holzmarkt', 'Neckargasse'], count: 4, len: 120 },
        { names: ['Bursagasse', 'Klosterberg', 'Neckarhalde'], count: 3, len: 120 },
      ],
      carriages: [{ names: ['Eberhardsbrücke', 'Mühlstraße', 'Neckargasse'], count: 1, len: 260 }],
      birds: [
        { at: 'Stiftskirche St. Georg', kind: 'crow', count: 4, radius: 70, height: 75 },
        { at: null, kind: 'gull', count: 3, radius: 150, height: 95 },
      ],
    },
  },
  muenchen: {
    id: 'muenchen',
    title: 'München, Neuhauser Straße mit St. Michael',
    center: [48.13842, 11.572],
    radius: 340,
    focus: [-0.3, 0.12],
    landmarks: ['Sankt Michael', 'Frauenkirche', 'Neuhauser Straße', 'Kaufingerstraße', 'Bürgersaalkirche'],
    style: { v: 1.15, levels: [4, 5], timber: 0, ground: '#8c8676', walls: ['#eadfc8', '#e7d3a6', '#e9c9b4', '#dcd4c2', '#efe8da', '#e2cfa0', '#d8c3b0', '#cfd3c4'] },
    movers: {
      procession: { names: ['Neuhauser Straße', 'Kaufingerstraße'], near: 'Sankt Michael', len: 230 },
      streets: [
        { names: ['Neuhauser Straße', 'Kaufingerstraße'], count: 12, len: 200 },
        { names: ['Augustinerstraße', 'Frauenplatz', 'Liebfrauenstraße'], count: 4, len: 110 },
        { names: ['Ettstraße', 'Herzog-Max-Straße', 'Färbergraben', 'Altheimer Eck'], count: 3, len: 120 },
      ],
      carriages: [{ names: ['Neuhauser Straße', 'Kaufingerstraße'], count: 2, len: 330 }],
      pigeons: { at: 'Frauenkirche', count: 9, radius: 32, height: 22 },
      birds: [
        { at: 'Sankt Michael', kind: 'crow', count: 3, radius: 60, height: 70 },
        { at: 'Frauenkirche', kind: 'dove', count: 4, radius: 45, height: 110 },
      ],
    },
  },
  nuernberg: {
    id: 'nuernberg',
    title: 'Nürnberg, Hallerwiese und Pegnitz',
    center: [49.45564, 11.07235],
    radius: 430,
    focus: [-0.4, -0.12],
    landmarks: ['Hallerwiese', 'Henkersteg', 'Weinstadel', 'Henkerhaus', 'Sinwellturm', 'Pegnitz', 'St. Sebald'],
    style: { levels: [3, 4], timber: 0.3, ground: '#7a7a58', walls: ['#e8dcc4', '#c98f6e', '#dcc7a6', '#b97a5c', '#e9e1cf', '#d6b48e', '#cfa080'] },
    movers: {
      river: { names: ['Pegnitz'], kind: 'boat', count: 4 },
      swans: { names: ['Pegnitz'], count: 3 },
      sheep: { area: 'Hallerwiese', count: 14 },
      streets: [
        { names: ['Henkersteg', 'Weinmarkt', 'Trödelmarkt'], count: 3, len: 120 },
        { names: ['Maxbrücke', 'Maxplatz', 'Hallertor', 'Am Hallertor'], count: 3, len: 150 },
        { names: ['Hallerwiese', 'Johannisstraße'], count: 3, len: 160 },
      ],
      carriages: [{ names: ['Maxbrücke', 'Maxplatz', 'Hallertor'], count: 1, len: 250 }],
      birds: [
        { at: 'Sinwellturm', kind: 'crow', count: 4, radius: 60, height: 90 },
        { at: 'Weinstadel', kind: 'gull', count: 3, radius: 110, height: 70 },
      ],
    },
  },
};
