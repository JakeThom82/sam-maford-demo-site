// SAM — M.A. Ford tooling demo. Independent prototype; not an M.A. Ford product.
import { parseLength, fractionInches, decimalInches, mm as toMm, MM_PER_IN } from './lib/units.js';
import { parseQuery, search, ISO_GROUPS } from './lib/search.js';
import { compute, convert, fmt } from './lib/calc.js';
import * as setups from './lib/setups.js';
import { MATERIALS, OPERATIONS, ENGAGEMENT_PRESETS, ISO_COLORS, ISO_NAMES, materialById } from './lib/materials.js';
import { guide } from './lib/guide.js';
import { published } from './lib/published.js';
import { isoScene, isoScale, toolpathOptions } from './lib/iso.js';

const view = document.getElementById('view');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = (() => { try { const k = '__t'; localStorage.setItem(k, k); localStorage.removeItem(k); return localStorage; } catch { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; } })();
const persistent = store !== null && (() => { try { return !!window.localStorage; } catch { return false; } })();

let DATA = null, BY_ID = new Map(), SERIES_IDS = [], WEB = null, SF = {};
// Official M.A. Ford images are linked from maford.com (not copied); the server's resizer gives thumbnails.
const MF = 'https://www.maford.com';
const mfImg = (path, w) => w ? `${MF}/ScaleImage2.aspx?w=${w}&img=~${encodeURI(path)}` : MF + encodeURI(path);
const webSeries = id => WEB?.series?.[id] || null;
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
  const h = location.hash || '#/calc';
  const [path, query] = h.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  const tab = { find: 'find', tool: 'find', calc: 'calc', saved: 'saved', catalogs: 'catalogs' }[parts[0]] || 'calc';
  for (const a of document.querySelectorAll('.tabs a')) a.toggleAttribute('aria-current', a.dataset.tab === tab), a.dataset.tab === tab && a.setAttribute('aria-current', 'page');
  if (!DATA) { view.innerHTML = '<p class="empty">Loading catalog data…</p>'; return; }
  if (parts[0] === 'tool') return renderTool(decodeURIComponent(parts[1] || ''));
  if (parts[0] === 'calc') return renderCalc(params);
  if (parts[0] === 'saved') return renderSaved();
  if (parts[0] === 'catalogs') return renderCatalogs();
  if (parts[0] === 'find') return renderFind(params);
  return renderCalc(params);
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

// A direct answer when the request names one tool, or asks for speeds and feeds of a few tools:
// the tool itself and M.A. Ford's published speeds and feeds for the material asked about.
// Feeds as the sheet prints them: .0040, not 0.004.
const fzPrinted = v => v < 1 ? v.toFixed(4).replace(/^0/, '') : String(v);
function answerCard(results, c) {
  if (!(results.length === 1 || (c.wantSpeeds && results.length > 0 && results.length <= 3))) return '';
  return results.slice(0, 3).map(p => {
    const s = DATA.series[p.series] || {}, ws = webSeries(p.series);
    const matId = c.materialId || null, mat = materialById(matId);
    const iso = c.material || mat?.iso || null;
    const pub = published({ series: p.series, dc: p.dc, apmx: p.apmx, iso, materialId: matId }, SF);
    const isoName = iso ? ISO_NAMES[iso].toLowerCase() : null;
    let sf = '';
    if (pub?.rows?.length) {
      sf = `<table class="dims pubt"><thead><tr><th>Operation</th><th>ae / ap</th><th>Vc (${pub.unit === 'mm' ? 'm/min' : 'SFM'})</th><th>fz at ${esc(pub.column)}"</th></tr></thead><tbody>
        ${pub.rows.map(r => `<tr><td>${esc(r.application)}<br><small class="muted">${esc(r.material)}</small></td><td>${esc(r.ae)}<br>${esc(r.ap)}</td><td>${esc(r.vc)}</td><td>${fzPrinted(r.fzAtD)}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">M.A. Ford's Speed and Feed Data for Series ${esc(p.series)}, page ${pub.page}${pub.locXD ? ` (${pub.locXD}×D cutting-length table)` : ''}. Advisory, as M.A. Ford notes. <a class="ext" href="${esc(pub.pdf)}" target="_blank" rel="noopener">Open the PDF</a></p>`;
    } else if (c.wantSpeeds || iso) {
      const pdf = ws?.speedFeedPdf, pages = (s.cuttingData || []).map(x => x.page);
      sf = `<p class="small">${pub?.rows && iso ? `M.A. Ford's data sheet for Series ${esc(p.series)} has no row for ${esc(isoName)}.` : pub?.noColumn ? `M.A. Ford's data sheet covers ${esc(pub.diameters.join(', '))}, not this size.` : `Speeds and feeds for Series ${esc(p.series)} are published by M.A. Ford${pdf || pages.length ? '' : ' (no sheet found on the website)'}; this demo has not read that sheet yet.`}
        ${pdf ? `<a class="ext" href="${esc(pdf)}" target="_blank" rel="noopener">Speed and Feed Data (PDF)</a>` : ''}${pages.length && p.doc !== 'web' ? ` · catalog pages ${pages.join(', ')}` : ''}</p>`;
    }
    const calcLink = `#/calc?tool=${encodeURIComponent(p.id)}${matId ? `&mat=${matId}` : ''}`;
    return `<div class="card answer">
      <div class="row" style="flex-wrap:nowrap">${ws?.photo ? `<img class="thumb" src="${esc(mfImg(ws.photo, 200))}" alt="" onerror="this.remove()" style="width:96px;height:48px;object-fit:contain;background:#fff;border-radius:8px">` : ''}
        <div class="grow"><b class="mono">${esc(p.tool)}</b> <small class="muted">EDP ${esc(p.edp)}</small><br><small>${esc(dia(p))} · ${esc(specLine(p))}</small></div></div>
      ${sf}
      <div class="list-actions"><a class="btn primary small" href="${calcLink}">Open in calculator${mat ? ` · ${esc(mat.name.toLowerCase())}` : ''}</a><a class="btn small" href="#/tool/${encodeURIComponent(p.id)}">Tool details</a></div>
      ${c.wantSpeeds && iso && !matId ? `<p class="muted small">Pick the exact material in the calculator.</p>` : ''}
    </div>`;
  }).join('');
}

