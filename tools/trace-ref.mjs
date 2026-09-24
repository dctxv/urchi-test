#!/usr/bin/env node
// Traces the two references the 3D head is built from (needs the playwright package + Chromium):
//
//   node tools/trace-ref.mjs
//     ref/head-half.png -> tools/mascot-facets.json  front planes of the right half (blue planes,
//                          green edges, magenta background, straight centre line on the left)
//     ref/head-side.png -> tools/side-profile.json   leftmost/rightmost head pixel of every row of
//                          the side view (grey background flood-filled from the border)
//
// Every blue region is walked into a polygon, grown to the centre of its green edge line,
// and shared corners are snapped together; vertices on the centre line lock to the axis.
// tools/build-mascot.mjs does the rest (exact corner matching, mirroring, depth).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(ROOT, 'ref/head-half.png'), out = resolve(ROOT, 'tools/mascot-facets.json');
const minSize = 60, SNAP = 10, HALF_LINE = 2.4;   // green edge lines are ~5px wide: grow each plane by half of that
const data = 'data:image/png;base64,' + readFileSync(src).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<canvas id=c></canvas><img id=i src="${data}">`);
await page.waitForFunction(() => document.getElementById('i').complete);
const result = await page.evaluate(([minSize]) => {
  const img = document.getElementById('i'), c = document.getElementById('c');
  const W = c.width = img.naturalWidth, H = c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data, N = W * H;
  const isBg = i => px[i*4] > 150 && px[i*4+2] > 150 && px[i*4+1] < 120;     // magenta
  const isPlane = i => px[i*4+2] > 150 && px[i*4] < 110 && px[i*4+1] < 140;   // blue
  const label = new Int32Array(N).fill(-1); const regions = [];
  for (let s = 0; s < N; s++) {
    if (label[s] >= 0 || !isPlane(s)) continue;
    const stack = [s]; label[s] = regions.length; const pts = [];
    while (stack.length) { const i = stack.pop(); pts.push(i); const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x+dx, ny = y+dy; if (nx<0||ny<0||nx>=W||ny>=H) continue; const j = ny*W+nx; if (label[j]>=0||!isPlane(j)) continue; label[j] = regions.length; stack.push(j); } }
    regions.push({ id: regions.length, size: pts.length, pts });
  }
  // the centre line: leftmost column of the shape
  let axis = W; for (let i = 0; i < N; i++) if (!isBg(i)) axis = Math.min(axis, i % W);
  function contour(r) {
    // crack-following walk along pixel edges, inside kept on the right-hand side
    const set = new Uint8Array(N); for (const i of r.pts) set[i] = 1;
    let start = Infinity; for (const i of r.pts) if (i < start) start = i;
    const cell = (x, y) => x >= 0 && y >= 0 && x < W && y < H && set[y * W + x] === 1;
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    let x = start % W, y = (start / W) | 0, d = 0; const sx = x, sy = y; const path = [];
    for (let step = 0; step < 400000; step++) {
      path.push([x, y]);
      // cells ahead-left and ahead-right relative to heading d, from corner (x, y)
      let al, ar;
      if (d === 0) { al = cell(x, y - 1); ar = cell(x, y); }
      else if (d === 1) { al = cell(x, y); ar = cell(x - 1, y); }
      else if (d === 2) { al = cell(x - 1, y); ar = cell(x - 1, y - 1); }
      else { al = cell(x - 1, y - 1); ar = cell(x, y - 1); }
      if (!ar) d = (d + 1) % 4; else if (al) d = (d + 3) % 4;
      x += DX[d]; y += DY[d];
      if (x === sx && y === sy) break;
    }
    return path;
  }
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const d2 = (p, a, b) => { const dx = b[0]-a[0], dy = b[1]-a[1]; const l = dx*dx+dy*dy; let t = l ? ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l : 0; t = Math.max(0, Math.min(1, t)); const qx = a[0]+t*dx-p[0], qy = a[1]+t*dy-p[1]; return qx*qx+qy*qy; };
    const rec = (a, b) => { let m = 0, mi = -1; for (let i = a + 1; i < b; i++) { const dd = d2(pts[i], pts[a], pts[b]); if (dd > m) { m = dd; mi = i; } } if (m > eps*eps) return [...rec(a, mi), ...rec(mi, b).slice(1)]; return [pts[a], pts[b]]; };
    let far = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const dx = pts[i][0]-pts[0][0], dy = pts[i][1]-pts[0][1]; if (dx*dx+dy*dy > fd) { fd = dx*dx+dy*dy; far = i; } }
    const a = rec(0, far), b = rec(far, pts.length - 1); return [...a, ...b.slice(1)];
  }
  const outR = regions.filter(r => r.size >= minSize).map(r => ({ id: r.id, size: r.size, poly: simplify(contour(r), 3) }));
  const sil = { pts: [] }; for (let i = 0; i < N; i++) if (!isBg(i)) sil.pts.push(i);
  return { W, H, axis, regions: outR, silhouette: simplify(contour(sil), 2.5) };
}, [minSize]);
await browser.close();
const t = result;
const AXIS = t.axis;
const regions = t.regions;
// clean-up: merge near-duplicate vertices, then drop, one at a time, the vertex that deviates least
// from the line between its neighbours while that deviation is under eps (stair-steps on anti-aliased edges)
const straighten = (poly, eps) => {
  let out = poly.filter((p, i) => Math.hypot(p[0] - poly[(i + 1) % poly.length][0], p[1] - poly[(i + 1) % poly.length][1]) > 2);
  const dev = (i) => { const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length], p = out[i]; const dx = b[0]-a[0], dy = b[1]-a[1]; const l = Math.hypot(dx, dy) || 1; return Math.abs((p[0]-a[0]) * dy - (p[1]-a[1]) * dx) / l; };
  while (out.length > 3) { let mi = -1, m = Infinity; for (let i = 0; i < out.length; i++) { const d = dev(i); if (d < m) { m = d; mi = i; } } if (m >= eps) break; out.splice(mi, 1); }
  return out;
};
// clipped tips: where the raster cut an acute corner short, two vertices sit close together with
// converging outer edges; replace the pair with the corner those edges actually meet at
const sharpen = (poly, maxGap, nearOutline) => {
  const out = poly.slice();
  for (let i = 0; i < out.length && out.length > 3; i++) {
    const n = out.length, a = out[(i + n - 1) % n], p = out[i], q = out[(i + 1) % n], b = out[(i + 2) % n];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > maxGap) continue;
    const d1 = [p[0] - a[0], p[1] - a[1]], d2 = [q[0] - b[0], q[1] - b[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(den) < 1e-6) continue;
    const t = ((b[0] - a[0]) * d2[1] - (b[1] - a[1]) * d2[0]) / den;
    const x = a[0] + d1[0] * t, y = a[1] + d1[1] * t;
    if (t < 1 || Math.hypot(x - p[0], y - p[1]) > 80 || !nearOutline([x, y])) continue;   // only extend forward, onto the outline
    out.splice(i, 2, [x, y]); i--;
  }
  return out;
};
// grow a polygon outward by w: shift every edge along its outward normal and intersect neighbours,
// so a plane's corners land on the centre of the green line instead of half a line-width inside it
function offset(poly, w) {
  const n = poly.length;
  let area = 0; for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;   // orientation-independent outward normal
  const lines = poly.map((a, i) => { const b = poly[(i + 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; const nx = sgn * dy / l, ny = -sgn * dx / l; return { ax: a[0] + nx * w, ay: a[1] + ny * w, dx, dy }; });
  return poly.map((p, i) => { const L1 = lines[(i + n - 1) % n], L2 = lines[i]; const den = L1.dx * L2.dy - L1.dy * L2.dx;
    if (Math.abs(den) < 1e-6) return [L2.ax, L2.ay];
    const t = ((L2.ax - L1.ax) * L2.dy - (L2.ay - L1.ay) * L2.dx) / den; const x = L1.ax + L1.dx * t, y = L1.ay + L1.dy * t;
    return Math.hypot(x - p[0], y - p[1]) > 24 ? [L2.ax, L2.ay] : [x, y]; });   // cap runaway miters
}
// snap shared vertices: greedy clustering (no chaining); vertices on the centre line lock to the axis
const rawSil = straighten(t.silhouette, 3);
const distToSil = ([x, y], poly) => { let best = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[j], [bx, by] = poly[i]; const dx = bx - ax, dy = by - ay; const l = dx * dx + dy * dy; const u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0; best = Math.min(best, Math.hypot(ax + u * dx - x, ay + u * dy - y)); } return best; };
const nearSil = p => distToSil(p, rawSil) < 10;
for (const r of regions) r.poly = offset(sharpen(sharpen(straighten(r.poly, 3), 45, nearSil), 45, nearSil), HALF_LINE);
t.silhouette = offset(sharpen(sharpen(rawSil, 45, () => true), 45, () => true), HALF_LINE);
const all = []; regions.forEach(r => r.poly.forEach(p => all.push(p))); t.silhouette.forEach(p => all.push(p));
const clusters = []; const snapped = new Map();
for (const p of all) { let c = clusters.find(c => Math.hypot(c.x - p[0], c.y - p[1]) <= SNAP); if (!c) { c = { x: p[0], y: p[1], n: 0, pts: [] }; clusters.push(c); } c.pts.push(p); c.x = (c.x * c.n + p[0]) / (c.n + 1); c.y = (c.y * c.n + p[1]) / (c.n + 1); c.n++; }
for (const c of clusters) { if (Math.abs(c.x - AXIS) <= 8) c.x = AXIS; for (const p of c.pts) snapped.set(p, [Math.round(c.x * 2) / 2, Math.round(c.y * 2) / 2]); }
const dedupe = poly => poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return p[0] !== q[0] || p[1] !== q[1]; });
const toPoly = r => straighten(dedupe(r.poly.map(p => snapped.get(p))), 3);
// tips: every plane corner that is sharp and sits within reach of an outline tip meets it exactly
const interior = (poly, i) => { const n = poly.length, a = poly[(i + n - 1) % n], p = poly[i], b = poly[(i + 1) % n]; const u = [a[0]-p[0], a[1]-p[1]], v = [b[0]-p[0], b[1]-p[1]]; return Math.acos(Math.max(-1, Math.min(1, (u[0]*v[0]+u[1]*v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1)))); };
const silPoly = straighten(dedupe(t.silhouette.map(p => snapped.get(p))), 3);
const tips = silPoly.filter((p, i) => interior(silPoly, i) < Math.PI / 3.2);
const mergeTips = poly => poly.map((p, i) => { if (interior(poly, i) >= Math.PI / 3.2) return p; const tip = tips.find(t => Math.hypot(t[0] - p[0], t[1] - p[1]) < 45); return tip ? [tip[0], tip[1]] : p; });
const half = regions.map(r => dedupe(mergeTips(toPoly(r)))).filter(f => f.length >= 3);
writeFileSync(out, JSON.stringify({ source: 'ref/head-half.png', axis: AXIS, half }));
console.log(`traced ${half.length} right-half planes -> tools/mascot-facets.json, axis x=${AXIS}`);

// ------------------------------------------------------------------ side view
const side = await (async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  const img = 'data:image/png;base64,' + readFileSync(resolve(ROOT, 'ref/head-side.png')).toString('base64');
  await pg.setContent(`<canvas id=c></canvas><img id=i src="${img}">`);
  await pg.waitForFunction(() => document.getElementById('i').complete);
  const rows = await pg.evaluate(() => {
    const img = document.getElementById('i'), c = document.getElementById('c');
    const W = c.width = img.naturalWidth, H = c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, W, H).data, N = W * H;
    const lum = i => (px[i*4] + px[i*4+1] + px[i*4+2]) / 3;
    const bg = [0, W - 1, (H - 1) * W, N - 1].map(lum).reduce((a, v) => a + v, 0) / 4;
    const out = new Uint8Array(N), stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) { const i = stack.pop(); if (out[i] || Math.abs(lum(i) - bg) > 14) continue; out[i] = 1; const x = i % W, y = (i / W) | 0;
      if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W); }
    const rows = [];
    for (let y = 0; y < H; y++) { let l = -1, r = -1; for (let x = 0; x < W; x++) if (!out[y * W + x]) { if (l < 0) l = x; r = x; } if (l >= 0) rows.push([y, l, r]); }
    return rows;
  });
  await b.close();
  return rows;
})();
writeFileSync(resolve(ROOT, 'tools/side-profile.json'), JSON.stringify({ source: 'ref/head-side.png', rows: side }));
console.log(`traced ${side.length} side-view rows -> tools/side-profile.json`);
