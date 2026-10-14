// SAM — M.A. Ford tooling demo. Independent prototype; not an M.A. Ford product.
import { parseLength, fractionInches, decimalInches, mm as toMm, MM_PER_IN } from './lib/units.js';
import { parseQuery, search, ISO_GROUPS } from './lib/search.js';
import { compute, convert, fmt } from './lib/calc.js';
import * as setups from './lib/setups.js';

const view = document.getElementById('view');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = (() => { try { const k = '__t'; localStorage.setItem(k, k); localStorage.removeItem(k); return localStorage; } catch { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; } })();
const persistent = store !== null && (() => { try { return !!window.localStorage; } catch { return false; } })();

let DATA = null, BY_ID = new Map(), SERIES_IDS = [];
const CORNERS = { square: 'Square end', 'corner radius': 'Corner radius', ball: 'Ball nose', oval: 'Oval form' };
const DOC_SHORT = { gp: 'FORDMAX GP end mill section', hp: 'APG HP end mill section' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- formatting ----------
const inch = v => { if (v == null) return '—'; const f = fractionInches(v); return f ? `${f}"` : `${decimalInches(v)}"`; };
const dualLen = v => v == null ? '—' : `${inch(v)} <small class="muted">${toMm(v)} mm</small>`;
function dia(p) { return p.sys === 'mm' && p.t?.DC ? `${p.t.DC.replace(' mm', '')} mm` : inch(p.dc); }
function corner(p) {
  if (p.corner === 'corner radius' && p.re != null) return `R ${p.t?.RE || inch(p.re)}`;
  if (p.corner === 'corner radius' && p.camre != null) return `CAM-RE ${p.t['CAM-RE']}`;
  return CORNERS[p.corner] || '—';
}
const lenText = (p, key, code) => p[key] == null ? null : (p.sys === 'mm' && p.t?.[code] ? p.t[code] : inch(p[key]));
function specLine(p) {
  return [`${p.nof ?? '?'} fl`, corner(p), lenText(p, 'apmx', 'APMX') && `LOC ${lenText(p, 'apmx', 'APMX')}`, lenText(p, 'oal', 'OAL') && `OAL ${lenText(p, 'oal', 'OAL')}`,
    p.lu != null && `reach ${lenText(p, 'lu', 'LU')}`, p.coating || 'coating not printed', `Series ${p.series}`].filter(Boolean).join(' · ');
}
function catalogLink(doc, pdfPage, label) {
  const d = DATA.catalogs.documents[doc];
  return `<a class="ext" href="${esc(d.url)}#page=${pdfPage}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

// ---------- routing ----------
function route() {
  const h = location.hash || '#/find';
  const [path, query] = h.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  const tab = { find: 'find', tool: 'find', calc: 'calc', saved: 'saved', catalogs: 'catalogs' }[parts[0]] || 'find';
  for (const a of document.querySelectorAll('.tabs a')) a.toggleAttribute('aria-current', a.dataset.tab === tab), a.dataset.tab === tab && a.setAttribute('aria-current', 'page');
  if (!DATA) { view.innerHTML = '<p class="empty">Loading catalog data…</p>'; return; }
  if (parts[0] === 'tool') return renderTool(decodeURIComponent(parts[1] || ''));
  if (parts[0] === 'calc') return renderCalc(params);
  if (parts[0] === 'saved') return renderSaved();
  if (parts[0] === 'catalogs') return renderCatalogs();
  return renderFind(params);
}
window.addEventListener('hashchange', () => { route(); view.focus({ preventScroll: true }); window.scrollTo(0, 0); });

// ---------- Find Tools ----------
const find = { q: '', dc: '', re: '', nof: new Set(), corner: new Set(), coating: new Set(), series: '', material: '', seriesOnly: false, locMin: '', locMax: '', oalMin: '', oalMax: '', limit: 40, open: false };
const EXAMPLES = ['1/2 4 flute', '3/8 ball nose', '12mm corner radius 1mm', 'half inch 3 flute aluminum', '1/4 x 3/4 x 2-1/2', '.030r stainless 5 flute', '27712500B'];

function findCriteria() {
  const parsed = parseQuery(find.q, SERIES_IDS);
  const c = { ...parsed.crit };
  const L = s => parseLength(s);
  if (find.dc.trim()) { const v = L(find.dc); if (v) c.dc = v; }
  if (find.re.trim()) { const v = L(find.re); if (v) { c.re = v; c.corner = ['corner radius']; } }
  if (find.nof.size) c.nof = [...find.nof];
  if (find.corner.size) c.corner = [...find.corner];
  if (find.coating.size) c.coating = [...find.coating];
  if (find.series) c.series = [find.series];
  if (find.material) c.material = find.material;
  if (c.material && find.seriesOnly) c.seriesTablesOnly = true;
  for (const k of ['locMin', 'locMax', 'oalMin', 'oalMax']) if (find[k].trim()) { const v = L(find[k]); if (v) c[k] = v.in; }
  return { c, parsed };
}

function facetCounts(c, key) {
  const base = { ...c }; delete base[key];
  if (key === 'corner' && base.re) delete base.re;
  const m = new Map();
  for (const p of search(DATA.products, base, DATA.series)) { const v = key === 'coating' ? (p.coating ?? 'Not printed') : p[key]; m.set(v, (m.get(v) || 0) + 1); }
  return m;
}

function renderFind() {
  const { c, parsed } = findCriteria();
  const results = search(DATA.products, c, DATA.series);
  // With a material chosen, series with their own cutting-data table come before the general GP table.
  if (c.material) results.sort((x, y) => (DATA.series[x.series]?.materials?.scope === 'series' ? 0 : 1) - (DATA.series[y.series]?.materials?.scope === 'series' ? 0 : 1));
  const total = DATA.products.length;
  const anyFilter = Object.keys(c).length > 0;
  const chip = (group, value, label, count) => `<button type="button" class="chip" data-f="${group}" data-v="${esc(value)}" aria-pressed="${find[group].has(value)}">${esc(label)} <span class="n">${count ?? 0}</span></button>`;
  const fn = facetCounts(c, 'nof'), fc = facetCounts(c, 'corner'), fco = facetCounts(c, 'coating');
  const nofs = [...new Set(DATA.products.map(p => p.nof))].filter(Boolean).sort((a, b) => a - b);
  const coatings = [...new Set(DATA.products.map(p => p.coating ?? 'Not printed'))].sort();
  const mat = c.material;
  view.innerHTML = `
  <h1 class="sr">Find tools</h1>
  <div class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
    <input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Describe a tool" placeholder="Describe a tool: 1/2 4 flute ball, 12mm, 27712500B" value="${esc(find.q)}">
  </div>
  ${find.q ? `<p class="read">${parsed.read.length ? `<b>Read as:</b> ${parsed.read.map(esc).join(' · ')}` : ''}${parsed.unused.length ? `${parsed.read.length ? '<br>' : ''}<b>Not used:</b> ${parsed.unused.map(esc).join(', ')} <small>(words the search does not understand are ignored)</small>` : ''}</p>` : `<div class="chips" style="margin-top:10px" aria-label="Example searches">${EXAMPLES.map(e => `<button type="button" class="chip" data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div>`}
  <details class="card filters" style="margin-top:12px" ${find.open ? 'open' : ''}>
    <summary>Filters ${anyFilter ? `<span class="tag ok">${results.length.toLocaleString()} match</span>` : ''}</summary>
    <div class="grid2 fgroup">
      <div><label for="f-dc">Diameter</label><input id="f-dc" data-k="dc" inputmode="text" placeholder='1/2, .375, 12mm' value="${esc(find.dc)}"></div>
      <div><label for="f-re">Corner radius</label><input id="f-re" data-k="re" placeholder='.030, 0.5mm' value="${esc(find.re)}"></div>
    </div>
    <div class="fgroup"><div class="label">Flutes</div><div class="chips">${nofs.map(n => chip('nof', n, `${n}`, fn.get(n))).join('')}</div></div>
    <div class="fgroup"><div class="label">Corner style</div><div class="chips">${Object.entries(CORNERS).map(([k, v]) => chip('corner', k, v, fc.get(k))).join('')}</div></div>
    <div class="grid2 fgroup">
      <div><label for="f-locMin">Cutting length (APMX) min</label><input id="f-locMin" data-k="locMin" placeholder="e.g. 1/2" value="${esc(find.locMin)}"></div>
      <div><label for="f-locMax">max</label><input id="f-locMax" data-k="locMax" placeholder="e.g. 1-1/4" value="${esc(find.locMax)}"></div>
      <div><label for="f-oalMin">Overall length (OAL) min</label><input id="f-oalMin" data-k="oalMin" placeholder="e.g. 2" value="${esc(find.oalMin)}"></div>
      <div><label for="f-oalMax">max</label><input id="f-oalMax" data-k="oalMax" placeholder="e.g. 4" value="${esc(find.oalMax)}"></div>
    </div>
    <div class="fgroup"><div class="label">Coating</div><div class="chips">${coatings.map(k => chip('coating', k, k, fco.get(k))).join('')}</div></div>
    <div class="grid2 fgroup">
      <div><label for="f-series">Series</label><select id="f-series" data-k="series"><option value="">Any series</option>${SERIES_IDS.map(s => `<option value="${esc(s)}" ${find.series === s ? 'selected' : ''}>${esc(DATA.series[s].title)}</option>`).join('')}</select></div>
      <div><label for="f-mat">Workpiece material</label><select id="f-mat" data-k="material"><option value="">Any material</option>${Object.entries(ISO_GROUPS).map(([g, n]) => `<option value="${g}" ${find.material === g ? 'selected' : ''}>${g} · ${esc(n)}</option>`).join('')}</select></div>
    </div>
    <p class="muted" style="font-size:.82rem">Material matches come only from the ISO groups printed in M.A. Ford's recommended cutting-data tables, never from coating. GP series are covered by the catalog's general-purpose table rather than series tables.
      <label style="display:flex;gap:.5rem;align-items:center;margin-top:.4rem;color:var(--text)"><input type="checkbox" id="f-seriesOnly" style="width:auto;min-height:auto" ${find.seriesOnly ? 'checked' : ''}> Series-specific tables only</label></p>
    <button type="button" class="btn small" id="f-clear">Clear search and filters</button>
  </details>
  <p class="coverage">${results.length === total && !anyFilter ? `${total.toLocaleString()} end mills loaded` : `<b>${results.length.toLocaleString()}</b> of ${total.toLocaleString()} end mills loaded`} — the GP and HP end-mill sections of the Vol. 105 catalog only, not the whole M.A. Ford catalog. <a href="#/catalogs">What's covered</a></p>
  ${mat ? `<p class="note info">Showing series whose catalog cutting-data tables list ISO ${mat} (${esc(ISO_GROUPS[mat])}). A listing gives starting data in the catalog; it does not mean every tool suits every job.</p>` : ''}
  <ul class="results">${results.slice(0, find.limit).map(p => `<li><a class="result" href="#/tool/${encodeURIComponent(p.id)}">
      <div class="t"><span class="id mono">${esc(p.tool)}</span><span class="dia">${esc(dia(p))}${p.sys === 'mm' ? '' : ` <small class="muted">${toMm(p.dc)} mm</small>`}</span></div>
      <div class="specs">${esc(specLine(p))}${mat ? ` · <span class="tag">${DATA.series[p.series]?.materials?.scope === 'series' ? 'series table' : 'general GP table'}</span>` : ''}</div></a></li>`).join('')}</ul>
  ${results.length === 0 ? `<div class="empty">No loaded end mill matches. ${anyFilter ? 'Try removing a filter.' : ''}<br><small>Only the GP and HP end-mill sections are loaded; drills, taps and other tools are not.</small></div>` : ''}
  ${results.length > find.limit ? `<button type="button" class="btn" id="more" style="width:100%">Show ${Math.min(40, results.length - find.limit)} more of ${(results.length - find.limit).toLocaleString()}</button>` : ''}`;

  const q = $('#q');
  q.addEventListener('input', () => { find.q = q.value; find.limit = 40; clearTimeout(renderFind.t); renderFind.t = setTimeout(() => rerenderFind('#q'), 150); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { q.blur(); } });
  view.querySelectorAll('[data-example]').forEach(b => b.addEventListener('click', () => { find.q = b.dataset.example; rerenderFind(); }));
  view.querySelectorAll('.chip[data-f]').forEach(b => b.addEventListener('click', () => {
    const set = find[b.dataset.f]; let v = b.dataset.v; if (b.dataset.f === 'nof') v = +v;
    set.has(v) ? set.delete(v) : set.add(v); find.limit = 40; rerenderFind();
  }));
  view.querySelectorAll('input[data-k], select[data-k]').forEach(i => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
    find[i.dataset.k] = i.value; find.limit = 40;
    const bad = i.tagName === 'INPUT' && i.value.trim() && !parseLength(i.value);
    i.setAttribute('aria-invalid', bad ? 'true' : 'false');
    clearTimeout(renderFind.t); renderFind.t = setTimeout(() => rerenderFind('#' + i.id), i.tagName === 'SELECT' ? 0 : 300);
  }));
  $('#f-seriesOnly').addEventListener('change', e => { find.seriesOnly = e.target.checked; rerenderFind(); });
  $('details.filters').addEventListener('toggle', e => { find.open = e.target.open; });
  $('#f-clear').addEventListener('click', () => { Object.assign(find, { q: '', dc: '', re: '', series: '', material: '', seriesOnly: false, locMin: '', locMax: '', oalMin: '', oalMax: '', limit: 40 }); find.nof.clear(); find.corner.clear(); find.coating.clear(); rerenderFind(); });
  $('#more')?.addEventListener('click', () => { find.limit += 40; rerenderFind(); });
}
function rerenderFind(focusSel) {
  const active = focusSel || (document.activeElement?.id ? '#' + document.activeElement.id : null);
  const pos = document.activeElement?.selectionStart;
  renderFind();
  if (active) { const el = $(active); if (el) { el.focus({ preventScroll: true }); try { if (pos != null) el.setSelectionRange(pos, pos); } catch {} } }
}