function matSource(id, iso) {
  const s = DATA.series[id] || {}; const cat = s.materials?.groups.includes(iso), web = s.webIso?.includes(iso);
  return [cat && (s.materials.scope === 'series' ? 'series table' : 'general GP table'), web && 'maford.com'].filter(Boolean).join(' + ');
}
function renderFind(params) {
  if (params?.get('series') || params?.get('dc')) {
    // Arrived from the calculator's tool guidance: show that series in that size (and the job's material).
    Object.assign(find, { q: '', re: '', locMin: '', locMax: '', oalMin: '', oalMax: '', seriesOnly: false, limit: 40, open: true, series: params.get('series') || '', dc: params.get('dc') || '', material: materialById(calc.material)?.iso || '' });
    find.nof.clear(); find.corner.clear(); find.coating.clear();
    history.replaceState(null, '', '#/find');
  }
  const { c, parsed } = findCriteria();
  const results = search(DATA.products, c, DATA.series);
  // With a material chosen, series with their own cutting-data table come before the general GP table.
  if (c.material) results.sort((x, y) => (DATA.series[x.series]?.materials?.scope === 'series' ? 0 : 1) - (DATA.series[y.series]?.materials?.scope === 'series' ? 0 : 1) || (DATA.series[y.series]?.webIso?.includes(c.material) ? 1 : 0) - (DATA.series[x.series]?.webIso?.includes(c.material) ? 1 : 0));
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
  ${answerCard(results, c)}
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
    <p class="muted" style="font-size:.82rem">Material matches come only from what M.A. Ford publishes: the ISO groups in the catalog's cutting-data tables and the material icons on each series' web page, never from coating. Each result says which source matched.
      <label style="display:flex;gap:.5rem;align-items:center;margin-top:.4rem;color:var(--text)"><input type="checkbox" id="f-seriesOnly" style="width:auto;min-height:auto" ${find.seriesOnly ? 'checked' : ''}> Series-specific tables only</label></p>
    <button type="button" class="btn small" id="f-clear">Clear search and filters</button>
  </details>
  <p class="coverage">${results.length === total && !anyFilter ? `${total.toLocaleString()} end mills loaded` : `<b>${results.length.toLocaleString()}</b> of ${total.toLocaleString()} end mills loaded`} — the GP and HP end-mill sections of the Vol. 105 catalog only, not the whole M.A. Ford catalog. <a href="#/catalogs">What's covered</a></p>
  ${mat ? `<p class="note info">Showing series whose catalog cutting-data tables list ISO ${mat} (${esc(ISO_GROUPS[mat])}). A listing gives starting data in the catalog; it does not mean every tool suits every job.</p>` : ''}
  <ul class="results">${results.slice(0, find.limit).map(p => `<li><a class="result${webSeries(p.series)?.photo ? ' has-pic' : ''}" href="#/tool/${encodeURIComponent(p.id)}">${webSeries(p.series)?.photo ? `<img class="thumb" src="${esc(mfImg(webSeries(p.series).photo, 160))}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="rbody">
      <div class="t"><span class="id mono">${esc(p.tool)}</span><span class="dia">${esc(dia(p))}${p.sys === 'mm' ? '' : ` <small class="muted">${toMm(p.dc)} mm</small>`}</span></div>
      <div class="specs">${esc(specLine(p))}${mat ? ` · <span class="tag">${matSource(p.series, mat)}</span>` : ''}</div></span></a></li>`).join('')}</ul>
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
  const ws = webSeries(p.series), wdesc = WEB?.tools?.[p.id];
  const mfPage = `${MF}/product-details/${encodeURIComponent(p.tool)}`;
  const offPic = label => `onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'pic-off',textContent:'${label} needs internet'}))"`;
  const gallery = ws?.photo || ws?.drawing ? `<div class="card gallery">
    ${ws.photo ? `<img class="photo" src="${esc(mfImg(ws.photo, 900))}" alt="M.A. Ford Series ${esc(p.series)} end mill" ${offPic('Product photo')}>` : ''}
    ${ws.drawing ? `<img class="drawing" src="${esc(mfImg(ws.drawing, 900))}" alt="M.A. Ford dimension drawing, Series ${esc(p.series)}" loading="lazy" onerror="this.remove()">` : ''}
    <p class="muted small">Photo and drawing for Series ${esc(p.series)}, shown from maford.com. They picture the series, not this exact size. © M.A. Ford.</p>
    <div class="list-actions"><a class="ext btn small" href="${esc(mfPage)}" target="_blank" rel="noopener">View this tool on maford.com</a></div>
  </div>` : '';
  const webLists = `${ws?.materials?.length ? `<h3>M.A. Ford website lists</h3><div class="mf-icons">${ws.materials.map(m => `<span><img src="${esc(mfImg(m.icon))}" alt="" loading="lazy" onerror="this.remove()">${esc(m.name)}${m.iso ? ` (${m.iso})` : ''}</span>`).join('')}</div>` : ''}
    ${ws?.applications?.length ? `<div class="mf-apps">${ws.applications.map(a => `<figure><img src="${esc(mfImg(a.image, 240))}" alt="" loading="lazy" onerror="this.remove()"><figcaption>${esc(a.name)}</figcaption></figure>`).join('')}</div>` : ''}`;
  view.innerHTML = `
  <p><a href="#/find">‹ Results</a></p>
  <div class="card">
    <div class="row"><h1 class="grow mono" style="margin:0">${esc(p.tool)}</h1><span class="tag">EDP ${esc(p.edp)}</span></div>
    <p style="margin:.3rem 0 0"><b>${esc(dia(p))}</b> ${esc(s.line || '')} Series ${esc(p.series)} · ${esc(p.nof ?? '?')} flutes · ${esc(corner(p))} · ${esc(p.coating || 'coating not printed in the table')}${p.shank ? ` · ${esc(p.shank)} shank` : ''}</p>
    ${wdesc ? `<p class="muted small" style="margin:.4rem 0 0">M.A. Ford website: ${esc(wdesc)}</p>` : ''}
  </div>
  ${gallery}
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
      </div>
      <a class="btn primary" style="width:100%;margin-bottom:12px" href="#/calc?tool=${encodeURIComponent(p.id)}">Load into calculator</a>
    </div>
    <div>
      <div class="card"><h2>Application</h2>
        ${mats ? `<p>${mats.scope === 'series' ? `M.A. Ford's cutting-data tables for this series (pages ${cutPages.join(', ')}) list these ISO material groups:` : `This GP series is covered by the catalog's <b>general-purpose</b> end-mill cutting-data tables (pages ${esc((mats.pages || []).join(', '))}), which list:`}</p>
          <div class="chips">${mats.groups.map(g => `<span class="chip" style="cursor:default">${g} · ${esc(ISO_GROUPS[g])}</span>`).join('')}</div>
          <p class="muted" style="font-size:.85rem">The catalog gives starting speeds and feeds for these groups. Open the page for the specific materials, hardness and values.</p>`
        : `<p>No material groups were read for this series.${cutPages.length ? ` The catalog has cutting data for it on pages ${cutPages.join(', ')}, in a layout this demo does not read yet.` : ''}</p>`}
        ${webLists}
        ${s.notes?.length ? `<h3>From the series page</h3><ul>${s.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${s.features?.length ? `<p><span class="muted">Features:</span> ${s.features.map(esc).join(', ')}</p>` : ''}
      </div>
      ${p.doc === 'web' ? `<div class="card"><h2>Source</h2>
        <p>This series is on M.A. Ford's website but not in the Vol. 105 catalog sections loaded here. Sizes come from the website's tool table (read ${esc(WEB.checked || '')}).</p>
        <div class="list-actions"><a class="ext btn small" href="${esc(mfPage)}" target="_blank" rel="noopener">View this tool on maford.com</a></div>
      </div>` : `<div class="card"><h2>Source</h2>
        <dl class="kv">
          <dt>Document</dt><dd>${esc(doc.title)}</dd>
          <dt>Printed page</dt><dd>${esc(p.page)}</dd>
          <dt>PDF page</dt><dd>${esc(p.pdfPage)} of ${esc(doc.pages)}</dd>
        </dl>
        <div class="list-actions">${catalogLink(p.doc, p.pdfPage, `Open catalog page ${p.page}`)}</div>
        <p class="muted" style="font-size:.82rem">Opens M.A. Ford's PDF (${(doc.bytes / 1e6).toFixed(0)} MB) on maford.com. Some phone viewers open it at the first page; go to PDF page ${esc(p.pdfPage)}.</p>
      </div>`}
    </div>
  </div>`;
}

// ---------- Calculator ----------
const EX = { in: { vc: 400, fz: 0.002 }, mm: { vc: 120, fz: 0.05 } };
const CALC_KEY = 'sam-maford-calc-v1', MAXRPM_KEY = 'sam-maford-maxrpm';
let calc = loadCalc();
function loadCalc() {
  const base = { units: 'in', d: undefined, z: undefined, l2: undefined, re: undefined, material: null, op: null, vc: undefined, n: undefined, fz: undefined, vf: undefined, ae: undefined, ap: undefined, maxRpm: undefined, speedFrom: 'vc', feedFrom: 'fz', toolId: null, examples: {} };
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

const UNITS = { in: { len: 'in', vc: 'SFM', fz: 'in/tooth', vf: 'IPM', mrr: 'in³/min' }, mm: { len: 'mm', vc: 'm/min', fz: 'mm/tooth', vf: 'mm/min', mrr: 'cm³/min' } };

// The tool the calculator works with: a catalog tool, or the user's own numbers (l2 = flute length).
const pubKey = (tool, mat) => tool && mat ? `${tool.series}|${mat.id}|${tool.dc}` : null;
function currentTool() {
  const p = calc.toolId ? BY_ID.get(calc.toolId) : null;
  const u = calc.units, f = u === 'mm' ? MM_PER_IN : 1;
  if (p) return { catalog: p, id: p.id, d: calc.d, apmx: p.apmx * f, re: p.re != null ? p.re * f : 0, nof: p.nof };
  return { catalog: null, id: 'your tool', d: calc.d, apmx: calc.l2, re: calc.re, nof: calc.z };
}

function renderCalc(params) {
  if (params?.get('mat') && materialById(params.get('mat'))) { calc.material = params.get('mat'); saveCalc(); }
  if (params?.get('tool')) { const p = BY_ID.get(params.get('tool')); if (p) { if (p.sys === 'mm' && calc.units !== 'mm') calc = { ...convert(calc, 'mm'), maxRpm: calc.maxRpm, material: calc.material, op: calc.op, examples: {} }; loadTool(p); saveCalc(); toast(`${p.tool} loaded`); } history.replaceState(null, '', '#/calc'); }
  if (params?.get('s')) {
    const got = setups.decode(params.get('s'));
    history.replaceState(null, '', '#/calc');
    if (got) { calc = { ...loadCalc(), ...got.setup, examples: {}, toolId: got.setup.toolId && BY_ID.has(got.setup.toolId) ? got.setup.toolId : null }; saveCalc(); toast(got.name ? `Opened shared setup “${got.name}”` : 'Opened shared setup'); }
    else toast('That share link could not be read.');
  }
  const u = calc.units, U = UNITS[u];
  const T = currentTool(), tool = T.catalog;
  if (calc.pubFrom && calc.pubFrom !== pubKey(tool, materialById(calc.material))) {
    // Speeds and feeds published for another series or material must not carry over.
    calc.vc = calc.fz = undefined; calc.pubFrom = null; calc.path = null; saveCalc();
    setTimeout(() => toast('Speed and feed cleared: they were M.A. Ford values for the previous tool or material'), 50);
  }
  const s = tool ? DATA.series[tool.series] : null;
  const mat = materialById(calc.material);
  const op = OPERATIONS.find(o => o.id === calc.op);
  const r = compute({ ...calc, tool: { id: tool ? tool.tool : 'your tool', d: tool ? T.d : undefined, nof: tool ? T.nof : undefined, apmx: T.apmx } });
  const num = v => v == null || v === '' || Number.isNaN(v) ? '' : String(+(+v).toFixed(6));
  const L = v => v == null || Number.isNaN(v) ? '—' : u === 'mm' ? `${fmt(v, 2)}` : (fractionInches(v) ? fractionInches(v) : decimalInches(v, 3));
  const xD = (v, lim) => calc.d > 0 && v > 0 ? `<span class="xd${lim != null && v > lim + 1e-9 ? ' bad' : ''}">${fmt(v / calc.d, 2)} × D</span>` : '';
  const exFlag = k => calc.examples?.[k] ? '<span class="example-flag">Example</span>' : '';
  const input = (k, ph, opts = '') => `<input id="c-${k}" data-c="${k}" inputmode="decimal" autocomplete="off" placeholder="${esc(ph)}" value="${esc(num(calc[k]))}" ${opts}>`;
  const photo = tool && webSeries(tool.series)?.photo;
  const matches = calc.d > 0 ? guide({ iso: mat?.iso, op: op?.web, dc: u === 'mm' ? calc.d / MM_PER_IN : calc.d }, DATA.products, DATA.series, WEB) : [];
  const cutPages = (s?.cuttingData || []).map(c => c.page);
  const dcIn = u === 'mm' ? calc.d / MM_PER_IN : calc.d;
  const pubAll = tool && mat ? published({ series: tool.series, dc: tool.dc, apmx: tool.apmx, iso: mat.iso, materialId: mat.id }, SF) : tool ? published({ series: tool.series, dc: tool.dc, apmx: tool.apmx }, SF) : null;
  const pub = tool ? published({ series: tool.series, dc: tool.dc, apmx: tool.apmx, iso: mat?.iso, materialId: mat?.id, op: calc.op }, SF) : null;
  const sfPdf = tool && webSeries(tool.series)?.speedFeedPdf;

  view.innerHTML = `
  <h1 class="sr">Calculator</h1>
  <button type="button" class="card tool-card" id="c-tool" aria-label="Tool: change or edit">
    <div class="tool-pic">${photo ? `<img src="${esc(mfImg(photo, 240))}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pic-off',textContent:'Image needs internet'}))">` : '<span class="pic-off">Your tool</span>'}</div>
    <div class="tool-head"><b>${tool ? `<span class="mono">${esc(tool.tool)}</span>` : 'User defined end mill'}</b><small>${tool ? `${esc(s?.line || '')} · Series ${esc(tool.series)} · ${esc(tool.coating || 'coating not printed')}` : 'Tap to enter your sizes, or pick a catalog tool'}</small></div>
    <div class="stats4"><div><span>Diameter</span><b>${L(calc.d)}</b></div><div><span>Flute len.</span><b>${L(T.apmx)}</b></div><div><span>Radius</span><b>${tool ? esc(tool.corner === 'ball' ? 'Ball' : tool.re != null ? (u === 'mm' ? fmt(T.re, 2) : decimalInches(tool.re, 3)) : '0') : calc.re > 0 ? L(calc.re) : '0'}</b></div><div><span>Z</span><b>${esc(calc.z ?? '—')}</b></div></div>
  </button>

  <button type="button" class="card mat-row" id="c-mat">
    <span class="iso" style="background:${mat ? ISO_COLORS[mat.iso] : 'var(--surface-2)'}">${mat ? mat.iso : '?'}</span>
    <span class="grow"><b>${mat ? esc(mat.name) : 'Choose workpiece material'}</b><small>${mat ? esc(ISO_NAMES[mat.iso]) + (mat.grades ? ' · e.g. ' + esc(mat.grades) : '') : 'Used to find M.A. Ford tools listed for it'}</small></span><span aria-hidden="true">›</span>
  </button>

  <div class="ops chips" role="group" aria-label="Operation">${OPERATIONS.map(o => `<button type="button" class="chip" data-op="${o.id}" aria-pressed="${calc.op === o.id}">${esc(o.name)}</button>`).join('')}</div>

  <div class="card cut-card"><h2>Toolpath <small class="muted">· drag the cutter: width (ae) and depth (ap)</small></h2>${engageHtml(pubAll, mat, tool, T)}</div>

  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:6px"><h2 style="margin:0">Speed &amp; feed</h2>
      <div class="seg" role="group" aria-label="Units"><button type="button" data-units="in" aria-pressed="${u === 'in'}">Inch</button><button type="button" data-units="mm" aria-pressed="${u === 'mm'}">Metric</button></div></div>
    <div class="grid2">
      <div class="field"><label for="c-${calc.speedFrom === 'n' ? 'n' : 'vc'}">${calc.speedFrom === 'n' ? 'RPM' : `Vc (${U.vc})`} ${exFlag('vc')} <button type="button" class="linkish" data-mode="speedFrom" data-v="${calc.speedFrom === 'n' ? 'vc' : 'n'}">use ${calc.speedFrom === 'n' ? U.vc : 'RPM'}</button></label>${calc.speedFrom === 'n' ? input('n', 'e.g. 8000', 'inputmode="numeric"') : input('vc', 'your value')}</div>
      <div class="field"><label for="c-${calc.feedFrom === 'vf' ? 'vf' : 'fz'}">${calc.feedFrom === 'vf' ? `Vf (${U.vf})` : `fz (${U.fz})`} ${exFlag('fz')} <button type="button" class="linkish" data-mode="feedFrom" data-v="${calc.feedFrom === 'vf' ? 'fz' : 'vf'}">use ${calc.feedFrom === 'vf' ? 'fz' : U.vf}</button></label>${calc.feedFrom === 'vf' ? input('vf', 'your value') : input('fz', 'your value')}</div>
    </div>
    <div class="grid2">
      <div class="field"><label for="c-ae">ae (${U.len}) <span id="xd-ae">${xD(calc.ae, calc.d)}</span></label>${input('ae', 'radial width')}</div>
      <div class="field"><label for="c-ap">ap (${U.len}) <span id="xd-ap">${xD(calc.ap, T.apmx)}</span></label>${input('ap', 'axial depth')}</div>
    </div>
    <div class="list-actions"><button type="button" class="btn small" id="c-example">Fill example values</button><button type="button" class="btn small" id="c-reset">Clear</button></div>
    ${publishedCard(pub, tool, mat, sfPdf)}
    ${tool && cutPages.length && !pub?.rows?.length ? `<p class="muted small">M.A. Ford publishes starting speeds and feeds for Series ${esc(tool.series)} on catalog pages ${cutPages.join(', ')}${mat ? ` (look for ${esc(mat.name.toLowerCase())})` : ''}. ${catalogLink(tool.doc, s.cuttingData[0].pdfPage, 'Open page ' + cutPages[0])}</p>` : ''}
    <p class="muted small">${pub?.rows?.length ? 'Vc and fz are yours to set: use M.A. Ford\'s published values above, or your own.' : 'Vc and fz are yours to enter. M.A. Ford\'s published values appear here when their data sheet for this series has been read.'} Example values only show the maths.</p>
  </div>

  ${r.errors.length ? `<div class="note err"><ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  ${r.warnings.length ? `<div class="note warn"><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

  <div class="card"><h2>M.A. Ford tools for this job</h2>
    ${!(calc.d > 0) ? '<p class="muted">Enter a diameter to see which M.A. Ford series come in that size.</p>' : !matches.length ? `<p>No loaded series ${mat || op ? 'is listed by M.A. Ford for this combination' : 'comes'} in ${esc(L(calc.d))}${u === 'mm' ? ' mm' : '"'}. ${mat || op ? 'Try another operation, or clear the material.' : ''}</p>` : `
    <p class="muted small">${mat || op ? `Series M.A. Ford lists for ${[mat && esc(ISO_NAMES[mat.iso].toLowerCase()), op && esc(op.name.toLowerCase())].filter(Boolean).join(' and ')}, made in` : 'Series made in'} ${esc(L(calc.d))}${u === 'mm' ? ' mm' : '"'}. Ordered by how much of M.A. Ford's published information matches, not a judgement of the best tool.</p>
    <ul class="guide">${matches.slice(0, guideLimit).map(m => { const ws = webSeries(m.id); const S = DATA.series[m.id]; return `<li><a class="guide-item" href="#/find?series=${encodeURIComponent(m.id)}&dc=${encodeURIComponent(u === 'mm' ? calc.d + 'mm' : String(calc.d))}">
      <span class="tool-pic small">${ws?.photo ? `<img src="${esc(mfImg(ws.photo, 200))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
      <span class="grow"><b>Series ${esc(m.id)}</b> <small class="muted">${esc(S?.line || '')}</small><br><small>${m.tools.length} tool${m.tools.length > 1 ? 's' : ''} · ${m.nofs.join('/')} fl · ${esc(m.coatings.join(', ') || 'coating not printed')}</small>${m.reasons.length ? `<br><small class="muted">${esc(m.reasons.join(' · '))}</small>` : ''}</span><span aria-hidden="true">›</span></a></li>`; }).join('')}</ul>
    ${matches.length > guideLimit ? `<button type="button" class="btn small" id="c-more">Show all ${matches.length} series</button>` : ''}`}
  </div>

  <div class="card"><h2>Machine</h2>
    <div class="field"><label for="c-maxRpm">Max spindle RPM (optional)</label>${input('maxRpm', 'e.g. 12000', 'inputmode="numeric"')}</div>
  </div>

  <div class="card"><h2>Save or share</h2>
    <div class="row"><input id="c-name" class="grow" placeholder="Setup name, e.g. 6061 pocket" maxlength="80" aria-label="Setup name"><button type="button" class="btn primary" id="c-save">Save</button></div>
    <div class="list-actions"><button type="button" class="btn small" id="c-link">Copy share link</button><button type="button" class="btn small" id="c-copy">Copy summary</button>${navigator.share ? '<button type="button" class="btn small" id="c-share">Share…</button>' : ''}</div>
    <p class="muted small">Saved setups stay in this browser on this device. A share link carries the setup inside the link itself.</p>
  </div>
  <p class="muted small">Standard formulas on the values entered. A result does not mean the setup suits the tool, material, holder or machine.</p>

  <div class="resultbar" id="resultbar" aria-live="polite">${resultbarInner(r)}</div>`;
  bindEngage(T, mat ? pubAll : null);
  bindPublished(pub, T);

  // Tool sheet / material sheet / presets
  $('#c-tool').addEventListener('click', openToolSheet);
  $('#c-tool2')?.addEventListener('click', openToolSheet);
  $('#c-mat').addEventListener('click', openMaterialSheet);
  $('#c-more')?.addEventListener('click', () => { guideLimit = 999; renderCalc(); });
  view.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => { calc.op = calc.op === b.dataset.op ? null : b.dataset.op; saveCalc(); renderCalc(); }));
  view.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => switchUnits(b.dataset.units)));
  view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.mode, v = b.dataset.v;
    if (k === 'speedFrom' && r.n != null) { if (v === 'n') calc.n = Math.round(r.nRequested ?? r.n); else calc.vc = +((r.nRequested ?? r.n) * Math.PI * calc.d / (u === 'mm' ? 1000 : 12)).toFixed(2); }
    if (k === 'feedFrom' && r.vf != null) { if (v === 'vf') calc.vf = +r.vf.toFixed(u === 'mm' ? 1 : 3); else calc.fz = +r.fz.toFixed(6); }
    calc[k] = v; saveCalc(); renderCalc();
  }));
  bindNumberInputs(view, renderCalc);
  $('#c-example').addEventListener('click', () => {
    const ex = EX[u]; calc.examples = {};
    calc.speedFrom = 'vc'; calc.feedFrom = 'fz';
    calc.vc = ex.vc; calc.fz = ex.fz; calc.examples.vc = calc.examples.fz = true;
    if (!calc.d) { calc.d = u === 'mm' ? 12 : 0.5; calc.examples.d = true; }
    if (!calc.z) { calc.z = 4; calc.examples.z = true; }
    saveCalc(); renderCalc();
  });
  $('#c-reset').addEventListener('click', () => { calc = { ...calc, vc: undefined, n: undefined, fz: undefined, vf: undefined, ae: undefined, ap: undefined, examples: {} }; saveCalc(); renderCalc(); });
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
let guideLimit = 4;

