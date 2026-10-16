// Card content for each grabbable id, from data/texts.json and the head credits.
let texts = {};
const reconstructed = new Set();

async function json(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    console.warn(`Datei fehlt: ${url}`);
    return null;
  }
}

export async function loadInfo() {
  texts = (await json('data/texts.json')) ?? {};
  for (const c of (await json('data/credits/assets.json')) ?? []) {
    if (!c.reconstruction) continue;
    reconstructed.add(c.id);
    const head = c.file?.match(/heads\/([^/.]+)\.glb$/)?.[1];
    if (head) reconstructed.add(head);
  }
}

const words = (v) => (typeof v === 'string' ? v : v?.title ?? '');

// { title, text, facts: [label, value][], note }
export function infoFor(e) {
  const t = texts[e.id] ?? {};
  const fallback = e.kind === 'head' ? e.author.name : e.id;
  const card = { title: t.title ?? fallback, text: t.text ?? '', facts: [], note: '' };
  if (e.kind === 'head') {
    const werk = words(t.werk) || words(texts[`${e.id}-werk`]);
    const ort = words(t.ort) || words(texts[`${e.id}-ort`]);
    card.facts = [['Lebte', e.author.life], ['Werk', werk], ['Ort', ort]].filter(([, v]) => v);
    if (reconstructed.has(e.id)) card.note = 'Rekonstruktion: kein echtes Bild überliefert';
  }
  return card;
}
