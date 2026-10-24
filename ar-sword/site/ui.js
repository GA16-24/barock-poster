// Everything drawn in HTML over the camera: labels, the info card, the hand cursor, status and hints.
// Positions come in as normalized video coordinates (0..1, x right, y down) and are mapped through the
// object-fit: cover crop that the video and the canvas share.
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const loadingEl = $('loading');
const hintEl = $('hint');
const cursorEl = $('cursor');
const cardEl = $('card');
const labelLayer = $('labels');

let videoW = 1, videoH = 1;
export function setVideoSize(w, h) { videoW = w; videoH = h; }

function cover() {
  const W = innerWidth, H = innerHeight, s = Math.max(W / videoW, H / videoH);
  return { W, H, w: videoW * s, h: videoH * s, x: (W - videoW * s) / 2, y: (H - videoH * s) / 2 };
}
export function toScreen(u, v) {
  const c = cover();
  return [c.x + u * c.w, c.y + v * c.h];
}
export function onScreen(uv, margin = 16) {
  const [x, y] = toScreen(uv[0], uv[1]);
  return x > margin && x < innerWidth - margin && y > margin && y < innerHeight - margin;
}
export function toVideo(px, py) {
  const c = cover();
  return [(px - c.x) / c.w, (py - c.y) / c.h];
}

let labelEls = [];
export function initLabels(labels, onPick) {
  labelEls = labels.map((l) => {
    const el = document.createElement(l.id ? 'button' : 'div');
    if (l.id) {
      el.type = 'button';
      el.addEventListener('click', () => onPick(l.id));
    }
    el.className = `label ${l.kind}`;
    el.textContent = l.text;
    if (l.sub) {
      const sub = document.createElement('small');
      sub.textContent = l.sub;
      el.append(sub);
    }
    labelLayer.append(el);
    return el;
  });
}

// Labels are set in fixed CSS widths and scaled to the width their plate has on screen, so a name plate hangs
// inside its medallion at any distance and can never overlap the next one.
const NATURAL = { name: 76, zone: 150 };
const SCALE = { name: [0.3, 1.5], zone: [0.45, 1.8] };
// items[i] is { uv: [u, v] or null when behind the camera, size: width in video heights, show: 0..1 }.
export function placeLabels(items, shown) {
  labelLayer.hidden = !shown;
  if (!shown) return;
  const h = cover().h;
  items.forEach(({ uv, size, show }, i) => {
    const el = labelEls[i], kind = el.classList.contains('name') ? 'name' : 'zone';
    el.hidden = !uv || show <= 0.01;
    if (el.hidden) return;
    const [x, y] = toScreen(uv[0], uv[1]);
    const k = Math.min(Math.max((size * h) / NATURAL[kind], SCALE[kind][0]), SCALE[kind][1]);
    el.style.opacity = show.toFixed(2);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${k.toFixed(3)})`;
  });
}

export function setStatus(found) {
  statusEl.textContent = found ? 'GEFUNDEN' : 'SUCHE THERMOSTAT…';
  statusEl.classList.toggle('on', found);
}

export function setProgress(done, total) {
  const bar = $('progress');
  bar.max = total;
  bar.value = done;
  const text = done < total ? `Lade Modelle ${done} von ${total}` : 'Bereit';
  $('progress-text').textContent = text;
  loadingEl.textContent = text;
  loadingEl.classList.toggle('done', done >= total);
}

const HINT_KEY = 'barock-hint-seen';
export function showHint() { hintEl.hidden = localStorage.getItem(HINT_KEY) === '1'; }
export function hintDone() {
  hintEl.hidden = true;
  localStorage.setItem(HINT_KEY, '1');
}

export function setCursor(uv, closed, over) {
  cursorEl.hidden = !uv;
  if (!uv) return;
  const [x, y] = toScreen(uv[0], uv[1]);
  cursorEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  cursorEl.classList.toggle('closed', closed);
  cursorEl.classList.toggle('over', over);
}

export function showCard({ title, text, facts, note, pair }) {
  cardEl.querySelector('h2').textContent = title;
  cardEl.querySelector('.text').textContent = text;
  const dl = cardEl.querySelector('dl');
  dl.replaceChildren(...facts.flatMap(([k, v]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    return [dt, dd];
  }));
  const noteEl = cardEl.querySelector('.note');
  noteEl.textContent = note;
  noteEl.hidden = !note;
  const pairEl = cardEl.querySelector('.pair');
  pairEl.textContent = pair ? `Gegenstück: ${pair}` : '';
  pairEl.hidden = !pair;
  cardEl.classList.remove('more', 'away');
  cardEl.classList.add('open');
  corner = null;
  cardEl.scrollTop = 0;
  // The card grows out of its object and settles with a little overshoot.
  cardEl.animate(
    [{ opacity: 0, scale: 0.88, translate: '0 10px' }, { opacity: 1, scale: 1, translate: '0 0' }],
    { duration: 320, easing: 'cubic-bezier(0.2, 1.35, 0.4, 1)' },
  );
}
export function hideCard() { cardEl.classList.remove('open'); }
cardEl.querySelector('.text').addEventListener('click', () => cardEl.classList.toggle('more'));
export const onCardClose = (fn) => cardEl.querySelector('.close').addEventListener('click', fn);

const MARGIN = 12, BAR = 84;
// Moving the card costs the reader their place, so it only moves to a corner that hides clearly less.
const SWITCH = 0.15;
let corner = null;
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const px = (style, name) => parseFloat(style.getPropertyValue(name)) || 0;
// The card docks in the screen corner where it hides least of `avoid`, the screen rects of the selected object and
// its linked items (the counterpart, the risen map and book), and grows out of the object's direction. Ties go to
// the bottom, away from the object. `away` fades it while the object is out of view; the selection lives on.
export function placeCard(uv, avoid, away) {
  if (!cardEl.classList.contains('open')) return;
  cardEl.classList.toggle('away', away);
  const { W, H } = cover();
  const [x, y] = toScreen(uv[0], uv[1]);
  const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight, style = getComputedStyle(cardEl);
  const top = MARGIN + px(style, '--safe-top'), bottom = H - ch - BAR - px(style, '--safe-bottom');
  const far = x < W / 2 ? W - cw - MARGIN : MARGIN, near = W - cw - far;
  const spots = [[far, bottom], [near, bottom], [far, top], [near, top]].map(([cx, cy]) => ({
    key: `${cx < W / 2 ? 'left' : 'right'} ${cy === top ? 'top' : 'bottom'}`, cx, cy,
    hidden: avoid.reduce((sum, r) => sum + overlap([cx, cy, cx + cw, cy + ch], r), 0),
  }));
  const best = spots.reduce((b, s) => (s.hidden < b.hidden ? s : b));
  const was = spots.find((s) => s.key === corner);
  if (!was || best.hidden < was.hidden - SWITCH * cw * ch) corner = best.key;
  const { cx, cy } = spots.find((s) => s.key === corner);
  if (was && was.key !== corner) cardEl.animate([{ translate: `${was.cx - cx}px ${was.cy - cy}px` }, { translate: '0 0' }], { duration: 260, easing: 'ease-out' });
  cardEl.style.transformOrigin = `${(x - cx).toFixed(0)}px ${(y - cy).toFixed(0)}px`;
  cardEl.style.transform = `translate(${cx.toFixed(0)}px, ${cy.toFixed(0)}px)`;
}