function switchUnits(to) {
  if (calc.units === to) return;
  const keep = { maxRpm: calc.maxRpm, toolId: calc.toolId, examples: calc.examples, material: calc.material, op: calc.op };
  const f = to === 'mm' ? MM_PER_IN : 1 / MM_PER_IN;
  const l2 = calc.l2 != null ? calc.l2 * f : calc.l2, re = calc.re != null ? calc.re * f : calc.re;
  calc = { ...convert(calc, to), ...keep, l2, re };
  if (keep.toolId && BY_ID.get(keep.toolId)) loadTool(BY_ID.get(keep.toolId), to);
  for (const k of ['d', 'vc', 'fz', 'vf', 'ae', 'ap', 'l2', 're']) if (typeof calc[k] === 'number') calc[k] = +calc[k].toFixed(6);
  saveCalc(); renderCalc();
}

// Number fields: lengths accept fractions and units ("1/2", "12mm"); speeds take plain numbers.
function bindNumberInputs(root, rerender) {
  const u = calc.units;
  root.querySelectorAll('input[data-c]').forEach(i => i.addEventListener('input', () => {
    const k = i.dataset.c, raw = i.value.trim();
    let v;
    if (!raw) v = undefined;
    else if (['d', 'ae', 'ap', 'l2', 're'].includes(k)) { const P = parseLength(raw, u); v = P ? +(u === 'mm' ? P.in * MM_PER_IN : P.in).toFixed(6) : (k === 're' && /^0*\.?0*$/.test(raw) ? 0 : NaN); }
    else v = /^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw) ? parseFloat(raw) : NaN;
    calc[k] = v; if (calc.examples) delete calc.examples[k];
    if (['vc', 'n', 'fz', 'vf'].includes(k)) calc.pubFrom = null; // typed by the user: theirs to keep
    i.setAttribute('aria-invalid', Number.isNaN(v) ? 'true' : 'false');
    saveCalc();
    clearTimeout(bindNumberInputs.t);
    bindNumberInputs.t = setTimeout(() => { const pos = i.selectionStart; rerender(); const el = document.getElementById('c-' + k); if (el) { el.focus({ preventScroll: true }); if (el.value !== raw) el.value = raw; try { el.setSelectionRange(pos, pos); } catch {} } }, 400);
  }));
}

