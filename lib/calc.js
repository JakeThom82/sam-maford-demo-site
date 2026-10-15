// Milling calculator: cutting speed <-> spindle speed, chip load <-> feed, MRR, spindle limit.
// Pure functions. Inch mode: SFM, inches, in/tooth, IPM, in³/min. Metric mode: m/min, mm, mm/tooth,
// mm/min, cm³/min. These are the standard textbook relations; they say nothing about whether a
// setup is suitable for a tool, material or machine.

export const IN = 'in', MM = 'mm';
const K = { in: 12, mm: 1000 };          // SFM: 12 in/ft; m/min: 1000 mm/m

export function rpmFromSpeed(vc, d, units = IN) { return (vc * K[units]) / (Math.PI * d); }
export function speedFromRpm(n, d, units = IN) { return (n * Math.PI * d) / K[units]; }
export function feedFromChip(fz, z, n) { return fz * z * n; }
export function chipFromFeed(vf, z, n) { return vf / (z * n); }
// MRR: inch -> in³/min; metric -> cm³/min (mm³/min / 1000).
export function mrr(ae, ap, vf, units = IN) { return units === MM ? (ae * ap * vf) / 1000 : ae * ap * vf; }

const pos = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
const blank = v => v == null || v === '' || Number.isNaN(v);

// state: { units, d, z, vc, n, fz, vf, ae, ap, maxRpm, speedFrom: 'vc'|'n', feedFrom: 'fz'|'vf', tool? }
// tool (optional, same units as state): { d, nof, apmx, lu, re, corner, id }
export function compute(s) {
  const units = s.units === MM ? MM : IN;
  const out = { units, errors: [], warnings: [], notes: [], limited: false };
  const L = units === MM ? 'mm' : 'in';
  if (!pos(s.d)) out.errors.push('Enter a tool diameter greater than zero.');
  if (!(Number.isInteger(s.z) && s.z >= 1)) out.errors.push('Enter a whole number of flutes (1 or more).');
  if (!blank(s.maxRpm) && !pos(s.maxRpm)) out.errors.push('Max RPM must be greater than zero, or left blank.');
  for (const [k, label] of [['ae', 'Radial width (ae)'], ['ap', 'Axial depth (ap)']])
    if (!blank(s[k]) && s[k] !== 0 && !pos(s[k])) out.errors.push(`${label} must be greater than zero, or left blank.`);   // 0 = not set
  if (out.errors.length) return out;

  // Spindle speed. dEff: effective cutting diameter (ball nose cutting above its full diameter).
  const dv = pos(s.dEff) && s.dEff < s.d ? s.dEff : s.d;
  if (dv !== s.d) out.dEff = dv;
  let nReq = null;
  if (s.speedFrom === 'n') {
    if (blank(s.n)) { out.notes.push('Enter an RPM (or switch to cutting speed).'); }
    else if (!pos(s.n)) out.errors.push('RPM must be greater than zero.');
    else nReq = s.n;
  } else {
    if (blank(s.vc)) out.notes.push(`Enter a cutting speed (${units === MM ? 'm/min' : 'SFM'}).`);
    else if (!pos(s.vc)) out.errors.push('Cutting speed must be greater than zero.');
    else nReq = rpmFromSpeed(s.vc, dv, units);
  }
  if (out.errors.length || nReq == null) return out;
  out.nRequested = nReq;
  out.n = nReq;
  if (pos(s.maxRpm) && nReq > s.maxRpm) {
    out.n = s.maxRpm; out.limited = true;
    out.warnings.push(`Spindle limited to ${fmt(s.maxRpm, 0)} RPM (asked for ${fmt(nReq, 0)}). Cutting speed and feed below are recalculated at ${fmt(s.maxRpm, 0)} RPM.`);
  }
  out.vc = speedFromRpm(out.n, dv, units);

  // Feed
  if (s.feedFrom === 'vf') {
    if (blank(s.vf)) out.notes.push(`Enter a feed (${units === MM ? 'mm/min' : 'IPM'}) or switch to chip load.`);
    else if (!pos(s.vf)) out.errors.push('Feed must be greater than zero.');
    else { out.vf = s.vf; out.fz = chipFromFeed(s.vf, s.z, out.n); if (out.limited) out.warnings.push('Feed is held at the value you entered, so the chip load per tooth rises at the limited RPM.'); }
  } else {
    if (blank(s.fz)) out.notes.push(`Enter a chip load (${units === MM ? 'mm' : 'in'}/tooth).`);
    else if (!pos(s.fz)) out.errors.push('Chip load must be greater than zero.');
    else { out.fz = s.fz; out.vf = feedFromChip(s.fz, s.z, out.n); }
  }
  if (out.vf != null && pos(s.ae) && pos(s.ap)) out.mrr = mrr(s.ae, s.ap, out.vf, units);
  else if (out.vf != null) out.notes.push('Enter ae and ap for the metal removal rate.');

  // Geometry checks against the inputs and, when a catalog tool is loaded, its printed dimensions.
  if (pos(s.ae) && s.ae > s.d + 1e-9) out.warnings.push(`Radial width ae (${fmt(s.ae)} ${L}) is larger than the diameter (${fmt(s.d)} ${L}).`);
  const t = s.tool;
  if (t) {
    if (pos(s.ap) && pos(t.apmx) && s.ap > t.apmx + 1e-9) out.warnings.push(`Axial depth ap (${fmt(s.ap)} ${L}) is more than the tool's cutting length APMX (${fmt(t.apmx)} ${L}).`);
    if (pos(t.d) && Math.abs(t.d - s.d) > (units === MM ? 0.005 : 0.0002)) out.warnings.push(`Diameter (${fmt(s.d)} ${L}) differs from the loaded tool ${t.id} (${fmt(t.d)} ${L}).`);
    if (Number.isInteger(t.nof) && t.nof !== s.z) out.warnings.push(`Flutes (${s.z}) differ from the loaded tool ${t.id} (${t.nof}).`);
  }
  out.aeRatio = pos(s.ae) ? s.ae / s.d : null;
  return out;
}

export function fmt(v, places) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (places == null) places = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 3 : 4;
  return Number(v.toFixed(places)).toLocaleString('en-US', { maximumFractionDigits: places });
}

// Convert a calculator state between inch and metric. Lengths x25.4, SFM x0.3048 = m/min.
export function convert(s, to) {
  if (s.units === to) return { ...s };
  const f = to === MM ? 25.4 : 1 / 25.4, v = to === MM ? 0.3048 : 1 / 0.3048;
  const c = x => (blank(x) ? x : x * f);
  const out = { ...s, units: to, d: c(s.d), fz: c(s.fz), vf: c(s.vf), ae: c(s.ae), ap: c(s.ap), vc: blank(s.vc) ? s.vc : s.vc * v };
  if (s.tool) out.tool = { ...s.tool, d: c(s.tool.d), apmx: c(s.tool.apmx), lu: c(s.tool.lu), re: c(s.tool.re) };
  return out;
}
