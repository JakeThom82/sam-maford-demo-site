// Shop-language query parsing and product filtering. Pure functions: used by the app and the tests.
import { parseLength, MM_PER_IN } from './units.js';

export const ISO_GROUPS = {
  P: 'Steel', M: 'Stainless steel', K: 'Cast iron', N: 'Non-ferrous (aluminum, brass, plastics)',
  S: 'Heat-resistant alloys & titanium', H: 'Hardened steel',
};

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WORD_DIAMETERS = [
  ['three[- ]quarters?', 0.75], ['three[- ]eighths?', 0.375], ['five[- ]eighths?', 0.625], ['five[- ]sixteenths?', 0.3125],
  ['three[- ]sixteenths?', 0.1875], ['half', 0.5], ['quarter', 0.25], ['eighth', 0.125], ['sixteenth', 0.0625],
];
const MATERIAL_WORDS = [
  ['aluminum|aluminium|alum|alu|non[- ]?ferrous|brass|copper|bronze|plastics?|magnesium', 'N', 'aluminum / non-ferrous'],
  ['stainless(?: steel)?|ss|304|316|17-4|duplex', 'M', 'stainless'],
  ['cast[- ]iron|ductile(?: iron)?|gr[ae]y iron|iron', 'K', 'cast iron'],
  ['titanium|ti|inconel|nickel(?: alloys?)?|super ?alloys?|hrsa|waspaloy|hastelloy|monel', 'S', 'titanium / high-temp alloys'],
  ['hardened(?: steel)?|hard steel|hrc', 'H', 'hardened steel'],
  ['carbon steel|alloy steel|mild steel|tool steel|steels?|4140|4340|1018|1045|a36|p20', 'P', 'steel'],
];
const COATING_WORDS = [
  ['altima ?blaze|blaze', 'ALtima Blaze'], ['altima ?xtreme|xtreme', 'ALtima Xtreme'], ['altima ?q', 'ALtima Q'],
  ['altima|altin|aitin', 'ALtima'], ['ticn', 'TiCN'], ['tin', 'TiN'], ['uncoated|bright|no coating', 'Uncoated'],
  ['fordlube', 'Fordlube'], ['ceraedge', 'CERAedge'], ['gem', 'Gem +'],
];
const STOP = /^(end|mill|mills|endmill|endmills|em|carbide|solid|tool|tools|cutter|for|with|in|a|an|the|and|of|inch|inches|dia|diameter|size|ma|ford|x|please|need|want|i|show|me)$/;
const SIZE = String.raw`(?:\d+[- ]\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)(?:\s*(?:mm|in|inch|"))?`;
const B = String.raw`(?<=\s)`, E = String.raw`(?=\s)`; // token boundaries