// ---------- toolpath and cut (isometric; pick a suggested toolpath, drag the cutter for depth) ----------
// Only suggested toolpaths can be picked: the ones M.A. Ford publishes for this tool and material
// (full slot; side passes up to their radial limit), or, without published data, the usual full slot
// and side passes. Picking one fixes the radial width ae; dragging the cutter up and down sets the
// depth ap. The cutter turns red past the flute length or past M.A. Ford's published depth.
let ENG = null;

function resultbarInner(r) {
  const u = calc.units, U = UNITS[u];
  return `<div><span>RPM${r.limited ? ' (max)' : ''}</span><b>${fmt(r.n, 0)}</b></div>
    <div><span>Vf (${U.vf})</span><b>${fmt(r.vf, u === 'mm' ? 0 : 2)}</b></div>
    <div><span>Q (${U.mrr})</span><b>${fmt(r.mrr, 2)}</b></div>
    ${r.limited ? `<div class="rb-note">${fmt(r.vc, u === 'mm' ? 1 : 0)} ${U.vc} at max RPM</div>` : calc.speedFrom === 'n' && r.vc != null ? `<div class="rb-note">${fmt(r.vc, u === 'mm' ? 1 : 0)} ${U.vc}</div>` : calc.feedFrom === 'vf' && r.fz != null ? `<div class="rb-note">fz ${fmt(r.fz, 5)}</div>` : ''}`;
}

