#!/usr/bin/env node
// Builds the mascot's 3D head mesh and bakes it into index.html.
//
//   node tools/build-mascot.mjs   # rewrite the <!-- mesh:start/end --> block in index.html
//
// Inputs, both traced by tools/trace-ref.mjs:
//   tools/mascot-facets.json  front planes of the right half, from ref/head-half.png
//   tools/side-profile.json   outline rows of the side view, from ref/head-side.png
//
//  1. Clean the traced half into an exact planar mesh: corners the raster clipped short of
//     a spike tip are merged into that tip, and every vertex that sits on a neighbour's
//     edge (a T-junction) is inserted into that edge, so all planes meet corner to corner.
//  2. Mirror it into the full front, find the outline (edges used by one plane), and close
//     the head with a back shell that mirrors the front planes and shares every outline
//     vertex, plus three extra vertices on the back centre line that carry the side profile.
//  3. Give every vertex a depth: the centre line follows the side view exactly; the ear,
//     spikes, cheeks and outline use the DEPTH table, read off the same side view.
//  4. Check the result is one closed, consistently wound surface (every edge shared by
//     exactly two planes in opposite directions, Euler characteristic 2) and bake it.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'));
const TRACE = read('tools/mascot-facets.json');
const SIDE = read('tools/side-profile.json');
const AX = TRACE.axis;

// ------------------------------------------------------------------ side view calibration
// Measured on ref/head-side.png: the head top sits on row 240, the underside lines meet
// (behind the neck, which is ignored) at row 828, and the ear tip is at column 560. The
// front view spans y 217 (top) to 897.5 (chin), which fixes the scale; with it the side
// view's ear tip lands within 8 units of the front view's.
const SIDE_TOP = 240, SIDE_BOTTOM = 828, SIDE_Z0 = 560;
const FRONT_TOP = 217, FRONT_BOTTOM = 897.5;
const S = (FRONT_BOTTOM - FRONT_TOP) / (SIDE_BOTTOM - SIDE_TOP);
const rows = new Map(SIDE.rows.map(([y, l, r]) => [y, [l, r]]));
function sideAt(yf) {   // [back, front] depth of the side outline at front-view height yf
  const ys = SIDE_TOP + (yf - FRONT_TOP) / S, y0 = Math.floor(ys), t = ys - y0;
  const a = rows.get(y0), b = rows.get(y0 + 1) || a;
  return [0, 1].map(k => ((a[k] + (b[k] - a[k]) * t) - SIDE_Z0) * S);
}

// ------------------------------------------------------------------ depth table
// Right-half vertices by traced position. Outline vertices have one depth; the others a
// front depth and the depth of their twin on the back shell. Z is toward the viewer, in
// front-view pixels, 0 = the ear tip's depth in the side view.
const DEPTH = [
  // outline
  [902.5, 26, 0],          // ear tip
  [654.5, 248.5, 0],       // inner ear base on the roof line
  [865.5, 404, 60],        // where spike 1 meets the ear's outer edge
  [1013, 395.5, 70],       // spike 1 tip   (side view: upper spike seen end-on, centred ~Z 69)
  [903.5, 550.5, 50],      // notch between spikes 1 and 2
  [986.5, 601, 45],        // spike 2 tip   (side view: lower spike, centred ~Z 44)
  [893.5, 677, 40],        // notch between spikes 2 and 3
  [952.5, 789.5, 40],      // spike 3 / jaw corner tip
  [686, 855, 60],          // underside edge
  [507, 217, 40],          // top of the head (side view: top edge runs from Z -241 to +94)
  [507, 897.5, 50],        // chin, the lowest point (forward of the side view's 6, with the jaw)
  // interior: [x, y, front, back]
  [714, 286, 127, -154],   // ear base, inner front / back (side view: ear edges pass Z -113 and +94 at the head top)
  [810.5, 392, 60, -140],  // ear base, lower front / back
  [854.5, 503, 185, -70],  // spike 1 base, front / back
  [855, 612.5, 170, -70],  // spike 1-2 base
  [862.5, 626.5, 150, -60],// spike 2 base
  [855, 654, 160, -90],    // spike 3 base
  [706.5, 385.5, 230, -310], // forehead
  [784.5, 526.5, 210, -290], // brow corner
  [751, 678.5, 235, -310], // cheek
  [762, 698, 225, -300],   // cheek
  [685.5, 695.5, 270, -340], // lower face
  [781.5, 732, 200, -290], // jaw
  [720, 800.5, 195, -280], // jaw
  // centre line, where the side view is overridden: the nose/jaw is pushed forward of the
  // side view, level with the brow, so the lower face doesn't read as recessed
  [507, 752, 285, null],
];
// Extra vertices on the back centre line where the side view's back outline turns a corner:
// [front-view y, side-view column]. The back shell has no drawn diagram, so these are free.
const BACK_AXIS = [
  [235.5, 352],   // top-back corner
  [437, 218],     // upper back
  [680, 205],     // lower back, where the flat back of the skull ends
  [818.8, 262],   // bottom-back corner (no underside point below it: it made a keel under the chin)
];

