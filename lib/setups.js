// Saved setups (this browser only) and share links. A share link carries the setup in the URL
// fragment, so it is never sent to a server.

const KEY = 'sam-maford-setups-v1';
const FIELDS = ['units', 'd', 'z', 'vc', 'n', 'fz', 'vf', 'ae', 'ap', 'maxRpm', 'speedFrom', 'feedFrom', 'l2', 're', 'material', 'op'];

export function pick(state) {
  const o = {};
  for (const k of FIELDS) if (state[k] !== undefined && state[k] !== '' && !Number.isNaN(state[k])) o[k] = state[k];
  if (state.toolId) o.toolId = state.toolId;
  return o;
}

export function loadAll(storage) {
  try { const v = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveAll(storage, list) {
  try { storage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function add(storage, name, state, now = Date.now()) {
  const list = loadAll(storage);
  const item = { id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: String(name || 'Untitled setup').slice(0, 80), saved: now, setup: pick(state) };
  list.unshift(item);
  return saveAll(storage, list) ? item : null;
}
export function remove(storage, id) {
  const list = loadAll(storage).filter(s => s.id !== id);
  saveAll(storage, list);
  return list;
}

// base64url(JSON) in "#/calc?s=..." links.
export function encode(setup, name) {
  const json = JSON.stringify({ v: 1, n: name || undefined, s: pick(setup) });
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode(code) {
  try {
    const b64 = String(code).replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8');
    const o = JSON.parse(json);
    if (!o || o.v !== 1 || typeof o.s !== 'object') return null;
    const s = {};
    for (const k of FIELDS) if (k in o.s) s[k] = o.s[k];
    for (const k of ['d', 'z', 'vc', 'n', 'fz', 'vf', 'ae', 'ap', 'maxRpm', 'l2', 're']) if (k in s && typeof s[k] !== 'number') delete s[k];
    for (const k of ['material', 'op']) if (k in s && !(typeof s[k] === 'string' && /^[a-z0-9-]{1,30}$/.test(s[k]))) delete s[k];
    for (const k of ['speedFrom', 'feedFrom']) if (k in s && !['vc', 'n', 'fz', 'vf'].includes(s[k])) delete s[k];
    if (s.units !== 'in' && s.units !== 'mm') s.units = 'in';
    if (typeof o.s.toolId === 'string') s.toolId = o.s.toolId.slice(0, 40);
    return { name: typeof o.n === 'string' ? o.n.slice(0, 80) : null, setup: s };
  } catch { return null; }
}