// Can this tool take a full slot? M.A. Ford's published slotting data for the tool's series decides
// first (website speed-and-feed sheet or catalog slotting tables). Without it, Jake's rule: 4 flutes
// or fewer can slot; 5 or more pack chips in a full slot (M.A. Ford's troubleshooting table: chip
// packing -> use an end mill with fewer flutes).
const SLOT_MAX_FLUTES = 4;
function slotCheck(T, pubAll) {
  const z = T.catalog ? T.catalog.nof : calc.z;
  const s = T.catalog ? DATA.series[T.catalog.series] : null;
  if (pubAll?.rows?.some(r => /slot/i.test(r.application))) return { ok: true, why: 'M.A. Ford publishes slotting data for this tool' };
  const pages = (s?.cuttingData || []).filter(c => /slot/i.test(c.title)).map(c => c.page);
  if (pages.length) return { ok: true, why: `M.A. Ford's catalog has slotting data for Series ${T.catalog.series} (pages ${pages.join(', ')})` };
  if (!(z > 0)) return { ok: true, why: '' };
  if (z <= SLOT_MAX_FLUTES) return { ok: true, why: `${z} flutes` };
  return { ok: false, why: `${z} flutes: not for full slotting. ${T.catalog ? `M.A. Ford publishes no slotting data for Series ${T.catalog.series}, and` : 'With'} 5 or more flutes chips pack in a full slot.` };
}

// The toolpath in use: its type, the radial width as a fraction of D, and the limits that apply.
function currentPath(options) {
  const D = calc.d;
  const type = calc.path?.type || (calc.ae > 0 ? (calc.ae >= D - 1e-9 ? 'slot' : 'side') : null);
  if (!type || !(calc.ae > 0)) return null;
  const same = options.opts.filter(o => o.type === type);
  const base = same.find(o => Math.abs(o.aeX - calc.ae / D) < 1e-6) || same.at(-1) || null;
  return {
    type, aeX: calc.ae / D, base, row: base?.row || null,
    apMaxX: base?.apMaxX ?? null,
    aeMaxX: type === 'side' && options.published ? Math.max(...same.map(o => o.aeX)) : 1,
    label: type === 'slot' ? 'Full slot' : `Side pass ${fmt(calc.ae / D, 2)} × D`,
  };
}

function engageHtml(pubAll, mat, tool, T) {
  if (!(calc.d > 0)) return '<p class="engage-empty">Pick a tool (or enter a diameter), then choose a toolpath and drag the cutter: up and down for depth, along the arrow for width. It turns red when it goes too far into the part.</p><div class="list-actions"><a class="btn primary small" href="#/find">Pick a tool</a><button type="button" class="btn small" id="c-tool2">Enter my own sizes</button></div>';
  const options = toolpathOptions(mat && pubAll?.rows?.length ? pubAll.rows : null);
  const cur = currentPath(options);
  const slot = slotCheck(T, pubAll);
  const intro = options.published
    ? `Toolpaths M.A. Ford publishes for this tool in ${esc(mat.name.toLowerCase())} (Speed and Feed Data, page ${esc(pubAll.page)}):`
    : tool && pubAll?.rows && mat ? `M.A. Ford's data sheet has no row for ${esc(mat.name.toLowerCase())}; standard toolpaths:`
    : `Standard toolpaths${tool ? '' : ' for your tool'}${tool && !mat && pubAll ? ' (choose the material to see M.A. Ford\'s toolpaths for this tool)' : ''}:`;
  return `<p class="small">${intro}</p>
    <div class="paths" role="radiogroup" aria-label="Toolpath">${options.opts.map((o, i) => {
      const no = o.type === 'slot' && !slot.ok;
      const on = cur && cur.type === o.type && (o.type === 'slot' || Math.abs(cur.aeX - o.aeX) < 1e-6);
      return `<button type="button" class="path${no ? ' no' : ''}" role="radio" aria-checked="${!!on}" data-path="${i}">
      <svg viewBox="0 0 40 28" aria-hidden="true">${o.type === 'slot'
        ? '<path d="M2 10h14v12h8V10h14v16H2z" class="pi-block"/><rect x="16" y="2" width="8" height="20" class="pi-tool"/>'
        : `<path d="M2 6h${36 - o.aeX * 16}v8h${o.aeX * 16}v12H2z" class="pi-block"/><rect x="${38 - o.aeX * 16}" y="0" width="16" height="14" class="pi-tool"/>`}</svg>
      <span><b>${esc(o.label)}</b><small>${no ? `not for ${esc(String(T.catalog?.nof ?? calc.z))} flutes` : esc(o.sub)}</small></span></button>`; }).join('')}</div>
    ${cur ? `<figure class="engage" id="engage"><div id="eng-svg" role="slider" tabindex="0" aria-label="Cutter: drag up or down for depth ap, along the arrow for width ae; arrow keys also move it"></div><figcaption id="eng-cap"></figcaption></figure>` : '<p class="muted small">Choose a toolpath to place the cutter in the part.</p>'}`;
}

