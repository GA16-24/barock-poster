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

// uvs[i] is [u, v] or null when that label is behind the camera.
export function placeLabels(uvs, shown) {
  labelLayer.hidden = !shown;
  if (!shown) return;
  uvs.forEach((uv, i) => {
    const el = labelEls[i];
    el.hidden = !uv;
    if (!uv) return;
    const [x, y] = toScreen(uv[0], uv[1]);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
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

export function showCard({ title, text, facts, note }) {
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
  cardEl.hidden = false;
  cardEl.scrollTop = 0;
}
export function hideCard() { cardEl.hidden = true; }
export const cardOpen = () => !cardEl.hidden;
export const onCardClose = (fn) => cardEl.querySelector('.close').addEventListener('click', fn);

const MARGIN = 12, GAP = 12;
// Beside the object on the side with more room, clamped to the screen and kept above the status pill.
// radius is the object's half size in video heights.
export function placeCard(uv, radius) {
  if (cardEl.hidden) return;
  const c = cover(), { W, H } = c;
  const [x, y] = toScreen(uv[0], uv[1]);
  const r = radius * c.h + GAP;
  // The card narrows to the free side of the object, down to a readable 220 px, before it is allowed to cover it.
  const room = (x > W / 2 ? x - r : W - x - r) - MARGIN;
  const width = Math.round(Math.max(220, Math.min(300, room)));
  if (Math.abs(cardEl.offsetWidth - width) > 2) cardEl.style.width = `${width}px`;
  const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
  const left = x > W / 2 ? x - r - cw : x + r;
  const top = y - ch / 2;
  const cx = Math.min(Math.max(left, MARGIN), W - cw - MARGIN);
  const cy = Math.min(Math.max(top, 64), H - ch - 84);
  cardEl.style.transform = `translate(${cx.toFixed(0)}px, ${Math.max(cy, MARGIN).toFixed(0)}px)`;
}
