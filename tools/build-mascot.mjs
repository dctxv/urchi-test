#!/usr/bin/env node
// Bakes the low-poly mascot head into index.html as a static inline SVG.
//
//   node tools/build-mascot.mjs            # rewrite the <!-- mascot:start/end --> block in index.html
//   node tools/build-mascot.mjs --preview  # also write tools/preview.html (four-up + wireframe with vertex names)
//   node tools/build-mascot.mjs --debug    # print every facet's normal, light intensity and colour
//
// The head is a hand-placed 2.5D mesh: every vertex has a screen position (x, y)
// in a 400x400 design space (the viewBox is cropped to the mascot) plus a depth z
// (units toward the viewer). Facets are flat-shaded from their 3D normal, then
// snapped to the muted palette, so the front view reads as a chunky faceted solid
// without any gradients. The eyes are parametric paths, one <g> per expression,
// drawn as a flat layer above the facets.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = process.argv.includes('--preview');

// ------------------------------------------------------------------ palette
const C = {
  black:    '#0B0B0E',
  near:     '#111116',
  charcoal: '#18181D',
  slate:    '#293039',
  bluegrey: '#39404C',
  purple:   '#2C263E',
  moss:     '#303A2A',
  burgundy: '#442C35',
  white:    '#F2F0E9',
};

