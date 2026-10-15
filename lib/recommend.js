// M.A. Ford catalog recommendations for one job: tool (series, diameter, flutes, end form, coating),
// workpiece material and toolpath (slot or side pass with ae, ap). Everything comes from the catalog's
// "Recommended Cutting Data" tables (app/data/cutting.json); the method is the one printed on those
// pages. Pure functions, tested in tests/recommend.test.mjs.
//
//   vc  : the speed in the engagement column at or wider than the job's ae (side pass) or ap (slot)
//         (the "next wider column", conservative); the interpolated value is returned too.
//   fz  : the chip load in the diameter column at or below the tool's diameter ("next smaller").
//   chip thinning: on side passes fz is multiplied by the printed factor for that column, except when
//         finishing ("When finishing, use the standard fz ... Only add chip thinning when roughing or
//         semi-finishing").
//   ball nose: when ap is less than the ball diameter, speed is figured on the effective diameter.
//   coating: "Increase speeds by N% for <coating> coated tools" notes are applied as printed.
//   checks : out-of-spec conditions, each with the catalog wording or page that sets the limit.

const EPS = 1e-6;

// Which table set applies: the series' own tables, the base series for a variant (138BN -> 138B,
// 334N -> 334), or the general-purpose tables for GP series.
export function tablesFor(tool, tables, series = {}) {
  const inch = tables.filter(t => t.unit === 'in');
  const ids = [tool.series, tool.series.replace(/N$/, ''), tool.series.replace(/C$/, ''), tool.series.replace(/(CB|L|S)$/, '')];
  for (const id of [...new Set(ids)]) {
    const own = inch.filter(t => t.series.includes(id));
    if (own.length) return { tables: own, via: id === tool.series ? null : id };
  }
  const s = series[tool.series];
  if (s?.doc === 'gp' || (s?.materials?.scope === 'general-purpose')) {
    const gp = inch.filter(t => t.scope === 'general-purpose');
    if (gp.length) return { tables: gp, via: 'general-purpose' };
  }
  return { tables: [], via: null };
}

const col = (cols, pct) => cols.findIndex(c => c >= pct - EPS);

