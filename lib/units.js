// Length parsing and formatting. Internal unit: inches.

export const MM_PER_IN = 25.4;

const WORD_SIZES = {
  'half': 0.5, 'quarter': 0.25, 'eighth': 0.125, 'three quarter': 0.75, 'three-quarter': 0.75,
  'three eighths': 0.375, 'three-eighths': 0.375, 'five eighths': 0.625, 'five-eighths': 0.625,
  'one': 1, 'an': 1, 'one inch': 1,
};

// Parse a length typed by a machinist: 1/2, 1-1/2, 1 1/2, .5, 0.500, 1/2", 12mm, 12 mm, 6.35mm.
// Returns { in, unit: 'in'|'mm', text } or null.
export function parseLength(raw, defaultUnit = 'in') {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/[″”"]/g, ' in').replace(/\s+/g, ' ');
  let unit = defaultUnit;
  if (/\s*(mm|millimet(er|re)s?)$/.test(s)) { unit = 'mm'; s = s.replace(/\s*(mm|millimet(er|re)s?)$/, ''); }
  else if (/\s*(in|inch|inches)$/.test(s)) { unit = 'in'; s = s.replace(/\s*(in|inch|inches)$/, ''); }
  s = s.trim();
  if (s in WORD_SIZES) return { in: WORD_SIZES[s], unit: 'in', text: raw };
  let v = null, m;
  if ((m = s.match(/^(\d+)[- ](\d+)\/(\d+)$/))) v = +m[1] + +m[2] / +m[3];
  else if ((m = s.match(/^(\d+)\/(\d+)$/))) v = +m[1] / +m[2];
  else if (/^(\d+\.?\d*|\.\d+)$/.test(s)) v = parseFloat(s);
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return { in: unit === 'mm' ? v / MM_PER_IN : v, unit, text: raw };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// 0.5 -> 1/2", 1.5 -> 1-1/2", 0.0469 -> .0469" (only exact 64ths become fractions).
export function fractionInches(v) {
  if (v == null || !Number.isFinite(v)) return '';
  const n64 = Math.round(v * 64);
  if (Math.abs(n64 / 64 - v) > 1e-5 || n64 === 0) return null;
  const whole = Math.floor(n64 / 64), rem = n64 % 64;
  if (!rem) return `${whole}`;
  const g = gcd(rem, 64);
  return `${whole ? whole + '-' : ''}${rem / g}/${64 / g}`;
}

export function decimalInches(v, places = 4) {
  if (v == null || !Number.isFinite(v)) return '';
  const s = v.toFixed(places);
  return v < 1 ? s.replace(/^0/, '') : s;
}

export function mm(v, places = 3) {
  if (v == null || !Number.isFinite(v)) return '';
  return String(+(v * MM_PER_IN).toFixed(places));
}

// Inch first, metric beside it: 1/2" (.5000") · 12.7 mm
export function both(v) {
  if (v == null) return '—';
  const f = fractionInches(v);
  return `${f ? f + '"' : decimalInches(v) + '"'} · ${mm(v)} mm`;
}