// ------------------------------------------------------------------ 1. clean the half
const pts = [], pid = new Map();
const id = p => { const k = `${p[0]},${p[1]}`; if (!pid.has(k)) { pid.set(k, pts.length); pts.push([p[0], p[1]]); } return pid.get(k); };
let half = TRACE.half.map(poly => poly.map(id));

const TJ = 4;   // px: a vertex this close to a neighbour's edge belongs on it
const seg = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  return { t: ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, d: Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(l2) };
};
const dist = (a, b) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
const angleAt = (f, k) => {
  const n = f.length, p = pts[f[k]], a = pts[f[(k + n - 1) % n]], b = pts[f[(k + 1) % n]];
  const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))))) * 180 / Math.PI;
};
const clean = f => { const g = f.filter((v, i) => v !== f[(i + 1) % f.length]); return new Set(g).size === g.length ? g : [...new Set(g)]; };
const report = [];

// 1a. clipped tips: a sharp corner used by one plane only, lying on a neighbour's edge
//     within 50px of that edge's end, is the same tip the raster cut short
{
  const uses = new Map(); half.forEach(f => f.forEach(v => uses.set(v, (uses.get(v) || 0) + 1)));
  const remap = new Map();
  half.forEach(f => f.forEach((v, k) => {
    if (uses.get(v) !== 1 || angleAt(f, k) > 40) return;
    for (const g of half) for (let m = 0; m < g.length; m++) {
      const a = g[m], b = g[(m + 1) % g.length]; if (g === f || a === v || b === v) continue;
      const { t, d } = seg(pts[v], pts[a], pts[b]); if (d >= TJ || t <= 0 || t >= 1) continue;
      const end = t > 0.5 ? b : a; if (dist(v, end) < 50) remap.set(v, end);
    }
  }));
  for (const [v, to] of remap) report.push(`merged clipped tip (${pts[v]}) into (${pts[to]})`);
  half = half.map(f => clean(f.map(v => remap.get(v) ?? v))).filter(f => f.length >= 3);
}
// 1b. T-junctions: insert every vertex lying on another plane's edge into that edge
for (let pass = 0; pass < 6; pass++) {
  const used = new Set(half.flat()); let changed = false;
  half = half.map(f => {
    const out = [];
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length]; out.push(a);
      const mids = [];
      for (const v of used) { if (f.includes(v)) continue; const { t, d } = seg(pts[v], pts[a], pts[b]); if (d < TJ && t > 0.01 && t < 0.99) mids.push([t, v]); }
      mids.sort((x, y) => x[0] - y[0]).forEach(([, v]) => { out.push(v); changed = true; report.push(`inserted (${pts[v]}) into edge (${pts[a]})-(${pts[b]})`); });
    });
    return out;
  });
  if (!changed) break;
}
// 1c. wind every front plane the same way (clockwise on screen = facing the viewer)
const area2 = f => f.reduce((s, v, k) => { const p = pts[v], q = pts[f[(k + 1) % f.length]]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
half = half.map(f => area2(f) > 0 ? f : f.slice().reverse());

// ------------------------------------------------------------------ 2. mirror + back shell
const mirrorId = v => pts[v][0] === AX ? v : id([2 * AX - pts[v][0], pts[v][1]]);
const front = [...half, ...half.map(f => f.map(mirrorId).reverse())];
const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const count = new Map(); front.forEach(f => f.forEach((a, k) => { const e = edgeKey(a, f[(k + 1) % f.length]); count.set(e, (count.get(e) || 0) + 1); }));
const outline = new Set();
for (const [e, n] of count) if (n === 1) e.split('|').forEach(v => outline.add(+v));

// 3D vertex list: front vertices keep their id; back twins are appended
const V3 = pts.map(p => [p[0], p[1], null]);
const twin = new Map();
const backId = v => { if (outline.has(v)) return v; if (!twin.has(v)) { twin.set(v, V3.length); V3.push([pts[v][0], pts[v][1], null]); } return twin.get(v); };
const back = front.map(f => f.map(backId).reverse());
let faces = [...front, ...back];

// extra back centre-line vertices, spliced into the edge they sit on
function splitEdge(a, b, list) {
  faces = faces.map(f => {
    const out = [];
    f.forEach((v, k) => { const w = f[(k + 1) % f.length]; out.push(v); if (v === a && w === b) out.push(...list); else if (v === b && w === a) out.push(...list.slice().reverse()); });
    return out;
  });
}
const axisFront = pts.map((p, v) => v).filter(v => pts[v][0] === AX && faces.some(f => f.includes(v)));
const axisOrder = axisFront.slice().sort((a, b) => pts[a][1] - pts[b][1]);
const top = axisOrder[0], chin = axisOrder.at(-1);
const chain = [top, ...axisOrder.filter(v => !outline.has(v)).map(backId), chin];   // back centre line, top to chin
for (const [y, col] of BACK_AXIS) {
  const k = chain.findIndex((v, i) => i < chain.length - 1 && V3[v][1] < y && y < V3[chain[i + 1]][1]);
  if (k < 0) throw new Error(`no back centre-line edge spans y=${y}`);
  V3.push([AX, y, (col - SIDE_Z0) * S]);
  splitEdge(chain[k], chain[k + 1], [V3.length - 1]);
  chain.splice(k + 1, 0, V3.length - 1);
}

// ------------------------------------------------------------------ 3. depth
const lookup = (x, y) => {
  const mx = x < AX ? 2 * AX - x : x;
  let best = null, bd = 14;
  for (const e of DEPTH) { const d = Math.hypot(e[0] - mx, e[1] - y); if (d < bd) { bd = d; best = e; } }
  return best;
};
const missing = [];
pts.forEach(([x, y], v) => {
  if (!faces.some(f => f.includes(v))) return;
  const e = lookup(x, y);
  if (outline.has(v)) { if (e && e.length === 3) V3[v][2] = e[2]; else missing.push(`outline (${x},${y})`); return; }
  let zf, zb;
  if (x === AX) { [zb, zf] = sideAt(y); if (e && e.length === 4) { zf = e[2] ?? zf; zb = e[3] ?? zb; } }
  else if (e && e.length === 4) [, , zf, zb] = e;
  else { missing.push(`interior (${x},${y})`); return; }
  V3[v][2] = zf; V3[twin.get(v)][2] = zb;
});
if (missing.length) throw new Error('no depth for: ' + missing.join(', '));
// Stretch the head past the side reference: everything in front of the ear/spike plane
// (Z = 0) grows by FRONT_GROW, everything behind it by BACK_GROW. Scaling depth only
// keeps the front outline and every shared corner exactly where they were.
const FRONT_GROW = Number(process.env.FRONT_GROW ?? 1.3), BACK_GROW = Number(process.env.BACK_GROW ?? 1.0);
for (const v of V3) if (v[2] !== null) v[2] *= v[2] > 0 ? FRONT_GROW : BACK_GROW;

// ------------------------------------------------------------------ eyes
// Neutral face: the large open eyes from the four-expression sheet. Each is a flat oval ring
// with an oval pupil hole. Its plane is fitted (least squares) to the head's front surface
// under the eye and lifted just enough that no part of the surface pokes through, so the eye
// sits as a flat layer right in front of the face: it turns with the head but never wraps
// over the facets. Sizes are in front-view pixels, measured off the sheet relative to the head.
const EYE = { dx: 190, y: 615, rx: 100, ry: 110, pupilRx: 57, pupilRy: 74, pupilIn: 10, clear: 6, steps: 40 };    // clear: gap between the eye and the highest point of the face under it
const eyeData = [];
{
  // front surface depth at a front-view point: interpolate inside the front plane that covers it
  const frontZ = (x, y) => {
    for (const f of front) for (let k = 1; k < f.length - 1; k++) {
      const [a, b, c] = [f[0], f[k], f[k + 1]].map(v => V3[v]);
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * a[2] + l2 * b[2] + l3 * c[2];
    }
    return null;
  };
  {
    const side = 1, cx = AX + EYE.dx;   // fit the right eye; the left is its mirror image
    const ellipse = (ox, rx, ry, scale = 1) => Array.from({ length: EYE.steps }, (_, k) => { const t = 2 * Math.PI * k / EYE.steps; return [cx + side * ox + scale * rx * Math.cos(t), EYE.y + scale * ry * Math.sin(t)]; });
    // sample the surface under the eye and fit z = a x + b y + c
    const samples = [[cx, EYE.y], ...ellipse(0, EYE.rx, EYE.ry), ...ellipse(0, EYE.rx, EYE.ry, 0.6)].map(([x, y]) => [x, y, frontZ(x, y)]).filter(p => p[2] !== null);
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
    for (const [x, y, z] of samples) { const q = [x - cx, y - EYE.y, 1]; for (let i = 0; i < 3; i++) { r[i] += q[i] * z; for (let j = 0; j < 3; j++) m[i][j] += q[i] * q[j]; } }
    const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(m), sol = [0, 1, 2].map(i => det(m.map((row, ri) => row.map((v, ci) => ci === i ? r[ri] : v))) / D);
    const plane = (x, y) => sol[0] * (x - cx) + sol[1] * (y - EYE.y) + sol[2];
    const lift = Math.max(...samples.map(([x, y, z]) => z - plane(x, y))) + EYE.clear;
    const to3 = ([x, y]) => [x, y, plane(x, y) + lift];
    const nl = Math.hypot(sol[0], sol[1], 1);
    eyeData.push({
      outer: ellipse(0, EYE.rx, EYE.ry).map(to3),
      inner: ellipse(-EYE.pupilIn, EYE.pupilRx, EYE.pupilRy).map(to3),
      c: to3([cx, EYE.y]),
      n: [-sol[0] / nl, -sol[1] / nl, 1 / nl],   // plane normal toward the viewer
    });
    report.push(`eyes: plane tilt ${(Math.atan(Math.hypot(sol[0], sol[1])) * 180 / Math.PI).toFixed(0)} deg, lifted ${lift.toFixed(1)} to clear the surface`);
  }
  const mirror = p => [2 * AX - p[0], p[1], p[2]];
  const R = eyeData[0];
  eyeData.push({ outer: R.outer.map(mirror).reverse(), inner: R.inner.map(mirror).reverse(), c: mirror(R.c), n: [-R.n[0], R.n[1], R.n[2]] });
}

// ------------------------------------------------------------------ triangulate for drawing
// Planes with more than three corners are rarely flat once they have depth, and drawn as one
// polygon they can fold over themselves when the head turns (three corners on one line
// become a zero-width spike). Each is split into triangles by ear clipping in its own best-fit
// plane; the triangles keep their plane's index so the page shades them as one plane.
const planeOf = [];
{
  const P3 = v => V3[v];
  const out = [];
  faces.forEach((f, gi) => {
    if (f.length === 3) { out.push(f); planeOf.push(gi); return; }
    let nx = 0, ny = 0, nz = 0;
    f.forEach((a, k) => { const p = P3(a), q = P3(f[(k + 1) % f.length]); nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); });
    // 2D basis in the plane
    const n = [nx, ny, nz], l = Math.hypot(...n); n.forEach((c, i) => n[i] = c / l);
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]];
    const ul = Math.hypot(...u); u.forEach((c, i) => u[i] = c / ul);
    const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const to2 = v => { const p = P3(v); return [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * w[0] + p[1] * w[1] + p[2] * w[2]]; };
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let ring = f.slice();
    const sign = Math.sign(ring.reduce((acc, v, k) => { const a = to2(v), b = to2(ring[(k + 1) % ring.length]); return acc + a[0] * b[1] - b[0] * a[1]; }, 0)) || 1;
    while (ring.length > 3) {
      let best = -1, bestQ = -Infinity;
      for (let k = 0; k < ring.length; k++) {
        const a = to2(ring[(k + ring.length - 1) % ring.length]), b = to2(ring[k]), c = to2(ring[(k + 1) % ring.length]);
        const ar = cross(a, b, c) * sign; if (ar <= 1e-6) continue;
        // never cut along the centre line: the planes either side would both claim that diagonal
        if (V3[ring[(k + ring.length - 1) % ring.length]][0] === AX && V3[ring[(k + 1) % ring.length]][0] === AX) continue;
        const inside = ring.some((v, m) => { if (m === k || m === (k + 1) % ring.length || m === (k + ring.length - 1) % ring.length) return false; const p = to2(v); return cross(a, b, p) * sign > 0 && cross(b, c, p) * sign > 0 && cross(c, a, p) * sign > 0; });
        if (inside) continue;
        const e = [Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1])];
        const q = ar / (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);   // prefer fat ears
        if (q > bestQ) { bestQ = q; best = k; }
      }
      if (best < 0) throw new Error(`could not triangulate plane ${gi}`);
      const k = best; out.push([ring[(k + ring.length - 1) % ring.length], ring[k], ring[(k + 1) % ring.length]]); planeOf.push(gi);
      ring.splice(k, 1);
    }
    out.push(ring); planeOf.push(gi);
  });
  report.push(`triangulated ${faces.length} planes into ${out.length} triangles`);
  faces = out;
}

