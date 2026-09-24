#!/usr/bin/env node
// Traces the flat-shaded front-view reference (ref/head-front.png) into facet polygons.
//
//   node tools/trace-ref.mjs        # writes tools/mascot-facets.json (needs the playwright package + Chromium)
//
// Facets are found by edge-based segmentation (plane interiors are smooth, plane
// boundaries are steps), each region's boundary is walked and simplified, shared
// vertices are snapped together and mirrored across the head's centre axis, and
// the grey placeholder eye sockets are inpainted away (their centres are exported
// so the page can place the white eyes).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(ROOT, 'ref/head-front.png'), out = resolve(ROOT, 'tools/mascot-facets.json');
const edgeT = 7, minSize = 80, SNAP = 7, AXIS = 511, MIRROR_TOL = 14;
const data = 'data:image/png;base64,' + readFileSync(src).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<canvas id=c></canvas><img id=i src="${data}">`);
await page.waitForFunction(() => document.getElementById('i').complete);
const result = await page.evaluate(([edgeT, minSize, AXIS]) => {
  const img = document.getElementById('i'), c = document.getElementById('c');
  const W = c.width = img.naturalWidth, H = c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data, N = W * H;
  const isBg = i => px[i*4] > 150 && px[i*4+2] > 150 && px[i*4+1] < 120;
  const lum = new Float32Array(N); for (let i = 0; i < N; i++) lum[i] = isBg(i) ? -1 : (px[i*4] + px[i*4+1] + px[i*4+2]) / 3;
  // The render's light grey eye sockets are placeholders: find them (light blobs in the face band),
  // remember their centres for eye placement, then inpaint them from the nearest surrounding pixel
  // so the face planes run straight through and nothing sits behind the white eyes.
  const seen = new Uint8Array(N); const sockets = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || lum[s] < 90) continue; const stack = [s]; seen[s] = 1; const pts = [];
    while (stack.length) { const i = stack.pop(); pts.push(i); const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x+dx, ny = y+dy; if (nx<0||ny<0||nx>=W||ny>=H) continue; const j = ny*W+nx; if (seen[j] || lum[j] < 90 || Math.abs(lum[j] - lum[i]) > 12) continue; seen[j] = 1; stack.push(j); } }
    const cx = pts.reduce((a, i) => a + (i % W), 0) / pts.length, cy = pts.reduce((a, i) => a + ((i / W) | 0), 0) / pts.length;
    if (pts.length > 15000 && cy > 540 && cy < 760 && Math.abs(cx - AXIS) < 240) sockets.push({ cx: Math.round(cx), cy: Math.round(cy), pts });
  }
  const isSocket = new Uint8Array(N); for (const s of sockets) for (const i of s.pts) isSocket[i] = 1;
  const grow = 4; // also eat the anti-aliased rim around each socket
  for (const s of sockets) for (const i of s.pts) { const x = i % W, y = (i / W) | 0; for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) { const j = (y+dy)*W + (x+dx); if (j >= 0 && j < N && lum[j] >= 0) isSocket[j] = 1; } }
  const dirs16 = Array.from({ length: 16 }, (_, k) => [Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);
  const filled = new Float32Array(lum);
  for (let i = 0; i < N; i++) { if (!isSocket[i]) continue; const x = i % W, y = (i / W) | 0; let best = Infinity, val = lum[i];
    for (const [dx, dy] of dirs16) for (let t = 1; t < best && t < 400; t++) { const nx = Math.round(x + dx * t), ny = Math.round(y + dy * t); if (nx<0||ny<0||nx>=W||ny>=H) break; const j = ny*W+nx; if (!isSocket[j] && lum[j] >= 0) { if (t < best) { best = t; val = lum[j]; } break; } }
    filled[i] = val; }
  lum.set(filled);
  // edge mask: max abs difference to any 4-neighbour (incl. bg boundary)
  const edge = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (lum[i] < 0) continue;
    let m = 0; for (const j of [i-1, i+1, i-W, i+W]) { const v = lum[j] < 0 ? 999 : Math.abs(lum[j] - lum[i]); if (v > m) m = v; }
    if (m > edgeT) edge[i] = 1;
  }
  const label = new Int32Array(N).fill(-1); const regions = [];
  for (let s = 0; s < N; s++) {
    if (label[s] >= 0 || lum[s] < 0 || edge[s]) continue;
    const stack = [s]; label[s] = regions.length; const pts = []; let sum = 0;
    while (stack.length) { const i = stack.pop(); pts.push(i); sum += lum[i]; const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x+dx, ny = y+dy; if (nx<0||ny<0||nx>=W||ny>=H) continue; const j = ny*W+nx; if (label[j]>=0||lum[j]<0||edge[j]) continue; label[j] = regions.length; stack.push(j); } }
    regions.push({ id: regions.length, size: pts.length, grey: Math.round(sum / pts.length), pts });
  }
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
  const outR = regions.filter(r => r.size >= minSize).map(r => { const cy = r.pts.reduce((a, i) => a + ((i / W) | 0), 0) / r.size, cx = r.pts.reduce((a, i) => a + (i % W), 0) / r.size; return { id: r.id, size: r.size, grey: r.grey, cx: Math.round(cx), cy: Math.round(cy), poly: simplify(contour(r), 3) }; });
  const sil = { pts: [] }; for (let i = 0; i < N; i++) if (lum[i] >= 0) sil.pts.push(i);
  return { W, H, regions: outR, silhouette: simplify(contour(sil), 2.5), sockets: sockets.map(s => ({ cx: s.cx, cy: s.cy })) };
}, [Number(edgeT), Number(minSize), AXIS]);
await browser.close();
const t = result;
const regions = t.regions;
// snap shared vertices: greedy clustering (no chaining)
const all = []; regions.forEach(r => r.poly.forEach(p => all.push(p))); t.silhouette.forEach(p => all.push(p));
const clusters = []; const snapped = new Map();
for (const p of all) { let c = clusters.find(c => Math.hypot(c.x - p[0], c.y - p[1]) <= SNAP); if (!c) { c = { x: p[0], y: p[1], n: 0, pts: [] }; clusters.push(c); } c.pts.push(p); c.x = (c.x * c.n + p[0]) / (c.n + 1); c.y = (c.y * c.n + p[1]) / (c.n + 1); c.n++; }
// left/right symmetry: pair each cluster with its mirror across the axis and average
for (const c of clusters) { if (c.sym) continue; const mx = 2 * AXIS - c.x; const m = clusters.find(o => o !== c && !o.sym && Math.hypot(o.x - mx, o.y - c.y) <= MIRROR_TOL);
  if (m) { const off = (Math.abs(c.x - AXIS) + Math.abs(m.x - AXIS)) / 2, y = (c.y + m.y) / 2; c.x = c.x < AXIS ? AXIS - off : AXIS + off; m.x = m.x < AXIS ? AXIS - off : AXIS + off; c.y = m.y = y; c.sym = m.sym = true; }
  else if (Math.abs(c.x - AXIS) <= 10) { c.x = AXIS; c.sym = true; } }
for (const c of clusters) for (const p of c.pts) snapped.set(p, [Math.round(c.x), Math.round(c.y)]);
const dedupe = poly => poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return p[0] !== q[0] || p[1] !== q[1]; });
// final clean-up: drop vertices that barely deviate from the line between their neighbours (stair-steps on anti-aliased edges)
const straighten = (poly, eps) => { let out = poly; for (let pass = 0; pass < 3; pass++) { const keep = out.filter((p, i) => { const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length]; const dx = b[0]-a[0], dy = b[1]-a[1]; const l = Math.hypot(dx, dy) || 1; return Math.abs((p[0]-a[0]) * dy - (p[1]-a[1]) * dx) / l > eps; }); if (keep.length === out.length || keep.length < 3) break; out = keep; } return out; };
const toPoly = r => straighten(dedupe(r.poly.map(p => snapped.get(p))), 4.5);
const facets = regions.map(r => ({ grey: r.grey, poly: toPoly(r) })).filter(f => f.poly.length >= 3);
const sockets = t.sockets;
const silhouette = straighten(dedupe(t.silhouette.map(p => snapped.get(p))), 4.5);
writeFileSync(out, JSON.stringify({ source: 'ref/head-front.png', size: [t.W, t.H], axis: AXIS, silhouette, facets, sockets }));
console.log(`traced ${facets.length} facets, ${sockets.length} sockets -> tools/mascot-facets.json`);