// Turn a typed request into filters plus an explanation of how each part was read.
export function parseQuery(input, seriesIds = []) {
  const crit = {}; const read = []; const unused = [];
  let q = ' ' + String(input || '').toLowerCase().replace(/[“”″]/g, '"').replace(/,/g, ' ').replace(/\s+/g, ' ') + ' ';
  // fn returns false to leave the text in place for later rules.
  const take = (re, fn) => { q = q.replace(re, (...m) => (fn(...m) === false ? m[0] : ' ')); };
  const size = s => parseLength(s.replace(/"/g, ' in'));
  const rx = s => new RegExp(B + s + E, 'g');

  // Part number or EDP number: digits with letters (27712500B, XV725020AQ), or 5+ digits (51001).
  take(rx(String.raw`([a-z0-9][a-z0-9.\-]*\d[a-z0-9.\-]*)`), (m, tok) => {
    const looksPart = /^\d{5,}$/.test(tok) || (/[a-z]/.test(tok) && /\d{3,}/.test(tok) && !/^[\d.\/-]+(mm|in|fl|flt|f|r|cr)$/.test(tok) && !/^(r|cr)[\d.\/]+(mm)?$/.test(tok));
    if (!looksPart || seriesIds.some(s => s.toLowerCase() === tok)) return false;
    (crit.parts ||= []).push(tok.toUpperCase()); read.push(`Part or EDP number ${tok.toUpperCase()}`);
  });
  // Dia x LOC (x OAL), e.g. 1/2 x 1 x 3
  take(rx(`(${SIZE})\\s*x\\s*(${SIZE})(?:\\s*x\\s*(${SIZE}))?`), (m, a, b, c) => {
    const A = size(a), Bv = size(b), C = c && size(c);
    if (!A || !Bv) return false;
    crit.dc = A; read.push(`Diameter ${a.trim()}`);
    crit.loc = Bv; read.push(`Cutting length ${b.trim()}`);
    if (C) { crit.oal = C; read.push(`Overall length ${c.trim()}`); }
  });
  // Corner radius with a size: r.030, .030r, .030 radius, cr .5mm, radius 1mm
  const setRe = a => { const v = size(a); if (!v) return false; crit.re = v; crit.corner = ['corner radius']; read.push(`Corner radius ${a.trim()}`); };
  take(rx(`(?:r|cr|rad|radius|corner radius)\\s*(${SIZE})`), (m, a) => setRe(a));
  take(rx(`(${SIZE})\\s*(?:r|cr|rad|radius|corner radius)`), (m, a) => setRe(a));
  // Lengths with a keyword before or after the size.
  for (const [key, words, label] of [
    ['loc', 'loc|length of cut|cut length|flute length|apmx', 'Cutting length'],
    ['oal', 'oal|overall length|overall', 'Overall length'],
    ['lu', 'reach|lu|usable length', 'Reach'],
    ['shank', 'shank|dconms', 'Shank'],
  ]) {
    const set = a => { const v = size(a); if (!v) return false; crit[key] = v; read.push(`${label} ${a.trim()}`); };
    take(rx(`(?:${words})\\s*(${SIZE})`), (m, a) => set(a));
    take(rx(`(${SIZE})\\s*(?:${words})`), (m, a) => set(a));
  }
  // Flutes: 4 flute, 4fl, four flute, 4 flt, 4-flute
  take(rx(`(\\d{1,2}|${Object.keys(NUM_WORDS).join('|')})\\s*-?\\s*(?:flutes?|fl|flt|f)`), (m, n) => {
    const v = NUM_WORDS[n] ?? +n; (crit.nof ||= []).push(v); read.push(`${v} flutes`);
  });
  // Corner style and features
  for (const [words, fn] of [
    ['ball ?nose|ball ?end|ball|bn', () => { crit.corner = ['ball']; read.push('Ball nose'); }],
    ['corner radius|bull ?nose|radius|cr', () => { crit.corner = ['corner radius']; read.push('Corner radius'); }],
    ['square(?: end)?|sq|flat ?end|flat', () => { crit.corner = ['square']; read.push('Square end'); }],
    ['oval|barrel', () => { crit.corner = ['oval']; read.push('Oval form'); }],
    ['chip ?breakers?|cb', () => { crit.chipbreaker = true; read.push('Chipbreaker'); }],
    ['neck(?:ed)?|neck relief|long reach', () => { crit.necked = true; read.push('Neck relief / reach'); }],
    ['weldon(?: flat)?', () => { crit.weldon = true; read.push('Weldon flat shank'); }],
    ['micro', () => { crit.micro = true; read.push('Micro sizes (under 1/8")'); }],
  ]) take(rx(`(?:${words})`), fn);
  for (const [words, name] of COATING_WORDS) take(rx(`(?:${words})`), () => { (crit.coating ||= []).push(name); read.push(`Coating ${name}`); });
  for (const [words, g, label] of MATERIAL_WORDS) take(rx(`(?:${words})`), () => { crit.material = g; read.push(`Material: ${label} (ISO ${g})`); });
  // Series: "series 277", or a bare series id such as 277CB, XV7 or a 3-digit number.
  const ids = new Set(seriesIds.map(s => s.toLowerCase()));
  take(rx('series\\s+([a-z0-9-]+)'), (m, s) => { (crit.series ||= []).push(s.toUpperCase()); read.push(`Series ${s.toUpperCase()}`); });
  take(rx('([a-z0-9-]+)'), (m, s) => {
    if (!(ids.has(s) && (/[a-z]/.test(s) || s.length === 3))) return false;
    (crit.series ||= []).push(s.toUpperCase()); read.push(`Series ${s.toUpperCase()}`);
  });
  // Diameter: words (half inch, three quarter) or the first remaining size.
  for (const [w, v] of WORD_DIAMETERS) take(rx(`(${w})(?:\\s*(?:inch|in|"))?`), (m, word) => {
    if (crit.dc) { unused.push(word); return; }
    crit.dc = { in: v, unit: 'in', text: word }; read.push(`Diameter ${word} inch`);
  });
  take(rx(`(${SIZE})`), (m, a) => {
    const v = size(a);
    if (!v) return false;
    if (crit.dc || v.in > 3) { unused.push(a.trim()); return; } // sizes over 3" are not end-mill diameters (the largest loaded is 1")
    crit.dc = v; read.push(`Diameter ${a.trim()}`);
  });
  for (const w of q.trim().split(/\s+/)) if (w && !STOP.test(w)) unused.push(w);
  return { crit, read, unused };
}

const near = (a, b, tol = 0.0006) => a != null && b != null && Math.abs(a - b) <= tol;

export function matches(p, c, series = {}) {
  if (c.parts?.length) {
    const id = p.id.toUpperCase();
    return c.parts.some(t => { const k = t.replace(/\s/g, ''); return id === k || p.edp === k || (k.length >= 5 && id.startsWith(k)); });
  }
  if (c.dc && !near(p.dc, c.dc.in)) return false;
  if (c.dcMin != null && !(p.dc >= c.dcMin - 1e-6)) return false;
  if (c.dcMax != null && !(p.dc <= c.dcMax + 1e-6)) return false;
  if (c.nof?.length && !c.nof.includes(p.nof)) return false;
  if (c.corner?.length && !c.corner.includes(p.corner)) return false;
  if (c.re && !near(p.re, c.re.in, 0.0011)) return false;
  if (c.coating?.length && !c.coating.includes(p.coating ?? 'Not printed')) return false;
  if (c.series?.length && !c.series.includes(p.series.toUpperCase())) return false;
  if (c.loc && !near(p.apmx, c.loc.in, 0.0011)) return false;
  if (c.locMin != null && !(p.apmx >= c.locMin - 1e-6)) return false;
  if (c.locMax != null && !(p.apmx <= c.locMax + 1e-6)) return false;
  if (c.oal && !near(p.oal, c.oal.in, 0.0011)) return false;
  if (c.oalMin != null && !(p.oal >= c.oalMin - 1e-6)) return false;
  if (c.oalMax != null && !(p.oal <= c.oalMax + 1e-6)) return false;
  if (c.lu && !(p.lu != null && p.lu >= c.lu.in - 0.0011)) return false;
  if (c.shank && !near(p.dconms, c.shank.in, 0.0011)) return false;
  if (c.weldon && !/weldon|HB$/i.test(p.shank || '')) return false;
  if (c.micro && !(p.dc < 0.125 - 1e-6)) return false;
  const s = series[p.series] || {};
  if (c.chipbreaker && !(s.features || []).includes('chipbreaker')) return false;
  if (c.necked && !(p.lu != null || (s.features || []).some(f => /neck/.test(f)))) return false;
  if (c.material) {
    // Published sources only: the catalog's cutting-data tables (s.materials) and the material
    // icons on M.A. Ford's series web page (s.webIso, attached when the website data is loaded).
    const inCatalog = !!s.materials?.groups.includes(c.material);
    const onWeb = !!s.webIso?.includes(c.material);
    if (!inCatalog && !onWeb) return false;
    if (c.seriesTablesOnly && !(inCatalog && s.materials.scope === 'series')) return false;
  }
  return true;
}

export function search(products, crit, series = {}) {
  const out = products.filter(p => matches(p, crit, series));
  out.sort((a, b) => a.dc - b.dc || a.series.localeCompare(b.series) || (a.apmx ?? 0) - (b.apmx ?? 0) || (a.oal ?? 0) - (b.oal ?? 0) || a.id.localeCompare(b.id));
  return out;
}

export function facets(list) {
  const f = { nof: new Map(), corner: new Map(), coating: new Map(), series: new Map() };
  for (const p of list) for (const [k, v] of [['nof', p.nof], ['corner', p.corner], ['coating', p.coating ?? 'Not printed'], ['series', p.series]])
    f[k].set(v, (f[k].get(v) || 0) + 1);
  return f;
}

export { MM_PER_IN };