// ------------------------------------------------------------------ 4. validate
{
  const used = new Set(faces.flat());
  const dir = new Map();
  for (const f of faces) f.forEach((a, k) => { const b = f[(k + 1) % f.length]; const e = `${a}>${b}`; if (dir.has(e)) throw new Error(`edge ${e} used twice in the same direction: ` + faces.map((g, gi) => [g, gi]).filter(([g]) => g.some((x, j) => `${x}>${g[(j + 1) % g.length]}` === e)).map(([g, gi]) => `#${gi} plane ${planeOf[gi]} [${g}] ` + g.map(x => '(' + V3[x].map(n => Math.round(n)) + ')').join(' ')).join(' | ')); dir.set(e, 1); });
  for (const e of dir.keys()) { const [a, b] = e.split('>'); if (!dir.has(`${b}>${a}`)) throw new Error(`open edge ${a}-${b}: (${V3[a]}) to (${V3[b]})`); }
  const E = dir.size / 2, F = faces.length, Vn = used.size;
  if (Vn - E + F !== 2) throw new Error(`Euler characteristic ${Vn - E + F}, expected 2`);
  const adj = new Map(); for (const e of dir.keys()) { const [a, b] = e.split('>').map(Number); (adj.get(a) || adj.set(a, []).get(a)).push(b); }
  const seen = new Set([faces[0][0]]), stack = [faces[0][0]];
  while (stack.length) for (const n of adj.get(stack.pop()) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  if (seen.size !== Vn) throw new Error(`mesh has more than one piece (${seen.size} of ${Vn} vertices connected)`);
  report.push(`closed surface: ${Vn} vertices, ${E} edges, ${F} triangles, one piece`);
}

// ------------------------------------------------------------------ output
// Re-index to used vertices; centre x on the axis, y on the traced image's midline (so the
// page's viewBox stays put) and z on the middle of the head's depth.
const used = [...new Set(faces.flat())].sort((a, b) => a - b);
const newId = new Map(used.map((v, i) => [v, i]));
const zs = used.map(v => V3[v][2]), CZ = (Math.min(...zs) + Math.max(...zs)) / 2, CY = 462;
const r1 = n => Math.round(n * 10) / 10;
const mesh = {
  v: used.map(v => [r1(V3[v][0] - AX), r1(V3[v][1] - CY), r1(V3[v][2] - CZ)]),
  f: faces.map(f => f.map(v => newId.get(v))),
  g: planeOf,   // the drawn plane each triangle belongs to (shaded as one)
  eyes: eyeData.map(e => ({
    outer: e.outer.map(p => [r1(p[0] - AX), r1(p[1] - CY), r1(p[2] - CZ)]),
    inner: e.inner.map(p => [r1(p[0] - AX), r1(p[1] - CY), r1(p[2] - CZ)]),
    c: [r1(e.c[0] - AX), r1(e.c[1] - CY), r1(e.c[2] - CZ)],
    n: e.n.map(v => Math.round(v * 1000) / 1000),   // facing direction, for hiding the eye as the head turns away
  })),
  pivot: [0, r1((FRONT_TOP + FRONT_BOTTOM) / 2 - CY), 0],   // turn about the middle of the head, not the ear tips
  origin: [AX, CY, r1(CZ)],                                // where (0,0,0) sits in traced front-view coordinates
};
const indexPath = resolve(ROOT, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const START = '<!-- mesh:start -->', END = '<!-- mesh:end -->';
const s = html.indexOf(START), e = html.indexOf(END);
if (s < 0 || e < 0) throw new Error('index.html is missing the <!-- mesh:start --> / <!-- mesh:end --> markers');
writeFileSync(indexPath, html.slice(0, s + START.length) + `\n<script id="mascot-mesh" type="application/json">${JSON.stringify(mesh)}</script>\n` + html.slice(e));
if (process.argv.includes('--verbose')) report.forEach(l => console.log('  ' + l));
console.log(`baked ${mesh.v.length} vertices, ${new Set(planeOf).size} planes (${mesh.f.length} triangles) into index.html (${report.at(-1)})`);