function drawEngage() {
  const box = document.getElementById('eng-svg'); if (!box || !ENG) return;
  const { D, loc, options, slot } = ENG;
  const p = currentPath(options); if (!p) return;
  const ae = Math.max(0, calc.ae || 0), ap = Math.max(0, calc.ap || 0);
  const apMax = p.apMaxX ? p.apMaxX * D : null, aeMax = p.aeMaxX * D;
  // A side pass dragged out to the full diameter is a full slot: the slot rule applies.
  const fullWidth = p.type === 'slot' || ae >= D - 1e-9;
  const checks = [
    fullWidth && !slot.ok && slot.why,
    ae > D + 1e-9 && 'Wider than the cutter',
    p.type === 'side' && options.published && ae > aeMax + 1e-9 && `Wider than M.A. Ford's published side-pass width (${esc(p.row?.ae || '')})`,
    loc && ap > loc + 1e-9 && 'Deeper than the flute length',
    apMax && ap > apMax + 1e-9 && `Deeper than M.A. Ford's published ${esc(p.row.application.toLowerCase())} depth (${esc(p.row.ap)})`,
  ].filter(Boolean);
  const bad = checks.length > 0;
  box.innerHTML = isoScene({ D, ae: p.type === 'slot' ? D : Math.min(ae, D), ap, loc, type: p.type, bad, axes: p.type === 'slot' ? 'v' : 'both' });
  const unit = calc.units === 'mm' ? 'mm' : 'in';
  const xd = (v, lim) => `<b class="${lim != null && v > lim + 1e-9 ? 'bad' : ''}">${fmt(v / D, 2)} × D</b>`;
  const apLim = Math.min(loc ?? Infinity, apMax ?? Infinity);
  const okMsg = ap > 0 ? [apMax ? `depth within M.A. Ford's ${esc(p.row.ap)}` : loc ? 'depth within the flute length' : null,
    p.type === 'side' && options.published ? `width within M.A. Ford's ${esc(p.row?.ae || '')}` : null,
    fullWidth && slot.why ? slot.why : null].filter(Boolean).join(' · ') : '';
  document.getElementById('eng-cap').innerHTML = `${p.type === 'side' && fullWidth ? 'Side pass at full width (a full slot)' : esc(p.label)} · ae ${fmt(ae, 3)} ${unit} ${xd(ae, p.type === 'side' ? aeMax : D)} · ap ${fmt(ap, 3)} ${unit} ${xd(ap, apLim === Infinity ? null : apLim)}<br>
    ${bad ? `<span class="bad">${checks.join(' · ')}</span>` : ap > 0 ? `<span class="good">In parameters: ${okMsg}</span>` : '<span class="muted">Drag the cutter down into the part</span>'}
    <br><span class="muted small">${p.type === 'slot' ? 'A full slot is 1 × D wide: drag up or down for depth.' : 'Drag up or down for depth (ap), along the slanted arrow for width (ae).'}</span>`;
}

function bindEngage(T, pubAll) {
  document.querySelectorAll('[data-path]').forEach(b => b.addEventListener('click', () => selectPath(+b.dataset.path, T, pubAll)));
  const box = document.getElementById('eng-svg'); if (!box) return;
  const D = calc.d, loc = T.apmx > 0 ? T.apmx : null;
  const options = toolpathOptions(pubAll?.rows?.length ? pubAll.rows : null);
  ENG = { D, loc, options, slot: slotCheck(T, pubAll) };
  drawEngage();
  const step = calc.units === 'mm' ? 0.01 : 0.001;
  const snap = v => Math.round(v / step) * step;
  const live = () => {
    drawEngage();
    for (const k of ['ae', 'ap']) {
      const el = document.getElementById('c-' + k); if (el) el.value = calc[k] ? String(+calc[k].toFixed(4)) : '';
      const lim = k === 'ae' ? D : loc, x = document.getElementById('xd-' + k);
      if (x && calc[k] > 0) x.innerHTML = `<span class="xd${lim != null && calc[k] > lim + 1e-9 ? ' bad' : ''}">${fmt(calc[k] / D, 2)} × D</span>`;
    }
    const r = compute({ ...calc, tool: { id: T.catalog ? T.catalog.tool : 'your tool', d: T.catalog ? T.d : undefined, nof: T.catalog ? T.nof : undefined, apmx: T.apmx } });
    const bar = document.getElementById('resultbar'); if (bar) bar.innerHTML = resultbarInner(r);
  };
  // Isometric axes on screen: more ae moves the cutter up-right along the slanted arrow
  // (cos30, -sin30); more ap moves it straight down.
  const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  let drag = null;
  box.addEventListener('pointerdown', e => {
    const { k, Hz } = isoScale({ D, ap: calc.ap || 0, loc });
    const rect = box.getBoundingClientRect();
    drag = { type: currentPath(ENG.options)?.type, x: e.clientX, y: e.clientY, ae: calc.ae || 0, ap: calc.ap || 0, ux: 340 / rect.width, uy: 300 / rect.height, k, maxAp: Hz };
    box.setPointerCapture(e.pointerId); box.classList.add('dragging'); e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    const sx = (e.clientX - drag.x) * drag.ux, sy = (e.clientY - drag.y) * drag.uy;
    const p = { type: drag.type };
    const dAe = p.type === 'side' ? sx / (C30 * drag.k) : 0;
    const dAp = sy / drag.k + dAe * S30;
    if (p?.type === 'side') {
      calc.ae = snap(Math.min(D, Math.max(step, drag.ae + dAe)));
      calc.path = { type: 'side', aeX: calc.ae / D };
    }
    calc.ap = snap(Math.min(drag.maxAp * 1.1, Math.max(0, drag.ap + dAp)));
    delete calc.examples?.ae; delete calc.examples?.ap;
    if (!live.raf) live.raf = requestAnimationFrame(() => { live.raf = 0; live(); });
  });
  const end = () => { if (!drag) return; drag = null; box.classList.remove('dragging'); saveCalc(); renderCalc(); };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  box.addEventListener('keydown', e => {
    const p = currentPath(ENG.options);
    const m = { ArrowDown: ['ap', 1], ArrowUp: ['ap', -1], ArrowRight: ['ae', 1], ArrowLeft: ['ae', -1] }[e.key];
    if (!m || (m[0] === 'ae' && p?.type !== 'side')) return; e.preventDefault();
    calc[m[0]] = snap(Math.max(m[0] === 'ae' ? step : 0, Math.min(m[0] === 'ae' ? D : Infinity, (calc[m[0]] || 0) + m[1] * (e.shiftKey ? 0.25 : 0.05) * D)));
    if (m[0] === 'ae') calc.path = { type: 'side', aeX: calc.ae / D };
    saveCalc(); live();
  });
}

// Picking a toolpath: ae from the option; ap at M.A. Ford's published depth (never past the
// flutes) or, without published data, a starting depth to drag from; M.A. Ford's fz and the low end
// of their Vc range when they publish them.
function selectPath(i, T, pubAll) {
  const options = toolpathOptions(pubAll?.rows?.length ? pubAll.rows : null);
  const o = options.opts[i]; if (!o) return;
  const D = calc.d, loc = T.apmx > 0 ? T.apmx : Infinity;
  calc.path = { type: o.type, aeX: o.aeX };
  calc.ae = +(o.aeX * D).toFixed(6);
  calc.ap = +Math.min(o.apMaxX ? o.apMaxX * D : (o.type === 'slot' ? 0.5 : 1) * D, loc).toFixed(6);
  calc.op = o.type === 'slot' ? 'slot' : calc.op === 'slot' ? null : calc.op;
  delete calc.examples?.ae; delete calc.examples?.ap;
  const sc = slotCheck(T, pubAll);
  let msg = o.type === 'slot' && !sc.ok ? sc.why : `${o.label}: drag the cutter for depth${o.type === 'side' ? ' and width' : ''}`;
  if (o.row && pubAll) {
    const toMetric = calc.units === 'mm' && pubAll.unit === 'in';
    calc.speedFrom = 'vc'; calc.feedFrom = 'fz'; calc.examples = {};
    calc.vc = toMetric ? +(o.row.vcRange.lo * 0.3048).toFixed(1) : o.row.vcRange.lo;
    calc.fz = toMetric ? +(o.row.fzAtD * 25.4).toFixed(4) : o.row.fzAtD;
    calc.pubFrom = pubKey(T.catalog, materialById(calc.material));
    if (!(o.type === 'slot' && !sc.ok)) msg = `${o.label}: M.A. Ford ${o.row.application.toLowerCase()} values (page ${pubAll.page})`;
  }
  saveCalc(); renderCalc(); toast(msg);
}

