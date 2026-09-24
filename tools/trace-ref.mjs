#!/usr/bin/env node
// Traces the half-face diagram (ref/head-half.png: blue planes, green edges, magenta
// background, straight centre line on the left) into facet polygons and mirrors it.
//
//   node tools/trace-ref.mjs        # writes tools/mascot-facets.json (needs the playwright package + Chromium)
//
// Every blue region is walked into a polygon, shared vertices are snapped together,
// vertices on the centre line are locked to the axis, and the half is reflected to
// make the full symmetrical head. Eye centres come from the flat render in
// ref/head-front.png (same scale) and are kept as constants below.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(ROOT, 'ref/head-half.png'), out = resolve(ROOT, 'tools/mascot-facets.json');
const minSize = 60, SNAP = 7;
const EYE_DX = 184, EYE_Y = 655;   // socket centres measured on ref/head-front.png, relative to the centre line
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
// snap shared vertices: greedy clustering (no chaining); vertices on the centre line lock to the axis
const all = []; regions.forEach(r => r.poly.forEach(p => all.push(p))); t.silhouette.forEach(p => all.push(p));
const clusters = []; const snapped = new Map();
for (const p of all) { let c = clusters.find(c => Math.hypot(c.x - p[0], c.y - p[1]) <= SNAP); if (!c) { c = { x: p[0], y: p[1], n: 0, pts: [] }; clusters.push(c); } c.pts.push(p); c.x = (c.x * c.n + p[0]) / (c.n + 1); c.y = (c.y * c.n + p[1]) / (c.n + 1); c.n++; }
for (const c of clusters) { if (Math.abs(c.x - AXIS) <= 8) c.x = AXIS; for (const p of c.pts) snapped.set(p, [Math.round(c.x), Math.round(c.y)]); }
const dedupe = poly => poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return p[0] !== q[0] || p[1] !== q[1]; });
// final clean-up: drop vertices that barely deviate from the line between their neighbours
const straighten = (poly, eps) => { let out = poly; for (let pass = 0; pass < 3; pass++) { const keep = out.filter((p, i) => { const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length]; const dx = b[0]-a[0], dy = b[1]-a[1]; const l = Math.hypot(dx, dy) || 1; return Math.abs((p[0]-a[0]) * dy - (p[1]-a[1]) * dx) / l > eps; }); if (keep.length === out.length || keep.length < 3) break; out = keep; } return out; };
const toPoly = r => straighten(dedupe(r.poly.map(p => snapped.get(p))), 3);
const mirror = poly => poly.map(p => [2 * AXIS - p[0], p[1]]).reverse();
const half = regions.map(r => ({ poly: toPoly(r) })).filter(f => f.poly.length >= 3);
const facets = [...half, ...half.map(f => ({ poly: mirror(f.poly) }))];
// full outline: the half outline is walked clockwise from its top centre point, so the
// right-hand run goes top -> bottom; append its mirror bottom -> top.
const halfSil = straighten(dedupe(t.silhouette.map(p => snapped.get(p))), 3);
const onAxis = halfSil.filter(p => p[0] === AXIS), right = halfSil.filter(p => p[0] > AXIS);
const top = onAxis.reduce((a, p) => p[1] < a[1] ? p : a), bottom = onAxis.reduce((a, p) => p[1] > a[1] ? p : a);
const silhouette = [top, ...right, bottom, ...right.map(p => [2 * AXIS - p[0], p[1]]).reverse()];
const sockets = [{ cx: AXIS - EYE_DX, cy: EYE_Y }, { cx: AXIS + EYE_DX, cy: EYE_Y }];
writeFileSync(out, JSON.stringify({ source: 'ref/head-half.png', size: [t.W, t.H], axis: AXIS, silhouette, facets, sockets }));
console.log(`traced ${half.length} half-face planes (${facets.length} mirrored) -> tools/mascot-facets.json, axis x=${AXIS}`);
