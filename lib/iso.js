// Isometric picture of one toolpath: the workpiece with the cut removed and the cutter in it.
// Pure SVG string builder (no DOM), so it can be tested. Units are the calculator's (in or mm).
//   type 'slot': a full-width slot running in from the front face, cutter at its end.
//   type 'side': a side pass along the front edge, ae wide and ap deep, cutter at the end of the cut.

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;

export function isoScene({ D, ae, ap, loc, type, bad, axes = 'v', W = 340, H = 300 }) {
  const r = D / 2;
  const flute = loc > 0 ? loc : 2 * D;
  const Lx = 4 * D, Wy = 3 * D, Hz = Math.max(flute * 1.15, 2.4 * D, ap * 1.15);
  ap = Math.max(0, Math.min(ap, Hz));
  ae = Math.max(0, Math.min(ae, D));
  // Fit: the scene spans (Lx + Wy) * cos30 wide and (Lx + Wy) * sin30 + Hz + cutter above.
  const above = flute * 0.9 + D;          // cutter sticking out above the part
  const k = Math.min((W - 30) / ((Lx + Wy) * C30), (H - 30) / ((Lx + Wy) * S30 + Hz + above));
  const ox = (W - (Lx + Wy) * C30 * k) / 2 + Wy * C30 * k, oy = 15 + (above + Hz) * k;   // centred
  const P = (x, y, z) => [ox + (x - y) * C30 * k, oy + (x + y) * S30 * k - z * k];
  const pts = a => a.map(p => P(...p).map(n => n.toFixed(1)).join(',')).join(' ');
  const face = (a, cls) => `<polygon points="${pts(a)}" class="${cls}"/>`;
  // A box: its three visible faces (top, front y=y1, right x=x1).
  // ghost: drawn see-through, for material in front of the cutter (a cut-away view).
  const box = (x0, x1, y0, y1, z0, z1, ghost) => (x1 - x0 > 1e-9 && y1 - y0 > 1e-9 && z1 - z0 > 1e-9) ? (ghost ? '<g class="iso-ghost">' : '<g>') + [
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 'iso-top'),
    face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 'iso-front'),
    face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 'iso-side'),
  ].join('') + '</g>' : '';

  // The cutter: a vertical cylinder at (cx, cy) from zb (tip) upward: flutes, then shank.
  const cutter = (cx, cy, zb) => {
    const [sx, sy] = P(cx, cy, zb);
    const rx = r * Math.SQRT2 * C30 * k, ry = r * Math.SQRT2 * S30 * k;
    const fl = flute * k, shank = Math.max(above * k - fl + (Hz - zb) * k * 0, D * k * 0.6);
    const engagedTop = Math.min(ap, flute) * k;     // part of the flutes below the top surface
    const overTop = Math.max(0, ap - flute) * k;    // shank below the surface (too deep)
    const col = bad ? 'var(--bad)' : 'var(--good)';
    const band = (y0, h, fill, cls = '') => `<path class="${cls}" d="M${sx - rx},${y0} v${-h} a${rx},${ry} 0 0 0 ${2 * rx},0 v${h} a${rx},${ry} 0 0 1 ${-2 * rx},0z" fill="${fill}"/>`;
    return `<g class="eng-tool">
      ${band(sy, fl, 'url(#isoFlute)')}
      ${band(sy - fl, shank + 40, 'url(#isoShank)')}
      ${ap > 0 ? band(sy, Math.min(ap, flute) * k, col, 'iso-engaged') : ''}
      ${overTop ? band(sy - fl, overTop, 'var(--bad)', 'iso-engaged') : ''}
      <ellipse cx="${sx}" cy="${sy}" rx="${rx}" ry="${ry}" fill="${ap > 0 ? col : 'url(#isoFlute)'}" opacity=".9"/>
      <g class="eng-handle" transform="translate(${sx} ${(sy - fl - 18).toFixed(1)})"><circle r="13"/><path d="M0-7V7M0-7l-3 3M0-7l3 3M0 7l-3-3M0 7l3-3${axes === 'both' ? 'M-6.1 3.5L6.1-3.5M6.1-3.5l-3.9-.1M6.1-3.5l-1.8 3.4M-6.1 3.5l3.9.1M-6.1 3.5l1.8-3.4' : ''}"/></g>
      ${axisArrows(sx, sy, rx, fl)}
    </g>`;
  };
  // Direction arrows beside the cutter: ap straight down; for side passes ae along the isometric
  // axis into the wall (the direction the cutter moves for a wider cut).
  const axisArrows = (sx, sy, rx, fl) => {
    const ax = sx + rx + 16, ay = sy - fl * 0.5;
    const v = `<g class="iso-axis"><path d="M${ax},${ay - 22}V${ay + 22}M${ax},${ay + 22}l-4-6M${ax},${ay + 22}l4-6"/><text x="${ax + 5}" y="${ay + 26}">ap</text></g>`;
    if (axes !== 'both') return v;
    const hx = sx - rx - 26, hy = sy + 6, dx = 22 * C30, dy = -22 * S30;
    return v + `<g class="iso-axis"><path d="M${hx - dx},${hy - dy}L${hx + dx},${hy + dy}M${hx + dx},${hy + dy}l-6.8-.4M${hx + dx},${hy + dy}l-3 6.1"/><text x="${hx - dx - 14}" y="${hy - dy + 4}">ae</text></g>`;
  };

  let body = '';
  const top = Hz, floor = Hz - ap;
  if (type === 'slot') {
    // Slot along x, opening on the right-hand face; the cutter is part-way in.
    const y1 = Wy / 2 - r, y2 = Wy / 2 + r, xc = Lx * 0.42;
    body += box(0, Lx, 0, y1, 0, top);                         // wall behind the slot
    body += box(0, Lx, y1, y2, 0, floor);                      // under the slot
    body += box(0, xc, y1, y2, floor, top);                    // not cut yet (ahead of the cutter)
    body += cutter(xc, Wy / 2, floor);
    body += box(0, Lx, y2, Wy, 0, top, true);                  // wall in front of the slot: see-through
  } else {
    // Side pass along the front edge: ae wide, ap deep, from the cutter to the right-hand face.
    const xc = Lx * 0.42, yw = Wy - ae;
    body += box(0, Lx, 0, yw, 0, top);                         // the wall that stays
    body += box(xc, Lx, yw, Wy, 0, floor);                     // floor of the step
    body += cutter(xc, yw + r, floor);
    body += box(0, xc, yw, Wy, 0, top, true);                  // material being cut, ahead of the cutter: see-through
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="isoFlute" x1="0" x2="1"><stop offset="0" stop-color="var(--flute)"/><stop offset=".45" stop-color="#fff3b0"/><stop offset="1" stop-color="#b98d10"/></linearGradient>
      <linearGradient id="isoShank" x1="0" x2="1"><stop offset="0" stop-color="var(--shank)"/><stop offset=".45" stop-color="#eef1f4"/><stop offset="1" stop-color="#7d8790"/></linearGradient>
    </defs>${body}</svg>`;
}

// Screen pixels per unit of depth, for turning a vertical drag into a change of ap.
export function isoScale({ D, ap, loc, W = 340, H = 300 }) {
  const flute = loc > 0 ? loc : 2 * D, Lx = 6 * D, Wy = 4 * D, Hz = Math.max(flute * 1.15, 2.4 * D, ap * 1.15);
  const above = flute * 0.9 + D;
  return { k: Math.min((W - 30) / ((Lx + Wy) * C30), (H - 30) / ((Lx + Wy) * S30 + Hz + above)), Hz };
}

// The toolpaths offered for a tool. With M.A. Ford's published rows (slotting / profiling) only
// those operations, at widths up to their printed limit; without them, the usual full slot and side
// passes, limited only by the flute length.
export const SIDE_STEPS = [0.05, 0.1, 0.2, 0.3, 0.5];
export function toolpathOptions(rows) {
  const opts = [];
  if (rows?.length) {
    const slot = rows.find(r => /slot/i.test(r.application));
    const side = rows.find(r => /profil|side/i.test(r.application));
    if (slot) opts.push({ type: 'slot', aeX: 1, apMaxX: slot.apLim?.max ?? null, row: slot, label: 'Full slot', sub: `1 × D wide · ap ${slot.ap}` });
    if (side?.aeLim) {
      const m = side.aeLim.max;
      const steps = [...new Set([...SIDE_STEPS.filter(x => x < m - 1e-9), m])];
      for (const x of steps) opts.push({ type: 'side', aeX: x, apMaxX: side.apLim?.max ?? null, row: side, label: `Side pass ${x} × D`, sub: `ap ${side.ap}` });
    }
    return { published: true, opts };
  }
  opts.push({ type: 'slot', aeX: 1, apMaxX: null, label: 'Full slot', sub: '1 × D wide' });
  for (const x of SIDE_STEPS) opts.push({ type: 'side', aeX: x, apMaxX: null, label: `Side pass ${x} × D`, sub: `${x} × D wide` });
  return { published: false, opts };
}
