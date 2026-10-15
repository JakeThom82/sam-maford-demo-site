// M.A. Ford's published recommended cutting data (from the per-series Speed and Feed Data PDFs read
// by scripts/read-speedfeed.mjs), looked up for one job. Nothing here is calculated or estimated:
// values are returned exactly as printed, with the PDF page they came from.

const xD = s => { const m = String(s || '').match(/(≤\s*)?(\d*\.?\d+)\s*x\s*D/i); return m ? { max: +m[2], upTo: !!m[1], text: s } : null; };
const range = s => { const m = String(s || '').match(/^(\d+)(?:-(\d+))?$/); return m ? { lo: +m[1], hi: +(m[2] || m[1]), text: s } : null; };

// Which printed material rows fit the chosen material (only where the sheet splits a group).
function materialFits(row, materialId) {
  if (materialId === 'high-si-al') return /cast|>\s*10/i.test(row.material);
  if (materialId === 'aluminum') return !/cast|>\s*10/i.test(row.material);
  return true;
}

export function published({ series, dc, apmx, iso, materialId, op }, SF) {
  const sheet = SF?.[series];
  if (!sheet?.tables?.length || !(dc > 0)) return null;
  // Tables by cutting length (3xD, 4xD...): use the one nearest the tool's APMX / DC.
  const ratio = apmx > 0 ? apmx / dc : null;
  const tables = sheet.tables.filter(t => t.unit === 'in' || t.unit === 'mm');
  const withCol = tables.map(t => ({ t, col: t.diameters.find(d => Math.abs(d.in - dc) < 0.0011) })).filter(x => x.col);
  if (!withCol.length) return { pdf: sheet.pdf, noColumn: true, diameters: [...new Set(tables.flatMap(t => t.diameters.map(d => d.label)))] };
  withCol.sort((a, b) => (ratio && a.t.locXD && b.t.locXD ? Math.abs(a.t.locXD - ratio) - Math.abs(b.t.locXD - ratio) : 0) || (a.t.unit === 'in' ? -1 : 1));
  const { t, col } = withCol[0];
  let rows = t.rows.filter(r => r.fz[col.label] != null);
  if (iso) rows = rows.filter(r => r.iso === iso);
  if (materialId) { const fit = rows.filter(r => materialFits(r, materialId)); if (fit.length) rows = fit; }
  const all = rows;
  if (op === 'slot') rows = rows.filter(r => /slot/i.test(r.application));
  else if (op) rows = rows.filter(r => /profil|side|finish|rough|hem/i.test(r.application));
  return {
    pdf: sheet.pdf, page: t.page, title: t.title, unit: t.unit, locXD: t.locXD, column: col.label,
    rows: (rows.length ? rows : all).map(r => ({ ...r, fzAtD: r.fz[col.label], aeLim: xD(r.ae), apLim: xD(r.ap), vcRange: range(r.vc) })),
    opMatched: rows.length > 0,
  };
}
