// "Which M.A. Ford tools fit this job?" — series that M.A. Ford itself lists for the material group
// (website material icons and/or the catalog's cutting-data tables) and for the operation (website
// application icons), that are made in the requested diameter. Each match carries its reasons.
// Ranking is by how much published evidence matches, then by how many sizes fit; it is not a
// judgement of which tool is best.

const near = (a, b, tol = 0.0006) => a != null && b != null && Math.abs(a - b) <= tol;

export function seriesEvidence(id, series, web) {
  const s = series[id] || {}, w = web?.series?.[id] || {};
  const webIso = new Set((w.materials || []).map(m => m.iso).filter(Boolean));
  const catIso = new Set(s.materials?.groups || []);
  const apps = new Set((w.applications || []).map(a => a.name));
  return { webIso, catIso, catScope: s.materials?.scope || null, apps };
}

export function guide({ iso, op, dc, nof, corner }, products, series, web) {
  const bySeries = new Map();
  for (const p of products) {
    if (dc != null && !near(p.dc, dc)) continue;
    if (nof && p.nof !== nof) continue;
    if (corner && p.corner !== corner) continue;
    (bySeries.get(p.series) || bySeries.set(p.series, []).get(p.series)).push(p);
  }
  const out = [];
  for (const [id, tools] of bySeries) {
    const ev = seriesEvidence(id, series, web);
    const reasons = []; let score = 0;
    if (iso) {
      const onWeb = ev.webIso.has(iso), inCat = ev.catIso.has(iso);
      if (!onWeb && !inCat) continue;
      if (onWeb) { score += 2; reasons.push('website lists this material group'); }
      if (inCat) { score += ev.catScope === 'series' ? 2 : 1; reasons.push(ev.catScope === 'series' ? 'series cutting-data table covers it' : 'general GP cutting-data table covers it'); }
    }
    if (op) {
      if (!ev.apps.has(op)) continue;
      score += 2; reasons.push(`website lists ${op.toLowerCase()}`);
    }
    out.push({ id, tools, score, reasons, nofs: [...new Set(tools.map(t => t.nof))].sort((a, b) => a - b), coatings: [...new Set(tools.map(t => t.coating).filter(Boolean))] });
  }
  out.sort((a, b) => b.score - a.score || b.tools.length - a.tools.length || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return out;
}