// ---------- Tool detail ----------
function renderTool(id) {
  const p = BY_ID.get(id);
  if (!p) { view.innerHTML = `<div class="card"><h1>Tool not found</h1><p>No loaded end mill has the number <span class="mono">${esc(id)}</span>.</p><a class="btn" href="#/find">Find tools</a></div>`; return; }
  const s = DATA.series[p.series] || {};
  const doc = DATA.catalogs.documents[p.doc];
  const DIMS = [['DC', 'dc', 'Cutting diameter (DC)'], ['DCONMS', 'dconms', 'Shank diameter (DCONMS)'], ['APMX', 'apmx', 'Cutting length (APMX)'], ['OAL', 'oal', 'Overall length (OAL)'],
    ['LU', 'lu', 'Usable length / reach (LU)'], ['DN', 'dn', 'Neck diameter (DN)'], ['RE', 're', 'Corner radius (RE)'], ['CAM-RE', 'camre', 'CAM programming radius (CAM-RE)'], ['LH', 'lh', 'Head length (LH)'], ['PRFRAD', 'prfrad', 'Profile radius (PRFRAD)']];
  const rows = DIMS.filter(([code, key]) => p[key] != null || p.t?.[code]).map(([code, key, label]) => {
    const printed = p.t?.[code] || (code === 'DC' ? inch(p.dc) : '');
    const conv = p[key] == null ? '' : p.sys === 'mm' ? `${decimalInches(p[key])}"` : `${toMm(p[key])} mm`;
    return `<tr><th>${label}</th><td><b>${esc(printed)}</b> <small class="muted">${esc(conv)}${code === 'DC' && p.sys !== 'mm' ? ` · decimal ${decimalInches(p.dc)}"` : ''}</small></td></tr>`;
  }).join('');
  const nofSource = s.nof === 'table' ? 'printed in the product table' : `series table of contents (${esc(s.toc || '')})`;
  const mats = s.materials;
  const cutPages = (s.cuttingData || []).map(c => c.page);
  const unread = !mats && (s.cuttingData || []).length ? '' : '';
  view.innerHTML = `
  <p><a href="#/find">‹ Results</a></p>
  <div class="card">
    <div class="row"><h1 class="grow mono" style="margin:0">${esc(p.tool)}</h1><span class="tag">EDP ${esc(p.edp)}</span></div>
    <p style="margin:.3rem 0 0"><b>${esc(dia(p))}</b> ${esc(s.line || '')} Series ${esc(p.series)} · ${esc(p.nof ?? '?')} flutes · ${esc(corner(p))} · ${esc(p.coating || 'coating not printed in the table')}${p.shank ? ` · ${esc(p.shank)} shank` : ''}</p>
  </div>
  <div class="split">
    <div>
      <div class="card"><h2>Dimensions</h2>
        <table class="dims"><tbody>${rows}
          <tr><th>Flutes (NOF)</th><td><b>${esc(p.nof ?? 'not stated')}</b> <small class="muted">from the ${nofSource}</small></td></tr>
          <tr><th>End form</th><td><b>${esc(CORNERS[p.corner] || '—')}</b>${p.corner === 'square' ? ' <small class="muted">no corner radius printed for this tool</small>' : ''}</td></tr>
          ${p.reach ? `<tr><th>Reach (LU/DC)</th><td><b>${esc(p.reach)}×D</b></td></tr>` : ''}
          ${p.type ? `<tr><th>Type</th><td><b>${esc(p.type)}</b></td></tr>` : ''}
          ${s.helix ? `<tr><th>Helix</th><td>${esc(s.helix)} <small class="muted">series value</small></td></tr>` : ''}
          ${p.stocked != null ? `<tr><th>Stock status</th><td>${p.stocked ? 'Stocked' : 'Non-stocked'} <small class="muted">as printed</small></td></tr>` : ''}
        </tbody></table>
        ${p.flags?.length ? `<div class="note warn"><b>Reading notes</b><ul>${p.flags.map(f => `<li>${esc(f === 'footnote' ? 'The decimal size carries a catalog footnote (*); see the printed page.' : f)}</li>`).join('')}</ul></div>` : ''}
        <p class="muted" style="font-size:.85rem">No product image: this demo shows only documented data. The catalog page has M.A. Ford's drawing.</p>
      </div>
      <a class="btn primary" style="width:100%;margin-bottom:12px" href="#/calc?tool=${encodeURIComponent(p.id)}">Load into calculator</a>
    </div>
    <div>
      <div class="card"><h2>Application</h2>
        ${mats ? `<p>${mats.scope === 'series' ? `M.A. Ford's cutting-data tables for this series (pages ${cutPages.join(', ')}) list these ISO material groups:` : `This GP series is covered by the catalog's <b>general-purpose</b> end-mill cutting-data tables (pages ${esc((mats.pages || []).join(', '))}), which list:`}</p>
          <div class="chips">${mats.groups.map(g => `<span class="chip" style="cursor:default">${g} · ${esc(ISO_GROUPS[g])}</span>`).join('')}</div>
          <p class="muted" style="font-size:.85rem">The catalog gives starting speeds and feeds for these groups. Open the page for the specific materials, hardness and values.</p>`
        : `<p>No material groups were read for this series.${cutPages.length ? ` The catalog has cutting data for it on pages ${cutPages.join(', ')}, in a layout this demo does not read yet.` : ''}</p>`}
        ${s.notes?.length ? `<h3>From the series page</h3><ul>${s.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${s.features?.length ? `<p><span class="muted">Features:</span> ${s.features.map(esc).join(', ')}</p>` : ''}
      </div>
      <div class="card"><h2>Source</h2>
        <dl class="kv">
          <dt>Document</dt><dd>${esc(doc.title)}</dd>
          <dt>Printed page</dt><dd>${esc(p.page)}</dd>
          <dt>PDF page</dt><dd>${esc(p.pdfPage)} of ${esc(doc.pages)}</dd>
        </dl>
        <div class="list-actions">${catalogLink(p.doc, p.pdfPage, `Open catalog page ${p.page}`)}</div>
        <p class="muted" style="font-size:.82rem">Opens M.A. Ford's PDF (${(doc.bytes / 1e6).toFixed(0)} MB) on maford.com. Some phone viewers open it at the first page; go to PDF page ${esc(p.pdfPage)}.</p>
      </div>
    </div>
  </div>`;
}

// ---------- Calculator ----------
const EX = { in: { vc: 400, fz: 0.002 }, mm: { vc: 120, fz: 0.05 } };
const CALC_KEY = 'sam-maford-calc-v1', MAXRPM_KEY = 'sam-maford-maxrpm';
let calc = loadCalc();
function loadCalc() {
  const base = { units: 'in', d: undefined, z: undefined, vc: undefined, n: undefined, fz: undefined, vf: undefined, ae: undefined, ap: undefined, maxRpm: undefined, speedFrom: 'vc', feedFrom: 'fz', toolId: null, examples: {} };
  try { Object.assign(base, JSON.parse(store.getItem(CALC_KEY) || '{}')); } catch {}
  const m = parseFloat(store.getItem(MAXRPM_KEY)); if (m > 0) base.maxRpm = m;
  return base;
}
function saveCalc() { try { store.setItem(CALC_KEY, JSON.stringify(calc)); if (calc.maxRpm > 0) store.setItem(MAXRPM_KEY, String(calc.maxRpm)); else store.removeItem(MAXRPM_KEY); } catch {} }
function toolInUnits(p, units) {
  if (!p) return null;
  const f = units === 'mm' ? MM_PER_IN : 1;
  return { id: p.id, d: p.dc * f, nof: p.nof, apmx: p.apmx != null ? p.apmx * f : null, lu: p.lu != null ? p.lu * f : null, re: p.re != null ? p.re * f : null };
}
function loadTool(p, units = calc.units) {
  calc.toolId = p.id;
  // Metric catalog tools use their printed mm size; inch tools their decimal size.
  if (units === 'mm') calc.d = p.sys === 'mm' && p.t?.DC ? parseFloat(p.t.DC) : +(p.dc * MM_PER_IN).toFixed(4);
  else calc.d = p.dc;
  calc.z = p.nof ?? calc.z;
}

function renderCalc(params) {
  if (params?.get('tool')) { const p = BY_ID.get(params.get('tool')); if (p) { if (p.sys === 'mm' && !calc.d) calc.units = 'mm'; loadTool(p); saveCalc(); } history.replaceState(null, '', '#/calc'); }
  if (params?.get('s')) {
    const got = setups.decode(params.get('s'));
    history.replaceState(null, '', '#/calc');
    if (got) { calc = { ...loadCalc(), ...got.setup, examples: {}, toolId: got.setup.toolId && BY_ID.has(got.setup.toolId) ? got.setup.toolId : null }; saveCalc(); toast(got.name ? `Opened shared setup “${got.name}”` : 'Opened shared setup'); }
    else toast('That share link could not be read.');
  }
  const u = calc.units, U = u === 'mm' ? { len: 'mm', vc: 'm/min', fz: 'mm/tooth', vf: 'mm/min', mrr: 'cm³/min' } : { len: 'in', vc: 'SFM', fz: 'in/tooth', vf: 'IPM', mrr: 'in³/min' };
  const tool = calc.toolId ? BY_ID.get(calc.toolId) : null;
  const s = DATA.series[tool?.series];
  const r = compute({ ...calc, tool: toolInUnits(tool, u) });
  const num = (k, v) => v == null || v === '' || Number.isNaN(v) ? '' : String(+(+v).toFixed(6));
  const exFlag = k => calc.examples?.[k] ? '<span class="example-flag">Example</span>' : '';
  const field = (k, label, unit, ph, opts = '') => `<div class="field"><label for="c-${k}">${label} ${exFlag(k)}</label><div class="unit-input"><input id="c-${k}" data-c="${k}" inputmode="decimal" autocomplete="off" placeholder="${esc(ph)}" value="${esc(num(k, calc[k]))}" ${opts}><span>${unit}</span></div></div>`;
  const cutPages = (s?.cuttingData || []).map(c => c.page);
  view.innerHTML = `
  <div class="row" style="margin-bottom:10px"><h1 class="grow" style="margin:0">Calculator</h1>
    <div class="seg" role="group" aria-label="Units"><button type="button" data-units="in" aria-pressed="${u === 'in'}">Inch</button><button type="button" data-units="mm" aria-pressed="${u === 'mm'}">Metric</button></div></div>
  ${tool ? `<div class="card"><div class="row"><div class="grow"><b class="mono">${esc(tool.tool)}</b> <span class="muted">· ${esc(s?.title || '')}</span><br><small class="muted">${esc(dia(tool))} · ${esc(tool.nof)} fl · ${esc(corner(tool))} · APMX ${esc(lenText(tool, 'apmx', 'APMX') || '—')}${tool.lu != null ? ` · reach ${esc(lenText(tool, 'lu', 'LU'))}` : ''}</small></div>
      <a class="btn small" href="#/tool/${encodeURIComponent(tool.id)}">Details</a><button type="button" class="btn small" id="c-untool">Clear tool</button></div>
      ${cutPages.length ? `<p class="muted" style="font-size:.82rem;margin-bottom:0">M.A. Ford publishes recommended cutting data for this series on catalog pages ${cutPages.join(', ')}. This demo does not copy those values: enter your own or read them there. ${catalogLink(tool.doc, s.cuttingData[0].pdfPage, 'Open page ' + cutPages[0])}</p>` : ''}</div>`
    : `<p class="note info">Pick a tool in <a href="#/find">Find Tools</a> to load its diameter, flutes and cutting length, or type them below.</p>`}
  <div class="split">
    <div class="card">
      <div class="grid2">${field('d', 'Diameter (DC)', U.len, u === 'mm' ? 'e.g. 12' : 'e.g. 1/2 or .5')}${field('z', 'Flutes (z)', 'fl', 'e.g. 4', 'inputmode="numeric"')}</div>
      <div class="row" style="margin:4px 0 6px"><span class="muted grow" style="font-size:.85rem">Speed from</span>
        <div class="seg" role="group" aria-label="Speed input"><button type="button" data-mode="speedFrom" data-v="vc" aria-pressed="${calc.speedFrom !== 'n'}">Cutting speed</button><button type="button" data-mode="speedFrom" data-v="n" aria-pressed="${calc.speedFrom === 'n'}">RPM</button></div></div>
      ${calc.speedFrom === 'n' ? field('n', 'Spindle speed (n)', 'RPM', 'e.g. 8000', 'inputmode="numeric"') : field('vc', 'Cutting speed (vc)', U.vc, 'your value')}
      <div class="row" style="margin:4px 0 6px"><span class="muted grow" style="font-size:.85rem">Feed from</span>
        <div class="seg" role="group" aria-label="Feed input"><button type="button" data-mode="feedFrom" data-v="fz" aria-pressed="${calc.feedFrom !== 'vf'}">Chip load</button><button type="button" data-mode="feedFrom" data-v="vf" aria-pressed="${calc.feedFrom === 'vf'}">Feed rate</button></div></div>
      ${calc.feedFrom === 'vf' ? field('vf', 'Feed rate (vf)', U.vf, 'your value') : field('fz', 'Chip load (fz)', U.fz, 'your value')}
      <div class="grid2">${field('ae', 'Radial width (ae)', U.len, 'optional')}${field('ap', 'Axial depth (ap)', U.len, 'optional')}</div>
      ${field('maxRpm', 'Machine max RPM', 'RPM', 'optional', 'inputmode="numeric"')}
      <div class="list-actions"><button type="button" class="btn small" id="c-example">Fill example values</button><button type="button" class="btn small" id="c-reset">Clear</button></div>
      <p class="muted" style="font-size:.8rem">Example values are placeholders to show the maths, not recommendations for any tool or material.</p>
    </div>
    <div>
      <div class="card" aria-live="polite">
        ${r.errors.length ? `<div class="note err"><ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <div class="out">
          <div class="big"><div class="k">Spindle speed${r.limited ? ' (limited)' : ''}</div><div class="v">${fmt(r.n, 0)} <span class="u">RPM</span></div>${r.limited ? `<small class="muted">asked for ${fmt(r.nRequested, 0)} RPM</small>` : ''}</div>
          <div><div class="k">Cutting speed${r.limited ? ' (actual)' : ''}</div><div class="v">${fmt(r.vc, u === 'mm' ? 1 : 0)} <span class="u">${U.vc}</span></div></div>
          <div><div class="k">Feed rate</div><div class="v">${fmt(r.vf, u === 'mm' ? 0 : 2)} <span class="u">${U.vf}</span></div></div>
          <div><div class="k">Chip load</div><div class="v">${fmt(r.fz, u === 'mm' ? 4 : 5)} <span class="u">${U.fz}</span></div></div>
          <div><div class="k">MRR</div><div class="v">${fmt(r.mrr, 2)} <span class="u">${U.mrr}</span></div></div>
          ${r.aeRatio != null ? `<div class="big"><div class="k">Radial engagement ae/D</div><div class="v">${fmt(r.aeRatio * 100, 1)} <span class="u">%</span></div></div>` : ''}
        </div>
        ${r.warnings.length ? `<div class="note warn"><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${r.notes.length && !r.errors.length ? `<p class="muted" style="font-size:.85rem">${r.notes.map(esc).join(' ')}</p>` : ''}
        <p class="muted" style="font-size:.8rem">Standard formulas on the values entered. A result here does not mean the setup suits the tool, material, holder or machine, and it is not M.A. Ford cutting data.</p>
      </div>
      <div class="card"><h2>Save or share</h2>
        <div class="row"><input id="c-name" class="grow" placeholder="Setup name, e.g. 6061 pocket" maxlength="80" aria-label="Setup name"><button type="button" class="btn primary" id="c-save">Save</button></div>
        <div class="list-actions"><button type="button" class="btn small" id="c-link">Copy share link</button><button type="button" class="btn small" id="c-copy">Copy summary</button>${navigator.share ? '<button type="button" class="btn small" id="c-share">Share…</button>' : ''}</div>
        <p class="muted" style="font-size:.8rem">Saved setups stay in this browser on this device. A share link carries the setup inside the link itself.</p>
      </div>
    </div>
  </div>`;

  view.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => {
    if (calc.units === b.dataset.units) return;
    const max = calc.maxRpm, tid = calc.toolId, ex = calc.examples;
    calc = { ...convert(calc, b.dataset.units), maxRpm: max, toolId: tid, examples: ex };
    if (tid && BY_ID.get(tid)) { const t = BY_ID.get(tid); const keepD = Math.abs((calc.units === 'mm' ? t.dc * MM_PER_IN : t.dc) - calc.d) < 0.01; if (keepD) loadTool(t, calc.units); }
    for (const k of ['d', 'vc', 'fz', 'vf', 'ae', 'ap']) if (typeof calc[k] === 'number') calc[k] = +calc[k].toFixed(6);
    saveCalc(); renderCalc();
  }));
  view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.mode, v = b.dataset.v; if (calc[k] === v) return;
    // Carry the current result across so switching input mode keeps the same numbers.
    if (k === 'speedFrom' && r.n != null) { if (v === 'n') calc.n = Math.round(r.nRequested ?? r.n); else calc.vc = +(speedFromN(r.nRequested ?? r.n)).toFixed(2); }
    if (k === 'feedFrom' && r.vf != null) { if (v === 'vf') calc.vf = +r.vf.toFixed(u === 'mm' ? 1 : 3); else calc.fz = +r.fz.toFixed(6); }
    calc[k] = v; saveCalc(); renderCalc();
  }));
  function speedFromN(n) { return n * Math.PI * calc.d / (u === 'mm' ? 1000 : 12); }
  view.querySelectorAll('input[data-c]').forEach(i => i.addEventListener('input', () => {
    const k = i.dataset.c; const raw = i.value.trim();
    let v;
    if (!raw) v = undefined;
    else if (['d', 'ae', 'ap'].includes(k)) { const L = parseLength(raw, u); v = L ? +(u === 'mm' ? L.in * MM_PER_IN : L.in).toFixed(6) : NaN; }
    else v = /^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw) ? parseFloat(raw) : NaN;
    calc[k] = v; if (calc.examples) delete calc.examples[k];
    i.setAttribute('aria-invalid', Number.isNaN(v) ? 'true' : 'false');
    saveCalc();
    clearTimeout(renderCalc.t); renderCalc.t = setTimeout(() => { const pos = i.selectionStart; renderCalc(); const el = $('#c-' + k); if (el) { el.focus({ preventScroll: true }); if (el.value !== raw) el.value = raw; try { el.setSelectionRange(pos, pos); } catch {} } }, 350);
  }));
  $('#c-example').addEventListener('click', () => {
    const ex = EX[u]; calc.examples = {};
    if (calc.speedFrom === 'n') calc.speedFrom = 'vc';
    if (calc.feedFrom === 'vf') calc.feedFrom = 'fz';
    calc.vc = ex.vc; calc.fz = ex.fz; calc.examples.vc = calc.examples.fz = true;
    if (!calc.d) { calc.d = u === 'mm' ? 12 : 0.5; calc.examples.d = true; }
    if (!calc.z) { calc.z = 4; calc.examples.z = true; }
    saveCalc(); renderCalc();
  });
  $('#c-reset').addEventListener('click', () => { const max = calc.maxRpm; calc = { units: u, speedFrom: 'vc', feedFrom: 'fz', toolId: null, examples: {}, maxRpm: max }; saveCalc(); renderCalc(); });
  $('#c-untool')?.addEventListener('click', () => { calc.toolId = null; saveCalc(); renderCalc(); });
  $('#c-save').addEventListener('click', () => {
    const name = $('#c-name').value.trim() || (tool ? `${tool.tool} setup` : 'Untitled setup');
    const item = setups.add(store, name, calc);
    toast(item ? `Saved “${item.name}” on this device` : 'Could not save: this browser is blocking storage.');
  });
  const link = () => `${location.origin}${location.pathname}#/calc?s=${setups.encode(calc, $('#c-name').value.trim() || undefined)}`;
  $('#c-link').addEventListener('click', () => copy(link(), 'Share link copied'));
  $('#c-copy').addEventListener('click', () => copy(summary(calc, r, $('#c-name').value.trim()), 'Summary copied'));
  $('#c-share')?.addEventListener('click', () => navigator.share({ title: 'SAM tooling setup', text: summary(calc, r, $('#c-name').value.trim()), url: link() }).catch(() => {}));
}

function summary(c, r, name) {
  const u = c.units, U = u === 'mm' ? { len: 'mm', vc: 'm/min', fz: 'mm/tooth', vf: 'mm/min', mrr: 'cm³/min' } : { len: 'in', vc: 'SFM', fz: 'in/tooth', vf: 'IPM', mrr: 'in³/min' };
  const t = c.toolId ? BY_ID.get(c.toolId) : null;
  const lines = [`SAM tooling demo setup${name ? ` — ${name}` : ''}`];
  if (t) lines.push(`Tool: M.A. Ford ${t.tool} (EDP ${t.edp}), Series ${t.series}, ${dia(t)}, ${t.nof} fl, ${corner(t)}, ${t.coating || 'coating not printed'} — catalog Vol. 105 p. ${t.page}`);
  lines.push(`D ${fmt(c.d)} ${U.len} · z ${c.z ?? '—'}${c.ae ? ` · ae ${fmt(c.ae)} ${U.len}` : ''}${c.ap ? ` · ap ${fmt(c.ap)} ${U.len}` : ''}${c.maxRpm ? ` · max ${fmt(c.maxRpm, 0)} RPM` : ''}`);
  lines.push(`Spindle ${fmt(r.n, 0)} RPM${r.limited ? ` (limited; asked ${fmt(r.nRequested, 0)})` : ''} · cutting speed ${fmt(r.vc, u === 'mm' ? 1 : 0)} ${U.vc}`);
  lines.push(`Feed ${fmt(r.vf, u === 'mm' ? 0 : 2)} ${U.vf} · chip load ${fmt(r.fz, u === 'mm' ? 4 : 5)} ${U.fz}${r.mrr != null ? ` · MRR ${fmt(r.mrr, 2)} ${U.mrr}` : ''}`);
  if (r.warnings.length) lines.push(`Warnings: ${r.warnings.join(' ')}`);
  if (Object.keys(c.examples || {}).length) lines.push('Includes example values (not recommendations).');
  lines.push('Values entered by the user; standard formulas. Not M.A. Ford cutting data. Independent prototype, not an M.A. Ford product.');
  return lines.join('\n');
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove();
    toast(ok ? done : 'Copy failed: select and copy the text manually.');
  }
}

// ---------- Saved ----------
function renderSaved() {
  const list = setups.loadAll(store);
  view.innerHTML = `<h1>Saved setups</h1>
  <p class="note info">Saved setups are kept only in this browser on this device${persistent ? '' : ' — and right now storage is blocked, so they will not survive a reload'}. Clearing website data removes them. Use a share link to move a setup to another device.</p>
  ${list.length ? list.map(it => {
    const t = it.setup.toolId ? BY_ID.get(it.setup.toolId) : null; const s = it.setup; const L = s.units === 'mm' ? 'mm' : 'in';
    return `<div class="card"><div class="saved-item"><div class="grow"><b>${esc(it.name)}</b><br><small class="muted">${new Date(it.saved).toLocaleString()}${t ? ` · ${esc(t.tool)}` : ''} · D ${fmt(s.d)} ${L} · ${s.z ?? '—'} fl · ${s.units === 'mm' ? 'metric' : 'inch'}</small></div></div>
      <div class="list-actions"><button type="button" class="btn small primary" data-open="${esc(it.id)}">Open in calculator</button><button type="button" class="btn small" data-link="${esc(it.id)}">Copy share link</button><button type="button" class="btn small danger" data-del="${esc(it.id)}">Delete</button></div></div>`;
  }).join('') : '<div class="empty">No saved setups yet. Save one from the Calculator.</div>'}`;
  const find_ = id => list.find(x => x.id === id);
  view.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const it = find_(b.dataset.open); calc = { ...loadCalc(), ...it.setup, examples: {}, toolId: it.setup.toolId && BY_ID.has(it.setup.toolId) ? it.setup.toolId : null }; saveCalc(); location.hash = '#/calc'; }));
  view.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => { const it = find_(b.dataset.link); copy(`${location.origin}${location.pathname}#/calc?s=${setups.encode(it.setup, it.name)}`, 'Share link copied'); }));
  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { const it = find_(b.dataset.del); if (confirm(`Delete “${it.name}” from this device?`)) { setups.remove(store, it.id); renderSaved(); toast('Deleted'); } }));
}

