// Readability gate for site/data/texts.json: every catalog id needs a short plain-German text with a source.
// German Flesch reading ease after Amstad: 180 - ASL - 58.5 * ASW.
import { readFileSync } from 'node:fs';
import { ALL_IDS, AUTHORS } from '../site/catalog.js';

const LIMITS = { amstad: 60, avgSentence: 12, maxSentence: 18, minWords: 40, maxWords: 75, titleWords: 4 };

// A run like "aue" in "Bauer" is two syllables, so vowel runs are split into these units first.
const VOWEL_UNITS = /äu|eu|au|ei|ai|ey|ay|ie|ee|aa|oo|[aeiouäöüy]/g;

const UNITS = [0, 1, 1, 1, 1, 1, 1, 2, 1, 1];
function numberSyllables(n) {
  if (n === 0) return 1;
  if (n >= 1100 && n < 2000) return numberSyllables(Math.floor(n / 100)) + 2 + (n % 100 ? numberSyllables(n % 100) : 0);
  let s = 0;
  if (n >= 1000) { s += (n >= 2000 ? numberSyllables(Math.floor(n / 1000)) : 0) + 2; n %= 1000; }
  if (n >= 100) { s += (n >= 200 ? numberSyllables(Math.floor(n / 100)) : 0) + 2; n %= 100; }
  if (n === 0) return s;
  if (n === 1) return s + 1;
  if (n < 10) return s + UNITS[n];
  if (n < 13) return s + 1;
  if (n < 20) return s + UNITS[n - 10] + 1 - (n === 17 ? 1 : 0);
  return s + (n % 10 ? UNITS[n % 10] + 1 : 0) + 2;
}

function syllables(word) {
  if (/^\d+$/.test(word)) return numberSyllables(Number(word));
  const groups = word.toLowerCase().match(/[aeiouäöüy]+/g) ?? [];
  const count = groups.reduce((sum, g) => sum + g.match(VOWEL_UNITS).length, 0);
  return Math.max(1, count);
}

function analyze(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const words = (s) => s.match(/[\p{L}\d]+(?:[-'][\p{L}\d]+)*/gu) ?? [];
  const lengths = sentences.map((s) => words(s).length);
  const all = words(text);
  const syl = all.reduce((sum, w) => sum + w.split('-').reduce((a, part) => a + syllables(part), 0), 0);
  const asl = all.length / sentences.length;
  const asw = syl / all.length;
  return { words: all.length, sentences: sentences.length, asl, asw, maxSentence: Math.max(...lengths), amstad: 180 - asl - 58.5 * asw };
}

function check(id, entry, authorIds) {
  if (!entry) return { id, errors: ['missing'] };
  const errors = [];
  const r = analyze(entry.text ?? '');
  if (r.amstad < LIMITS.amstad) errors.push(`Amstad ${r.amstad.toFixed(1)} < ${LIMITS.amstad}`);
  if (r.asl > LIMITS.avgSentence) errors.push(`avg sentence ${r.asl.toFixed(1)} > ${LIMITS.avgSentence}`);
  if (r.maxSentence > LIMITS.maxSentence) errors.push(`sentence of ${r.maxSentence} words`);
  if (r.words < LIMITS.minWords || r.words > LIMITS.maxWords) errors.push(`${r.words} words`);
  const titleWords = (entry.title ?? '').split(/\s+/).filter(Boolean).length;
  if (titleWords < 1 || titleWords > LIMITS.titleWords) errors.push(`title has ${titleWords} words`);
  const sources = entry.sources ?? [];
  if (!sources.length || !sources.every((u) => /^https:\/\/\S+$/.test(u))) errors.push('needs https sources');
  const prose = `${entry.title} ${entry.text} ${entry.werk ?? ''} ${entry.ort ?? ''}`;
  if (/—|\s–\s/.test(prose)) errors.push('dash as punctuation');
  if (/[“”„‚‘’]/.test(prose)) errors.push('curly quotes');
  if (authorIds.has(id) && !(entry.werk && entry.ort)) errors.push('author needs werk and ort');
  return { id, errors, ...r };
}

const texts = JSON.parse(readFileSync(new URL('../site/data/texts.json', import.meta.url), 'utf8'));
const authorIds = new Set(AUTHORS.map((a) => a.id));
const rows = ALL_IDS.map((id) => check(id, texts[id], authorIds));
const extra = Object.keys(texts).filter((k) => !ALL_IDS.includes(k));

const pad = (v, n) => String(v).padEnd(n);
console.log(`${pad('id', 16)}${pad('words', 7)}${pad('sent', 6)}${pad('ASL', 6)}${pad('max', 5)}${pad('ASW', 6)}${pad('Amstad', 8)}result`);
for (const r of rows) {
  const nums = r.words === undefined ? pad('', 38)
    : `${pad(r.words, 7)}${pad(r.sentences, 6)}${pad(r.asl.toFixed(1), 6)}${pad(r.maxSentence, 5)}${pad(r.asw.toFixed(2), 6)}${pad(r.amstad.toFixed(1), 8)}`;
  console.log(`${pad(r.id, 16)}${nums}${r.errors.length ? `FAIL ${r.errors.join('; ')}` : 'ok'}`);
}
const scored = rows.filter((r) => r.words !== undefined);
if (scored.length) {
  console.log(`\nmin Amstad ${Math.min(...scored.map((r) => r.amstad)).toFixed(1)}, max ASL ${Math.max(...scored.map((r) => r.asl)).toFixed(1)}, longest sentence ${Math.max(...scored.map((r) => r.maxSentence))} words`);
}
if (extra.length) console.log(`unknown ids in texts.json: ${extra.join(', ')}`);
const failed = rows.filter((r) => r.errors.length).length + extra.length;
console.log(failed ? `${failed} failing` : `all ${rows.length} ids pass`);
process.exit(failed ? 1 : 0);