// ---------- M.A. Ford published speeds and feeds ----------
function publishedCard(pub, tool, mat, sfPdf) {
  if (!tool) return '';
  const link = (label) => sfPdf ? `<a class="ext" href="${esc(sfPdf)}" target="_blank" rel="noopener">${label}</a>` : '';
  if (!pub) return sfPdf ? `<p class="muted small">M.A. Ford publishes speeds and feeds for Series ${esc(tool.series)}: ${link('Speed and Feed Data (PDF)')}. This demo has not read that sheet's layout yet.</p>` : '';
  if (pub.noColumn) return `<p class="muted small">M.A. Ford's Speed and Feed Data for Series ${esc(tool.series)} lists diameters ${esc(pub.diameters.join(', '))}, not this tool's size. ${link('Open the PDF')}</p>`;
  if (!mat) return `<div class="note info small">M.A. Ford publishes speeds and feeds for this tool (Series ${esc(tool.series)}, ${esc(pub.column)}"). Choose the workpiece material to see them.</div>`;
  if (!pub.rows.length) return `<div class="note info small">M.A. Ford's Speed and Feed Data for Series ${esc(tool.series)} has no row for ${esc(mat.name.toLowerCase())}. ${link('Open the PDF')}</div>`;
  const u = calc.units, toMetric = u === 'mm' && pub.unit === 'in';
  const vcTxt = r => toMetric ? `${fmt(r.vcRange.lo * 0.3048, 0)}–${fmt(r.vcRange.hi * 0.3048, 0)} m/min` : `${esc(r.vc)} ${pub.unit === 'mm' ? 'm/min' : 'SFM'}`;
  const fzTxt = r => toMetric ? `${fmt(r.fzAtD * 25.4, 3)} mm/tooth` : `${fzPrinted(r.fzAtD)} ${pub.unit === 'mm' ? 'mm' : 'in'}/tooth`;
  return `<div class="pub card-inset">
    <h3>M.A. Ford published data <small class="muted">· ${esc(pub.column)}" · ${esc(pub.locXD ? pub.locXD + '×D cutting length table' : '')}</small></h3>
    ${!pub.opMatched ? '<p class="muted small">No row for the chosen operation; all rows for this material are shown.</p>' : ''}
    <table class="dims pubt"><thead><tr><th>Operation</th><th>ae / ap</th><th>Vc</th><th>fz</th><th></th></tr></thead><tbody>
    ${pub.rows.map((r, i) => `<tr><td>${esc(r.application)}<br><small class="muted">${esc(r.material)}</small></td><td>${esc(r.ae)}<br>${esc(r.ap)}</td><td>${vcTxt(r)}</td><td>${fzTxt(r)}</td><td><button type="button" class="btn small" data-pub="${i}">Use</button></td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">From M.A. Ford's Speed and Feed Data for Series ${esc(tool.series)}, page ${esc(pub.page)} (advisory, as M.A. Ford notes). ${link('Open the PDF')}. "Use" fills fz, sets the operation's ae and ap at M.A. Ford's limits, and puts Vc at the low end of the printed range.</p>
  </div>`;
}
function bindPublished(pub, T) {
  document.querySelectorAll('[data-pub]').forEach(b => b.addEventListener('click', () => {
    const r = pub.rows[+b.dataset.pub], u = calc.units, toMetric = u === 'mm' && pub.unit === 'in';
    calc.speedFrom = 'vc'; calc.feedFrom = 'fz'; calc.examples = {};
    calc.vc = toMetric ? +(r.vcRange.lo * 0.3048).toFixed(1) : r.vcRange.lo;
    calc.fz = toMetric ? +(r.fzAtD * 25.4).toFixed(4) : r.fzAtD;
    calc.pubFrom = pubKey(T.catalog, materialById(calc.material));
    if (r.aeLim) calc.ae = +(r.aeLim.max * calc.d).toFixed(5);
    if (r.apLim) calc.ap = +(Math.min(r.apLim.max * calc.d, T.apmx || Infinity)).toFixed(5);
    calc.op = /slot/i.test(r.application) ? 'slot' : calc.op && calc.op !== 'slot' ? calc.op : 'hem';
    calc.path = /slot/i.test(r.application) ? { type: 'slot', aeX: 1 } : r.aeLim ? { type: 'side', aeX: r.aeLim.max } : null;
    saveCalc(); renderCalc(); toast(`M.A. Ford ${r.application.toLowerCase()} values loaded (page ${pub.page})`);
  }));
}

// ---------- sheets ----------
// Closing always redraws the calculator; the dialog's own close event is not relied on (some browsers skip it).
function closeSheet() { const d = document.getElementById('sheet'); if (d.open) d.close(); if ((location.hash || '#/calc').startsWith('#/calc')) renderCalc(); }
function sheet(title, html, onReady) {
  const d = document.getElementById('sheet');
  d.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="btn small" data-close>Done</button></div><div class="sheet-body">${html}</div>`;
  d.querySelector('[data-close]').addEventListener('click', () => closeSheet());
  d.oncancel = e => { e.preventDefault(); closeSheet(); }; // Esc key
  if (!d.open) d.showModal();
  onReady?.(d);
}

function openToolSheet() {
  const u = calc.units, tool = calc.toolId ? BY_ID.get(calc.toolId) : null;
  const ws = tool && webSeries(tool.series);
  const stepD = u === 'mm' ? 0.5 : 1 / 64, stepL = u === 'mm' ? 1 : 1 / 16, stepR = u === 'mm' ? 0.1 : 0.005;
  const T = currentTool();
  const row = (k, label, step, value, isInt) => `<div class="stepper"><label for="t-${k}">${label}</label><div class="row"><button type="button" class="btn" data-step="${k}" data-d="-${step}" aria-label="Decrease ${label}">−</button><input id="t-${k}" data-t="${k}" inputmode="decimal" value="${esc(value == null || Number.isNaN(value) ? '' : isInt ? value : +(+value).toFixed(4))}"><button type="button" class="btn" data-step="${k}" data-d="${step}" aria-label="Increase ${label}">+</button></div></div>`;
  sheet('Tool definition', `
    ${tool ? `<div class="sheet-tool">${ws?.drawing ? `<img class="drawing" src="${esc(mfImg(ws.drawing, 700))}" alt="M.A. Ford drawing for Series ${esc(tool.series)}" onerror="this.remove()">` : ''}
      <p><b class="mono">${esc(tool.tool)}</b> · Series ${esc(tool.series)} · ${esc(dia(tool))} · ${tool.nof} fl · ${esc(corner(tool))}</p>
      <p class="muted small">Sizes come from the catalog. Changing them below turns this into your own tool.</p></div>` : '<p class="muted small">Enter your tool, or pick one from the catalog.</p>'}
    ${row('d', `Diameter D (${u})`, stepD, calc.d)}
    ${row('l2', `Flute length L2 (${u})`, stepL, T.apmx)}
    ${row('re', `Corner radius R (${u})`, stepR, T.re ?? 0)}
    ${row('z', 'Flutes Z', 1, calc.z, true)}
    <div class="list-actions"><a class="btn primary" href="#/find">Pick from the M.A. Ford catalog</a>${tool ? `<a class="btn" href="#/tool/${encodeURIComponent(tool.id)}">Tool details</a><button type="button" class="btn" id="t-clear">Use my own tool</button>` : ''}</div>`,
  d => {
    const toUser = () => { if (calc.toolId) { const t = currentTool(); calc.l2 = +t.apmx.toFixed(6); calc.re = +(t.re || 0).toFixed(6); calc.toolId = null; } };
    const apply = (k, v) => { toUser(); calc[k] = k === 'z' ? Math.max(1, Math.round(v)) : Math.max(0, +v.toFixed(6)); saveCalc(); };
    d.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.step, inp = d.querySelector(`#t-${k}`);
      const cur = parseFloat(inp.value) || 0, next = cur + parseFloat(b.dataset.d);
      if (next < (k === 'z' ? 1 : 0)) return;
      apply(k, next); inp.value = k === 'z' ? calc[k] : +calc[k].toFixed(4);
    }));
    d.querySelectorAll('[data-t]').forEach(i => i.addEventListener('change', () => {
      const k = i.dataset.t; const P = k === 'z' ? { v: parseInt(i.value, 10) } : (() => { const x = parseLength(i.value, u); return x ? { v: u === 'mm' ? x.in * MM_PER_IN : x.in } : /^0*\.?0*$/.test(i.value.trim()) ? { v: 0 } : null; })();
      if (P && Number.isFinite(P.v)) apply(k, P.v); else i.setAttribute('aria-invalid', 'true');
    }));
    d.querySelector('#t-clear')?.addEventListener('click', () => { toUser(); saveCalc(); closeSheet(); });
    d.querySelectorAll('a').forEach(a => a.addEventListener('click', () => closeSheet()));
  });
}