// ---------- Catalogs ----------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
async function offlineStatus() {
  if (!('caches' in window) || !navigator.serviceWorker) return { app: false, data: false, reason: 'This browser does not support offline storage for websites.' };
  try {
    const app = !!(await caches.match(new URL('index.html', location.href).href));
    const data = !!(await caches.match(new URL('data/products.json', location.href).href));
    return { app, data };
  } catch { return { app: false, data: false, reason: 'Offline storage is blocked in this browser mode.' }; }
}
async function renderCatalogs() {
  const C = DATA.catalogs, cov = C.coverage;
  const doc = k => C.documents[k];
  const countBy = k => DATA.products.filter(p => p.doc === k).length;
  const seriesBy = k => SERIES_IDS.filter(s => DATA.series[s].doc === k).length;
  view.innerHTML = `<h1>Catalogs</h1>
  <div class="card"><h2>What this demo covers</h2>
    <table class="dims"><tbody>
      <tr><th>${esc(DOC_SHORT.gp)}</th><td><b>${countBy('gp').toLocaleString()}</b> end mills, ${seriesBy('gp')} series</td></tr>
      <tr><th>${esc(DOC_SHORT.hp)}</th><td><b>${countBy('hp').toLocaleString()}</b> end mills, ${seriesBy('hp')} series</td></tr>
      <tr><th>Total loaded</th><td><b>${DATA.products.length.toLocaleString()}</b> catalog rows (each coating or shank version is its own part number)</td></tr>
    </tbody></table>
    <p><b>Not loaded:</b> ${cov.notLoaded.map(esc).join('; ')}.</p>
    <p class="muted" style="font-size:.85rem">Read on ${esc(C.extracted)} from M.A. Ford Product Catalog Vol. 105. Every row's printed decimal size was checked against the diameter coded in its own part number. Check the catalog before ordering.</p>
  </div>
  <div class="card"><h2>Available offline</h2><div id="offline">Checking…</div></div>
  <div class="card"><h2>Catalog PDFs</h2>
    <p class="muted" style="font-size:.85rem">These open on maford.com and need internet. This app never downloads them by itself. To keep one for offline reading, open it and use your browser's Share or Download to save it to Files.</p>
    ${['gp', 'hp', 'master'].map(k => `<div style="margin:.6rem 0"><b>${esc(doc(k).title)}</b><br><small class="muted">${(doc(k).bytes / 1e6).toFixed(0)} MB${doc(k).pages ? ` · ${doc(k).pages} pages` : ''}${k === 'master' ? ' · very large: use Wi-Fi' : ''}</small><br><a class="ext" href="${esc(doc(k).url)}" target="_blank" rel="noopener">Open PDF</a></div>`).join('')}
    <p><a class="ext" href="https://www.maford.com/Page/Catalog_Sections.aspx?nt=40" target="_blank" rel="noopener">All M.A. Ford catalog sections</a></p>
  </div>
  <div class="card"><h2>Install</h2>
    <p>On iPhone or iPad: open this page in Safari, tap Share, then <b>Add to Home Screen</b>. On Android or desktop Chrome/Edge: use the browser menu's <b>Install app</b>${installPrompt ? ' or the button below' : ''}.</p>
    ${installPrompt ? '<button type="button" class="btn primary" id="install">Install app</button>' : ''}
  </div>
  <div class="card"><h2>About</h2>
    <p>Independent prototype for discussion. Not an M.A. Ford product, and not endorsed by M.A. Ford. M.A. Ford's own calculator app: <a class="ext" href="https://apps.apple.com/us/app/m-a-ford-machining-calculator/id1554634640" target="_blank" rel="noopener">App Store</a>.</p>
  </div>`;
  $('#install')?.addEventListener('click', async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; renderCatalogs(); });
  let st = await offlineStatus();
  // On a first visit the service worker may still be saving files: check again once it is ready.
  if (!st.reason && !(st.app && st.data) && navigator.serviceWorker) {
    await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 8000))]);
    st = await offlineStatus();
  }
  const el = $('#offline'); if (!el) return;
  el.innerHTML = st.reason ? `<p class="note warn">${esc(st.reason)}</p>` : `<ul>
    <li>${st.app ? '✓' : '…'} App screens ${st.app ? 'saved for offline use' : 'not saved yet (reload once while online)'}</li>
    <li>${st.data ? '✓' : '…'} ${DATA.products.length.toLocaleString()} end-mill records ${st.data ? 'saved for offline use' : 'not saved yet'}</li>
    <li>✓ Calculator and saved setups work offline</li>
    <li>✗ Catalog PDFs and maford.com links need internet</li></ul>`;
}