export function recommend({ tool, materialId, materialIso, type, ae, ap, finishing = false }, tables, series = {}) {
  const out = { checks: [], notes: [], source: null };
  const D = tool.dc;
  if (!(D > 0) || !materialId || !type) return null;
  const set = tablesFor(tool, tables, series);
  if (!set.tables.length) return { ...out, none: true, why: `M.A. Ford's catalog tables for Series ${tool.series} have not been read (or it has none).` };
  const op = type === 'slot' ? 'slot' : 'profile';
  const opTables = set.tables.filter(t => t.op === op);
  if (!opTables.length) {
    if (op === 'slot') return { ...out, none: true, noSlot: true, why: `M.A. Ford publishes no slotting data for Series ${set.via && set.via !== 'general-purpose' ? set.via : tool.series}.` };
    return { ...out, none: true, why: `No ${op === 'slot' ? 'slotting' : 'profile milling'} table read for Series ${tool.series}.` };
  }
  // Table with a row for the material (several tables can be split by length, e.g. 3xD / 4xD).
  const loc = tool.apmx > 0 ? tool.apmx / D : null;
  const cands = opTables.map(t => ({ t, row: t.rows.find(r => r.materials.includes(materialId) && (!materialIso || r.iso === materialIso)) })).filter(x => x.row);
  if (!cands.length) return { ...out, none: true, noRow: true, why: `M.A. Ford's ${op === 'slot' ? 'slotting' : 'profile milling'} table for Series ${tool.series} (page ${opTables[0].page}) has no row for this material.`, page: opTables[0].page };
  cands.sort((a, b) => {
    const xa = (a.t.title.match(/(\d+(?:\.\d+)?)\s*x\s*D/i) || [])[1], xb = (b.t.title.match(/(\d+(?:\.\d+)?)\s*x\s*D/i) || [])[1];
    return loc && xa && xb ? Math.abs(xa - loc) - Math.abs(xb - loc) : 0;
  });
  const { t, row } = cands[0];
  out.source = { page: t.page, pdfPage: t.pdfPage, doc: t.doc, title: t.title, via: set.via, row: row.name.replace(/\s+\d.*$/, '').slice(0, 80) || row.name.slice(0, 80) };

  // Engagement column: ae (side pass) or ap (slot) as % of D.
  const pct = (t.kind === 'ap' ? ap : ae) / D * 100;
  const ci = col(t.cols, pct);
  if (ci < 0) out.checks.push(`${t.kind === 'ap' ? 'Axial depth' : 'Radial width'} ${pct.toFixed(0)}% of D is beyond M.A. Ford's widest column (${t.cols.at(-1)}%, page ${t.page}).`);
  const use = ci < 0 ? t.cols.length - 1 : ci;
  let vc = row.vc[use];
  if (vc == null) out.checks.push(`M.A. Ford prints no speed for ${t.cols[use]}% ${t.kind} in this material (page ${t.page}).`);
  // Interpolated speed between the neighbouring columns (shown beside the printed one).
  let vcInterp = vc;
  if (ci > 0 && row.vc[ci] != null && row.vc[ci - 1] != null) {
    const p0 = t.cols[ci - 1], p1 = t.cols[ci];
    vcInterp = row.vc[ci - 1] + (row.vc[ci] - row.vc[ci - 1]) * (pct - p0) / (p1 - p0);
  }
  // Coating adjustment printed on the page.
  for (const c of t.rules?.coating || []) {
    const word = c.coating.split(/\s+/)[0].toLowerCase();
    if (tool.coating && tool.coating.toLowerCase().includes(word) && vc != null) {
      vc *= 1 + c.pct / 100; vcInterp *= 1 + c.pct / 100;
      out.notes.push(`Speed +${c.pct}% for ${c.coating} coated tools (page ${t.page}).`);
    }
  }
  // Chip load: diameter column at or below the tool.
  const dcol = [...t.diameters].reverse().find(d => d.in <= D + 0.0006);
  if (!dcol) out.checks.push(`Diameter is below the smallest column of M.A. Ford's table (${t.diameters[0].label}", page ${t.page}).`);
  const fzBase = dcol ? row.fz[dcol.label] : null;
  if (dcol && fzBase == null) out.checks.push(`M.A. Ford prints no chip load for ${dcol.label}" in this material (page ${t.page}).`);
  let factor = 1;
  if (op === 'profile' && t.factors && !finishing && ci >= 0) factor = t.factors[use];
  const fz = fzBase != null ? fzBase * factor : null;
  // Effective diameter for ball nose when ap is less than the ball diameter (printed rule).
  let dEff = D;
  if (tool.corner === 'ball' && ap > 0 && ap < D / 2) { dEff = 2 * Math.sqrt(ap * (D - ap)); out.notes.push(`Ball nose: speed figured on the effective diameter ${dEff.toFixed(4)}" (ap below the ball radius), as the catalog states.`); }
  // Depth rules printed on the page.
  for (const r of t.rules?.aeApRules || []) {
    if (op !== 'profile') continue;
    const aeX = ae / D, apX = ap / D;
    const applies = r.cmp === '>' ? aeX > r.aeX + EPS : aeX < r.aeX - EPS;
    if (applies && apX > r.apMaxX + EPS) out.checks.push(`M.A. Ford: "ae ${r.cmp} ${r.aeX}D use < ${r.apMaxX}D ap" — ap is ${apX.toFixed(2)}×D (page ${t.page}).`);
  }
  const sd = t.rules?.smallDia;
  if (sd && D <= sd.maxD + 0.0006 && (sd.strict ? pct > sd.pct + EPS : pct >= sd.pct - EPS)) out.checks.push(`M.A. Ford: "${sd.text.replace(/\s+/g, ' ')}" (page ${t.page}).`);
  if (t.rules?.balanceRpm) out.balanceRpm = t.rules.balanceRpm;
  Object.assign(out, { vc, vcInterp, vcColumn: t.cols[use], pct, fz, fzBase, factor, fzColumn: dcol?.label, diameterIn: dcol?.in, dEff, kind: t.kind, cols: t.cols, finishing });
  return out;
}