function openMaterialSheet() {
  sheet('Workpiece material', `<ul class="mat-list">${MATERIALS.map(m => `<li><button type="button" data-m="${m.id}" style="--iso:${ISO_COLORS[m.iso]}" aria-pressed="${calc.material === m.id}">
      <span class="iso">${m.iso}</span><span class="grow"><b>${esc(m.name)}</b><small>${esc([m.grades, m.hardness].filter(Boolean).join(' · '))}</small></span></button></li>`).join('')}</ul>
    <p class="muted small">Material names and groups as in the catalog's cutting-data tables. The group is used to find tools M.A. Ford lists for it.</p>
    ${calc.material ? '<button type="button" class="btn small" data-m="">Clear material</button>' : ''}`,
  d => d.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { calc.material = b.dataset.m || null; saveCalc(); closeSheet(); })));
}

function openPresetSheet() {
  sheet('Engagement presets', `<p class="muted small">Pick an engagement (radial ae × axial ap, as multiples of the diameter). This only fills ae and ap; it is not a recommendation for any tool or material.</p>
    <div class="preset-grid">${ENGAGEMENT_PRESETS.map(([ae, ap]) => `<button type="button" data-ae="${ae}" data-ap="${ap}"><svg viewBox="0 0 60 60" aria-hidden="true"><rect x="8" y="${50 - Math.min(ap, 2) * 20}" width="${30 + Math.min(ae, 1) * 14}" height="${Math.min(ap, 2) * 20}" fill="var(--block)"/><rect x="38" y="${50 - Math.min(ap, 2) * 20}" width="${Math.min(ae, 1) * 14}" height="${Math.min(ap, 2) * 20}" fill="var(--good)"/><rect x="38" y="4" width="14" height="46" fill="none" stroke="var(--muted)"/></svg><span>ae ${ae} × D<br>ap ${ap} × D</span></button>`).join('')}</div>
    ${!(calc.d > 0) ? '<p class="note warn">Enter a tool diameter first.</p>' : ''}`,
  d => d.querySelectorAll('[data-ae]').forEach(b => b.addEventListener('click', () => {
    if (!(calc.d > 0)) return;
    calc.ae = +(calc.d * +b.dataset.ae).toFixed(6); calc.ap = +(calc.d * +b.dataset.ap).toFixed(6);
    delete calc.examples?.ae; delete calc.examples?.ap; saveCalc(); closeSheet();
  })));
}

function summary(c, r, name) {
  const u = c.units, U = UNITS[u];
  const t = c.toolId ? BY_ID.get(c.toolId) : null;
  const m = materialById(c.material), op = OPERATIONS.find(o => o.id === c.op);
  const lines = [`SAM tooling demo setup${name ? ` — ${name}` : ''}`];
  if (t) lines.push(`Tool: M.A. Ford ${t.tool} (EDP ${t.edp}), Series ${t.series}, ${dia(t)}, ${t.nof} fl, ${corner(t)}, ${t.coating || 'coating not printed'} — catalog Vol. 105 p. ${t.page}`);
  else lines.push(`Tool: user defined, D ${fmt(c.d)} ${U.len}, flute length ${fmt(c.l2)} ${U.len}, R ${fmt(c.re ?? 0)} ${U.len}, ${c.z ?? '—'} fl`);
  if (m || op) lines.push([m && `Material: ${m.name} (ISO ${m.iso})`, op && `Operation: ${op.name}`].filter(Boolean).join(' · '));
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
      ${countBy('web') ? `<tr><th>maford.com only (newer than Vol. 105)</th><td><b>${countBy('web').toLocaleString()}</b> end mills, ${seriesBy('web')} series, from the website's tool tables</td></tr>` : ''}
      <tr><th>Speeds and feeds</th><td>M.A. Ford's published values shown for ${Object.values(SF).filter(x => x.tables.length).length ? esc(Object.keys(SF).filter(k => SF[k].tables.length).join(', ')) : 'no series yet'}; other series link to their data sheet or catalog pages</td></tr>
      <tr><th>Total loaded</th><td><b>${DATA.products.length.toLocaleString()}</b> catalog rows (each coating or shank version is its own part number)</td></tr>
    </tbody></table>
    <p><b>Not loaded:</b> ${cov.notLoaded.map(esc).join('; ')}.</p>
    <p class="muted" style="font-size:.85rem">Read on ${esc(C.extracted)} from M.A. Ford Product Catalog Vol. 105. Every row's printed decimal size was checked against the diameter coded in its own part number${WEB ? `, and against the size in M.A. Ford's website description (checked ${esc(WEB.checked)}; ${Object.keys(WEB.tools).length.toLocaleString()} tools listed there)` : ''}. Check the catalog before ordering.</p>
    ${WEB ? '<p class="muted small">Product photos, drawings and material/application icons are shown directly from maford.com and remain M.A. Ford\'s. They need internet the first time; after that the app keeps them for offline use.</p>' : ''}
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
    <p>Independent prototype for discussion. Not an M.A. Ford product, and not endorsed by M.A. Ford. <span class="muted small" id="app-version"></span> M.A. Ford's own calculator app: <a class="ext" href="https://apps.apple.com/us/app/m-a-ford-machining-calculator/id1554634640" target="_blank" rel="noopener">App Store</a>.</p>
  </div>`;
  fetch('sw.js').then(r => r.text()).then(t => { const v = (t.match(/VERSION = '([0-9a-f]+)'/) || [])[1]; const el = $('#app-version'); if (v && el) el.textContent = 'App version ' + v + '.'; }).catch(() => {});
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
    // Optional website data: official images and listings, website-only series, published speeds and feeds.
    const [web, webSeries_, webProducts, speedfeed] = await Promise.all(['web', 'web-series', 'web-products', 'speedfeed'].map(n => get(n).catch(() => null)));
    WEB = web || { series: {}, tools: {} };
    SF = speedfeed?.series || {};
    for (const [id, w] of Object.entries(webSeries_?.series || {})) {
      WEB.series[id] = { ...w, ...(WEB.series[id] || {}), speedFeedPdf: w.speedFeedPdf, description: w.description };
      if (!series[id] && w.tools) {
        // A series on maford.com that is not in the loaded Vol. 105 catalog sections.
        const line = (w.description.match(/TuffCut\s*([A-Z0-9-]+)/i) || [])[1];
        series[id] = { id, doc: 'web', web: true, title: `${line || 'Series'} - Series ${id}`, line: line ? `TuffCut ${line}` : null, nof: w.nof, corners: [], features: [], notes: w.description ? [w.description] : [], pages: [], page: w.page };
      }
    }
    if (webProducts) products.push(...webProducts.filter(p => !products.some(q => q.id === p.id)));
    for (const [id, w] of Object.entries(WEB.series)) if (series[id]) series[id].webIso = [...new Set((w.materials || []).map(m => m.iso).filter(Boolean))];
    DATA = { products, series, catalogs };
    BY_ID = new Map(products.map(p => [p.id, p]));
    SERIES_IDS = Object.keys(series).sort((a, b) => series[a].doc.localeCompare(series[b].doc) || a.localeCompare(b, 'en', { numeric: true }));
    route();
  } catch (e) {
    view.innerHTML = `<div class="card"><h1>Could not load the catalog data</h1><p>${esc(e.message)}</p><p>If you are offline, open the app once while online so it can save the data.</p></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    // A new version was published: reload once so the phone runs it straight away.
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !boot.reloaded) { boot.reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
}
boot();