// ---------- startup ----------
function setNet() { const off = !navigator.onLine; document.body.classList.toggle('offline', off); $('#net').hidden = !off; }
window.addEventListener('online', setNet); window.addEventListener('offline', setNet); setNet();
document.addEventListener('click', e => {
  const a = e.target.closest('a.ext');
  if (a && !navigator.onLine) { e.preventDefault(); toast('This link opens maford.com and needs internet.'); }
});
$('#proto-btn').addEventListener('click', () => $('#about').showModal());

async function boot() {
  route();
  try {
    const get = n => fetch(`data/${n}.json`).then(r => { if (!r.ok) throw new Error(`${n}: ${r.status}`); return r.json(); });
    const [products, series, catalogs] = await Promise.all([get('products'), get('series'), get('catalogs')]);
    DATA = { products, series, catalogs };
    BY_ID = new Map(products.map(p => [p.id, p]));
    SERIES_IDS = Object.keys(series).sort((a, b) => series[a].doc.localeCompare(series[b].doc) || a.localeCompare(b, 'en', { numeric: true }));
    route();
  } catch (e) {
    view.innerHTML = `<div class="card"><h1>Could not load the catalog data</h1><p>${esc(e.message)}</p><p>If you are offline, open the app once while online so it can save the data.</p></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