// ------------------------------------------------------------------ helpers
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(11);
const hex = c => c.match(/[0-9a-f]{2}/gi).map(h => parseInt(h, 16));
const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const norm = ([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const f1 = n => (Math.round(n * 10) / 10).toString();

// ------------------------------------------------------------------ vertices
// [x, y, z] — x right, y down (SVG), z toward the viewer. Silhouette points sit
// near z=0, the flat face table near z=90; that depth difference is what tilts
// the forehead and cheek planes away from the viewer.
const V = {
  // ears: wide bases, near-vertical outer edges, tips just outside the head sides
  // (the right ear sits a hair higher and the roof peak is a touch off-centre: hand-built asymmetry)
  TL: [79, 56, 8],   A: [165, 130, 40],  P: [205, 121, 44],  B: [262, 132, 40],  TR: [323, 52, 8],
  EL: [121, 141, 60], ER: [283, 142, 62],
  ELi: [120, 94, 26], ERi: [294, 92, 26],   // midpoints of the ears' inner edges
  // head silhouette, top-left going clockwise (spikes are separate)
  L1: [76, 176, 10],  L2: [77, 236, 4],   L3: [92, 292, 4],   L4: [124, 329, 8],
  CB: [205, 336, 12],
  R4: [282, 327, 8],  R3: [310, 290, 4],  R2: [323, 234, 4],  R1: [325, 175, 10],
  // mid forehead
  M1: [103, 190, 54], M2: [150, 172, 70], M3: [203, 164, 76], M4: [258, 172, 68], M5: [301, 190, 54],
  // brow / cheek line
  // (each face half is coplanar: z = 93 - 0.2*|x-200| - 0.02*(y-219), so the eyes sit on one clean plane per side)
  W1: [99, 240, 60],  W2: [120, 223, 77], W3: [161, 227, 85], W4: [200, 219, 93], W5: [239, 226, 85], W6: [281, 223, 77], W7: [302, 241, 60],
  // face table bottom
  F1: [107, 289, 73], F2: [201, 299, 91], F3: [294, 288, 73],
};

// ------------------------------------------------------------------ facets
// Each entry: [a, b, c, region, tint?]. region: 'cap' (may take a tinted plane), 'dim' (cap, but in the
// shadow side of the head), 'skin' (greys only). tint pins the plane's colour instead of the seeded pick.
const T = [
  // ears
  ['TL', 'L1', 'EL', 'dim'], ['TL', 'EL', 'ELi', 'dim', C.slate], ['ELi', 'EL', 'A', 'dim', C.purple],
  ['TR', 'ERi', 'ER', 'cap', C.purple], ['ERi', 'B', 'ER', 'cap', C.moss], ['TR', 'ER', 'R1', 'cap', C.slate],
  // roof -> mid forehead
  ['EL', 'M1', 'M2', 'dim'], ['EL', 'M2', 'A', 'dim', C.slate], ['A', 'M2', 'M3', 'dim', C.slate], ['A', 'M3', 'P', 'cap', C.purple],
  ['P', 'M3', 'M4', 'cap', C.slate], ['P', 'M4', 'B', 'cap', C.bluegrey], ['B', 'M4', 'M5', 'cap', C.purple], ['B', 'M5', 'ER', 'cap'],
  // mid forehead -> brow
  ['M1', 'W1', 'W2', 'dim'], ['M1', 'W2', 'M2', 'dim', C.slate], ['M2', 'W2', 'W3', 'dim'], ['M2', 'W3', 'M3', 'dim', C.moss],
  ['M3', 'W3', 'W4', 'cap', C.moss], ['M3', 'W4', 'W5', 'cap', C.burgundy], ['M3', 'W5', 'M4', 'cap', C.burgundy], ['M4', 'W5', 'W6', 'cap', C.moss],
  ['M4', 'W6', 'M5', 'cap', C.purple], ['M5', 'W6', 'W7', 'cap', C.slate],
  // temples (ear base down the side)
  ['EL', 'L1', 'M1', 'dim'], ['M1', 'L1', 'W1', 'dim'], ['W1', 'L1', 'L2', 'skin'],
  ['ER', 'M5', 'R1', 'cap', C.bluegrey], ['M5', 'W7', 'R1', 'cap', C.slate], ['W7', 'R2', 'R1', 'skin'],
  // face table: two big planes meeting on a faint centre ridge
  ['W2', 'W3', 'F1', 'skin'], ['W3', 'W4', 'F1', 'skin'], ['W4', 'F2', 'F1', 'skin'],
  ['W6', 'W5', 'F3', 'skin'], ['W5', 'W4', 'F3', 'skin'], ['W4', 'F3', 'F2', 'skin'],
  // cheeks
  ['W1', 'W2', 'F1', 'skin'], ['W1', 'F1', 'L3', 'skin'], ['W1', 'L3', 'L2', 'skin'],
  ['W7', 'F3', 'W6', 'skin'], ['W7', 'R3', 'F3', 'skin'], ['W7', 'R2', 'R3', 'skin'],
  // jaw
  ['F1', 'L4', 'L3', 'skin'], ['F1', 'F2', 'L4', 'skin'], ['F2', 'CB', 'L4', 'skin'],
  ['F2', 'R4', 'CB', 'skin'], ['F2', 'F3', 'R4', 'skin'], ['F3', 'R3', 'R4', 'skin'],
];

// Side spikes: base centre on the silhouette, direction outward, length, base half-width.
// Drawn behind the head so their bases tuck under the body.
const SPIKES = [
  // left
  { base: [80, 172], dir: [-0.86, -0.51], len: 32, half: 15 },
  { base: [81, 214], dir: [-0.99, -0.14], len: 36, half: 17 },
  { base: [84, 250], dir: [-0.90, 0.43], len: 29, half: 15 },
  { base: [104, 305], dir: [-0.66, 0.75], len: 20, half: 11 },
  // right (slightly different angles and lengths)
  { base: [320, 174], dir: [0.82, -0.57], len: 34, half: 15 },
  { base: [319, 218], dir: [0.99, -0.10], len: 34, half: 17 },
  { base: [316, 254], dir: [0.88, 0.47], len: 30, half: 15 },
  { base: [296, 303], dir: [0.62, 0.78], len: 18, half: 11 },
];

// ------------------------------------------------------------------ shading
const KEY = norm([0.62, 0.78, 0.34]);    // key light from the upper right, front
const FILL = norm([-0.55, 0.35, 0.55]);  // faint fill from the upper left; nothing from below keeps the jaw black

function intensity(n) {
  return 0.10 + 0.72 * Math.max(0, dot(n, KEY)) + 0.26 * Math.max(0, dot(n, FILL));
}

// Tinted planes cluster on the lit side, like the hand-painted facets of the reference.
function pickTint(cx) {
  const r = rng();
  if (cx > 200) {
    if (r < 0.28) return C.burgundy;
    if (r < 0.52) return C.moss;
    if (r < 0.74) return C.purple;
    if (r < 0.90) return C.slate;
    return C.bluegrey;
  }
  if (r < 0.45) return C.slate;
  if (r < 0.65) return C.purple;
  if (r < 0.80) return C.moss;
  if (r < 0.90) return C.bluegrey;
  return C.charcoal;
}

function shade(i, region, cx, pinned) {
  if (region === 'skin') {
    if (i < 0.45) return C.black;
    if (i < 0.58) return C.near;
    return C.charcoal;
  }
  if (region === 'dim') i *= 0.68;
  if (i < 0.30) return C.black;
  if (i < 0.42) return C.near;
  const tint = pinned || pickTint(cx);
  if (i < 0.56) return mix(C.near, tint, 0.55);
  if (i < 0.72) return tint;
  return mix(tint, C.bluegrey, 0.35);
}

const DEBUG = process.argv.includes('--debug');
function facet(a, b, c, region, name = '', pinned) {
  const p = [a, b, c].map(v => [v[0], -v[1], v[2]]);
  let n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
  if (n[2] < 0) n = n.map(v => -v);
  const cx = (a[0] + b[0] + c[0]) / 3;
  const i = intensity(n);
  const fill = shade(i, region, cx, pinned);
  if (DEBUG) console.log(name.padEnd(12), region.padEnd(5), 'n=' + n.map(v => v.toFixed(2)).join(','), 'I=' + i.toFixed(2), fill);
  const pts = [a, b, c].map(v => `${f1(v[0])},${f1(v[1])}`).join(' ');
  return { fill, pts };
}

const poly = ({ fill, pts }) => `<polygon points="${pts}" fill="${fill}" stroke="${fill}"/>`;

// ------------------------------------------------------------------ build
const head = T.map(([a, b, c, region, tint]) => poly(facet(V[a], V[b], V[c], region, `${a}-${b}-${c}`, tint)));

const spikes = SPIKES.map(({ base, dir, len, half }) => {
  const d = norm([dir[0], dir[1], 0]);
  const t = [-d[1], d[0]];                        // tangent along the base
  const tip = [base[0] + d[0] * len, base[1] + d[1] * len, 18];
  const bA = [base[0] + t[0] * half - d[0] * 12, base[1] + t[1] * half - d[1] * 12, 14];
  const bB = [base[0] - t[0] * half - d[0] * 12, base[1] - t[1] * half - d[1] * 12, 14];
  const mid = [base[0] - d[0] * 14, base[1] - d[1] * 14, 46];
  const region = base[0] < 200 ? 'dim' : 'cap';
  return [poly(facet(tip, bA, mid, region, 'spike', C.slate)), poly(facet(tip, mid, bB, region, 'spike', C.slate))].join('');
});

// ------------------------------------------------------------------ eyes
const EYE = { lx: 143, rx: 257, cy: 255, r: 34 };   // stroke adds ~1.5 all round

// neutral / half-open: a disc clipped by an upper lid, with the pupil notched into the lid line.
// lidOuter/lidInner: lid height at the outer/inner corner in radii above the centre (negative = below).
// arch: bulge of the lid's centre above the corner line, in radii (a gentle ∩).
function lidEye(cx, side, { lidOuter, lidInner, arch, pupilR, pupilIn, pupilDrop }) {
  const { cy, r } = EYE;
  const yo = cy - r * lidOuter, yi = cy - r * lidInner;
  const cornerX = (y, sgn) => cx + sgn * Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
  const xO = cornerX(yo, -side), xI = cornerX(yi, side);          // outer / inner lid corners on the disc
  // arc from the outer corner, under the disc, to the inner corner
  const ang = (x, y) => Math.atan2(y - cy, x - cx);
  const mod = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const span = side > 0 ? mod(ang(xO, yo)) - ang(xI, yi) : mod(ang(xI, yi)) - ang(xO, yo);
  const large = span > Math.PI ? 1 : 0, sweep = side > 0 ? 0 : 1;
  // quadratic lid: control point lifted by 2*arch so the curve's peak sits arch*r above the chord
  const qx = (xO + xI) / 2, qy = (yo + yi) / 2 - 2 * r * arch;
  const path = `M${f1(xO)},${f1(yo)} A${r},${r} 0 ${large} ${sweep} ${f1(xI)},${f1(yi)} Q${f1(qx)},${f1(qy)} ${f1(xO)},${f1(yo)} Z`;
  // pupil centre on the lid curve, shifted toward the inner corner
  const px = cx + side * r * pupilIn;
  const t = (px - xO) / (xI - xO);
  const lidY = yo + (yi - yo) * t - 2 * (1 - t) * t * r * arch;
  return { path, pupil: { cx: px, cy: lidY + r * pupilDrop, r: r * pupilR }, xO, xI };
}

function lidEyeMarkup(id, cx, side, cfg) {
  const e = lidEye(cx, side, cfg);
  const { cy, r } = EYE, pad = 8;
  const bx = f1(cx - r - pad), by = f1(cy - r - pad), bw = f1(2 * r + 2 * pad);
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${bx}" y="${by}" width="${bw}" height="${bw}">` +
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bw}" fill="#fff"/>` +
    `<circle cx="${f1(e.pupil.cx)}" cy="${f1(e.pupil.cy)}" r="${f1(e.pupil.r)}" fill="#000"/></mask>` +
    `<path d="${e.path}" mask="url(#${id})"/>`;
}

const NEUTRAL = { lidOuter: 0.34, lidInner: 0.34, arch: 0.13, pupilR: 0.42, pupilIn: 0.12, pupilDrop: 0.02 };
const HALF = { lidOuter: -0.04, lidInner: -0.26, arch: 0.03, pupilR: 0.36, pupilIn: 0.16, pupilDrop: 0.0 };

function wideEye(cx) {
  const { cy } = EYE, y = cy + 2;
  const rx = 31, ry = 37, prx = 15.5, pry = 21;
  const ell = (x, yy, a, b) => `M${f1(x - a)},${f1(yy)} A${a},${b} 0 1 0 ${f1(x + a)},${f1(yy)} A${a},${b} 0 1 0 ${f1(x - a)},${f1(yy)} Z`;
  return `<path fill-rule="evenodd" d="${ell(cx, y, rx, ry)} ${ell(cx, y, prx, pry)}"/>`;
}

function closedEye(cx) {
  const y = EYE.cy + 12, w = 30;
  return `<path d="M${f1(cx - w)},${f1(y)} Q${f1(cx)},${f1(y + 22)} ${f1(cx + w)},${f1(y)} Q${f1(cx)},${f1(y + 10)} ${f1(cx - w)},${f1(y)} Z"/>`;
}

const eyes = {
  neutral: lidEyeMarkup('pupil-n-l', EYE.lx, 1, NEUTRAL) + lidEyeMarkup('pupil-n-r', EYE.rx, -1, NEUTRAL),
  wide: wideEye(EYE.lx) + wideEye(EYE.rx),
  closed: closedEye(EYE.lx) + closedEye(EYE.rx),
  halfopen: lidEyeMarkup('pupil-h-l', EYE.lx, 1, HALF) + lidEyeMarkup('pupil-h-r', EYE.rx, -1, HALF),
};

const svg = `<svg class="mascot" viewBox="34 40 332 348" width="332" height="348" role="img" aria-labelledby="mascot-title" data-expr="neutral">
      <title id="mascot-title">Spiky low-poly cat mascot, neutral expression</title>
      <defs>
        <filter id="shadow-blur" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="5"/></filter>
      </defs>
      <ellipse class="shadow" cx="200" cy="366" rx="92" ry="12" fill="#000" opacity=".5" filter="url(#shadow-blur)"/>
      <g class="head">
        <g class="spikes">${spikes.join('')}</g>
        <g class="facets">${head.join('')}</g>
        <!-- eyes: a flat layer sitting just in front of the face; never wrapped onto the facet planes -->
        <g class="eyes" fill="${C.white}" stroke="${C.white}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
          <g class="expr" data-expr="neutral">${eyes.neutral}</g>
          <g class="expr" data-expr="wide">${eyes.wide}</g>
          <g class="expr" data-expr="closed">${eyes.closed}</g>
          <g class="expr" data-expr="halfopen">${eyes.halfopen}</g>
        </g>
      </g>
    </svg>`;

// ------------------------------------------------------------------ output
const indexPath = resolve(ROOT, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const START = '<!-- mascot:start -->', END = '<!-- mascot:end -->';
const s = html.indexOf(START), e = html.indexOf(END);
if (s < 0 || e < 0) throw new Error('index.html is missing the <!-- mascot:start --> / <!-- mascot:end --> markers');
writeFileSync(indexPath, html.slice(0, s + START.length) + '\n    ' + svg + '\n    ' + html.slice(e));
console.log(`baked ${head.length} head facets, ${SPIKES.length * 2} spike facets into index.html`);

if (PREVIEW) {
  const labels = Object.entries(V).map(([k, [x, y]]) => `<text x="${x}" y="${y}" font-size="7" fill="#ff5">${k}</text><circle cx="${x}" cy="${y}" r="1.2" fill="#f55"/>`).join('');
  const at = (expr, size) => svg.replace('width="332" height="348"', `width="${size}" height="${Math.round(size * 348 / 332)}"`).replace('data-expr="neutral"', `data-expr="${expr}"`);
  const wire = at('neutral', 520).replace('</svg>', `<g class="debug">${labels}</g></svg>`).replace(/stroke="#[0-9A-F]+"/g, 'stroke="#555" stroke-width=".4"');
  const preview = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#2c2d30;font:600 14px/1 sans-serif;color:#ddd;letter-spacing:.1em">
  <div style="display:flex;justify-content:center;gap:0;padding:10px 0">${['neutral', 'wide', 'closed', 'halfopen'].map(x => `<figure style="margin:0;text-align:center">${at(x, 300)}<figcaption>${x.toUpperCase()}</figcaption></figure>`).join('')}</div>
  <div style="display:flex;justify-content:center;gap:30px;padding:10px 0">${at('neutral', 520)}${wire}</div>
  <style>.expr{display:none}${['neutral', 'wide', 'closed', 'halfopen'].map(x => `.mascot[data-expr="${x}"] .expr[data-expr="${x}"]{display:inline}`).join('')}</style>
  </body>`;
  writeFileSync(resolve(ROOT, 'tools/preview.html'), preview);
  console.log('wrote tools/preview.html');
}
