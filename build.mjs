#!/usr/bin/env node
/**
 * build.mjs — Motor de frescura de eclipses para next-eclipse.com
 *
 * Lee data/eclipses.json (fuente única de verdad) + la fecha actual y regenera
 * TODO el contenido "próximo eclipse" de las páginas (texto, meta, JSON-LD,
 * datos del countdown) y la sección de archivo histórico. Determinista, sin
 * dependencias. Lo corre un job programado a diario (ver scripts launchd).
 *
 * NO edites el texto "próximo eclipse" en los .html a mano: edita eclipses.json
 * y corre `node build.mjs`. El generador solo toca entre marcadores
 * <!--NE:KEY-->…<!--/NE:KEY--> y el content="" de <meta> con id conocido.
 *
 * Testear el auto-avance con una fecha simulada:
 *   NE_NOW=2026-08-13T00:00:00Z node build.mjs --dry   (próximo pasa a Aug 28)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');
const NOW = process.env.NE_NOW ? new Date(process.env.NE_NOW) : new Date();

const data = JSON.parse(readFileSync(join(ROOT, 'data/eclipses.json'), 'utf8'));
const all = data.eclipses
  .map(e => ({ ...e, _start: new Date(e.start).getTime(), _end: new Date(e.end).getTime() }))
  .sort((a, b) => a._start - b._start);

const now = NOW.getTime();
const past = all.filter(e => e._end < now);
const current = all.find(e => e._start <= now && now <= e._end) || null;   // eclipse "en curso"
const upcoming = all.filter(e => e._start > now);
const next = upcoming[0] || null;                                          // próximo
// "Foco" del countdown: el que está en curso, o si no, el próximo.
const focus = current || next;

const L = ['en', 'es'];
const isSolar = t => t.startsWith('solar');

// ─── Generadores de texto (bilingüe) ───────────────────────────────────────
function desc(e, lang) {           // "the total solar eclipse of August 12, 2026 (Iceland and the north of Spain)"
  const art = lang === 'en' ? 'the ' : 'el ';
  return `${art}${e['name_' + lang].toLowerCase()} of ${e['date_' + lang]} (${e['vis_' + lang]})`
    .replace(' of ', lang === 'en' ? ' of ' : ' del ');
}
function descEs(e) { return `el ${e.name_es.toLowerCase()} del ${e.date_es} (${e.vis_es})`; }
function descEn(e) { return `the ${e.name_en.toLowerCase()} of ${e.date_en} (${e.vis_en})`; }
function d(e, lang) { return lang === 'en' ? descEn(e) : descEs(e); }

// Frase "próximo eclipse" (o "en curso"), para meta y answer-box.
function nextSentence(lang, html = false) {
  const s = txt => html ? txt.replace(d(focus, lang), `<strong>${d(focus, lang)}</strong>`) : txt;
  if (current) {
    return lang === 'en'
      ? s(`An eclipse is happening right now: ${descEn(current)}. The next eclipse after it is ${next ? descEn(next) : 'being scheduled'}.`)
      : s(`Ahora mismo hay un eclipse en curso: ${descEs(current)}. El siguiente después de este es ${next ? descEs(next) : 'por confirmar'}.`);
  }
  if (!next) return lang === 'en' ? 'Upcoming eclipse dates will appear here.' : 'Las fechas de los próximos eclipses aparecerán aquí.';
  const after = upcoming[1];
  return lang === 'en'
    ? s(`The next eclipse is ${descEn(next)}.${after ? ` It is followed by ${descEn(after)}.` : ''}`)
    : s(`El próximo eclipse es ${descEs(next)}.${after ? ` Le sigue ${descEs(after)}.` : ''}`);
}

// Meta description (más corta).
function metaDesc(lang) {
  if (!focus) return '';
  const lead = current
    ? (lang === 'en' ? `An eclipse is happening now: ${descEn(current)}.` : `Eclipse en curso ahora: ${descEs(current)}.`)
    : (lang === 'en' ? `The next eclipse is ${descEn(next)}.` : `El próximo eclipse es ${descEs(next)}.`);
  return lang === 'en'
    ? `${lead} Live countdown plus the full calendar of upcoming solar and lunar eclipses with dates, times and visibility.`
    : `${lead} Cuenta atrás en vivo y el calendario completo de próximos eclipses solares y lunares con fechas, horas y visibilidad.`;
}

// ItemList JSON-LD de próximos (incluye el en curso si lo hay).
function itemListJsonLd() {
  const list = (current ? [current] : []).concat(upcoming).slice(0, 8);
  return JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: 'Upcoming eclipses', numberOfItems: list.length,
    itemListElement: list.map((e, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: {
        '@type': 'Event', name: `${e.name_en} — ${e.date_en}`,
        startDate: e.start, endDate: e.end,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: isSolar(e.type) ? 'https://schema.org/OfflineEventAttendanceMode' : 'https://schema.org/OnlineEventAttendanceMode',
        location: { '@type': 'Place', name: e.vis_en, address: { '@type': 'PostalAddress', addressCountry: 'Global' } },
        image: 'https://www.next-eclipse.com/og-eclipse.png',
        organizer: { '@type': 'Organization', name: 'Next Eclipse', url: 'https://www.next-eclipse.com' },
        description: `${e.name_en} — ${e.date_en} — ${e.blurb_en} Tracked live by next-eclipse.com.`,
        url: 'https://www.next-eclipse.com/upcoming',
      },
    })),
  });
}

// Bloque "próximo eclipse" bilingüe (la web cambia idioma vía data-en/data-es).
function nextSpan() {
  const en = nextSentence('en', true), es = nextSentence('es', true);
  const esc = s => s.replace(/"/g, '&quot;');
  return `<span data-en="${esc(en)}" data-es="${esc(es)}">${en}</span>`;
}
// ItemList envuelto en su <script> (el marcador va FUERA: un comentario dentro
// de application/ld+json rompería el JSON).
function itemListBlock() { return `<script type="application/ld+json">${itemListJsonLd()}</script>`; }

// Datos para el countdown cliente (en-curso + próximos; el JS auto-avanza).
function dataScript() {
  const arr = (current ? [current] : []).concat(upcoming).map(e => ({
    start: e.start, end: e.end, type: e.type,
    en: `${e.name_en.toLowerCase()} of ${e.date_en} (${e.vis_en})`,
    es: `${e.name_es.toLowerCase()} del ${e.date_es} (${e.vis_es})`,
  }));
  return `<script>window.NE_ECLIPSES=${JSON.stringify(arr)};</script>`;
}

// Archivo histórico (pasados, más reciente primero), bilingüe via data-en/es.
function archiveHtml() {
  if (!past.length) return '';
  const rows = [...past].reverse().map(e => {
    const href = e.page ? ` <a href="/${e.page}" data-en="Details →" data-es="Ficha →">Details →</a>` : '';
    return `      <li class="ne-arch-item"><span class="ne-arch-date">${e.date_en}</span>` +
      `<span data-en="${e.name_en} — ${e.blurb_en}" data-es="${e.name_es} — ${e.blurb_es}">${e.name_en} — ${e.blurb_en}</span>${href}</li>`;
  }).join('\n');
  return `\n    <h2 data-en="Past eclipses" data-es="Eclipses pasados">Past eclipses</h2>\n` +
    `    <ul class="ne-archive">\n${rows}\n    </ul>\n  `;
}

// ─── Aplicación a las páginas ───────────────────────────────────────────────
// region marker: <!--NE:KEY-->…<!--/NE:KEY-->  ·  meta by id: content="…"
function replaceRegion(src, key, value) {
  const re = new RegExp(`(<!--NE:${key}-->)([\\s\\S]*?)(<!--/NE:${key}-->)`, 'g');
  if (!re.test(src)) return { src, hit: false };
  return { src: src.replace(re, `$1${value}$3`), hit: true };
}
function replaceMetaById(src, id, content) {
  const re = new RegExp(`(<meta[^>]*\\bid="${id}"[^>]*\\bcontent=")[^"]*(")`, 'g');
  if (!re.test(src)) return { src, hit: false };
  return { src: src.replace(re, `$1${content.replace(/"/g, '&quot;')}$2`), hit: true };
}

// Config por página: qué regiones/meta regenerar. Extensible — añade entradas aquí.
const PAGES = [
  {
    file: 'when-is-the-next-eclipse.html',
    regions: { DATA: dataScript, NEXT_HTML: nextSpan, ITEMLIST: itemListBlock, ARCHIVE: archiveHtml },
    metaEn: { 'pg-desc': () => metaDesc('en'), 'og-desc': () => metaDesc('en'), 'tw-desc': () => metaDesc('en') },
  },
  { file: 'next-solar-eclipse.html', regions: { DATA: dataScript } },
  // upcoming.html / index.html / calendar.html: countdowns propios ya auto-avanzan
  // (find start>now); se migrarán al motor (DATA/ARCHIVE) en el siguiente incremento.
];

let changed = 0, misses = [];
for (const pg of PAGES) {
  const fp = join(ROOT, pg.file);
  let src;
  try { src = readFileSync(fp, 'utf8'); } catch { misses.push(`${pg.file}: no existe`); continue; }
  const before = src;
  for (const [key, fn] of Object.entries(pg.regions || {})) {
    const r = replaceRegion(src, key, fn()); src = r.src;
    if (!r.hit) misses.push(`${pg.file}: falta marcador NE:${key}`);
  }
  for (const [id, fn] of Object.entries(pg.metaEn || {})) {
    const r = replaceMetaById(src, id, fn()); src = r.src;
    if (!r.hit) misses.push(`${pg.file}: falta <meta id="${id}">`);
  }
  if (src !== before) { changed++; if (!DRY) writeFileSync(fp, src); }
}

// ─── Estampar dateModified = hoy (señal de frescura; corre a diario vía Action) ──
// SOLO en páginas con contenido de eclipse genuinamente vivo (countdown / lista /
// Event), NO en estáticas (privacidad, seguridad) → no falsear frescura.
const today = NOW.toISOString().slice(0, 10);
let stamped = 0;
for (const f of readdirSync(ROOT)) {
  if (!f.endsWith('.html')) continue;
  const fp = join(ROOT, f);
  const s = readFileSync(fp, 'utf8');
  const isLive = /id="cd-answer"|NE_ECLIPSES|"@type":\s*"Event"/.test(s);
  if (!isLive) continue;                                  // estática → no tocar
  const out = s.replace(/("dateModified":\s*")[^"]*(")/g, `$1${today}$2`);
  if (out !== s) { stamped++; if (!DRY) writeFileSync(fp, out); }
}

console.log(`[build.mjs] now=${NOW.toISOString()} | foco=${focus ? focus.id : 'ninguno'} (${current ? 'EN CURSO' : 'próximo'}) | pasados=${past.length} próximos=${upcoming.length} | dateModified estampado en ${stamped} págs`);
console.log(`[build.mjs] ${DRY ? '(dry) ' : ''}páginas modificadas: ${changed}`);
if (misses.length) console.log('[build.mjs] avisos:\n  - ' + misses.join('\n  - '));
