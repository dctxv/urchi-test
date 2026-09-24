#!/usr/bin/env node
// Bakes the low-poly mascot head into index.html as a static inline SVG.
//
//   node tools/build-mascot.mjs            # rewrite the <!-- mascot:start/end --> block in index.html
//   node tools/build-mascot.mjs --preview  # also write tools/preview.html (four-up + wireframe)
//
// The facets come from tools/mascot-facets.json, which tools/trace-ref.mjs traces
// from the flat-shaded front view in ref/head-front.png: every plane keeps the
// grey the render gave it (monochrome, no tints, no gradients), the geometry is
// mirrored left/right, and the eyes are parametric white paths drawn as a flat
// layer above the facets, one <g> per expression.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = process.argv.includes('--preview');
const DATA = JSON.parse(readFileSync(resolve(ROOT, 'tools/mascot-facets.json'), 'utf8'));

const WHITE = '#F2F0E9';
const f1 = n => (Math.round(n * 10) / 10).toString();
const grey = v => `#${Math.round(v).toString(16).padStart(2, '0').repeat(3).toUpperCase()}`;
const pts = poly => poly.map(p => `${p[0]},${p[1]}`).join(' ');
const inside = ([x, y], poly) => {
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
};

// ------------------------------------------------------------------ head
// A silhouette underlay in the darkest tone seals any hairline seams between planes.
const underlay = `<polygon points="${pts(DATA.silhouette)}" fill="${grey(8)}"/>`;
const facets = DATA.facets.map(f => `<polygon points="${pts(f.poly)}" fill="${grey(f.grey)}" stroke="${grey(f.grey)}"/>`);
// The render's grey eye sockets are placeholders: fill them with the face plane they sit in.
const sockets = DATA.sockets.map(s => {
  const host = DATA.facets.find(f => inside([s.cx, s.cy], f.poly));
  const g = grey(host ? host.grey : 30);
  return `<polygon points="${pts(s.poly)}" fill="${g}" stroke="${g}"/>`;
});

// ------------------------------------------------------------------ eyes
// Placed from the traced sockets: mirrored centres, disc radius a little under the socket half-width.
const AX = DATA.axis;
const dx = DATA.sockets.reduce((a, s) => a + Math.abs(s.cx - AX), 0) / DATA.sockets.length;
const EYE = { lx: Math.round(AX - dx), rx: Math.round(AX + dx), cy: Math.round(DATA.sockets[0].cy), r: 100 };
const STROKE = 9;   // same-colour round-joined stroke softens the corners; adds ~4.5 all round

// neutral / half-open: a disc clipped by an upper lid, with the pupil notched into the lid line.
// lidOuter/lidInner: lid height at the outer/inner corner in radii above the centre (negative = below).
// arch: bulge of the lid's centre above the corner line, in radii (a gentle ∩).
function lidEye(cx, side, { lidOuter, lidInner, arch, pupilR, pupilIn, pupilDrop }) {
  const { cy, r } = EYE;
  const yo = cy - r * lidOuter, yi = cy - r * lidInner;
  const cornerX = (y, sgn) => cx + sgn * Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
  const xO = cornerX(yo, -side), xI = cornerX(yi, side);          // outer / inner lid corners on the disc
  const ang = (x, y) => Math.atan2(y - cy, x - cx);
  const mod = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const span = side > 0 ? mod(ang(xO, yo)) - ang(xI, yi) : mod(ang(xI, yi)) - ang(xO, yo);
  const large = span > Math.PI ? 1 : 0, sweep = side > 0 ? 0 : 1;
  const qx = (xO + xI) / 2, qy = (yo + yi) / 2 - 2 * r * arch;   // quadratic lid, peak arch*r above the chord
  const path = `M${f1(xO)},${f1(yo)} A${r},${r} 0 ${large} ${sweep} ${f1(xI)},${f1(yi)} Q${f1(qx)},${f1(qy)} ${f1(xO)},${f1(yo)} Z`;
  const px = cx + side * r * pupilIn;                               // pupil centre on the lid curve, toward the inner corner
  const t = (px - xO) / (xI - xO);
  const lidY = yo + (yi - yo) * t - 2 * (1 - t) * t * r * arch;
  return { path, pupil: { cx: px, cy: lidY + r * pupilDrop, r: r * pupilR } };
}

function lidEyeMarkup(id, cx, side, cfg) {
  const e = lidEye(cx, side, cfg);
  const { cy, r } = EYE, pad = 24;
  const bx = f1(cx - r - pad), by = f1(cy - r - pad), bw = f1(2 * r + 2 * pad);
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${bx}" y="${by}" width="${bw}" height="${bw}">` +
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bw}" fill="#fff"/>` +
    `<circle cx="${f1(e.pupil.cx)}" cy="${f1(e.pupil.cy)}" r="${f1(e.pupil.r)}" fill="#000"/></mask>` +
    `<path d="${e.path}" mask="url(#${id})"/>`;
}

const NEUTRAL = { lidOuter: 0.34, lidInner: 0.34, arch: 0.13, pupilR: 0.42, pupilIn: 0.12, pupilDrop: 0.02 };
const HALF = { lidOuter: -0.04, lidInner: -0.26, arch: 0.03, pupilR: 0.36, pupilIn: 0.16, pupilDrop: 0.0 };

function wideEye(cx) {
  const { cy, r } = EYE, y = cy + r * 0.06;
  const rx = r * 0.91, ry = r * 1.09, prx = r * 0.455, pry = r * 0.62;
  const ell = (x, yy, a, b) => `M${f1(x - a)},${f1(yy)} A${f1(a)},${f1(b)} 0 1 0 ${f1(x + a)},${f1(yy)} A${f1(a)},${f1(b)} 0 1 0 ${f1(x - a)},${f1(yy)} Z`;
  return `<path fill-rule="evenodd" d="${ell(cx, y, rx, ry)} ${ell(cx, y, prx, pry)}"/>`;
}

function closedEye(cx) {
  const { cy, r } = EYE, y = cy + r * 0.35, w = r * 0.88;
  return `<path d="M${f1(cx - w)},${f1(y)} Q${f1(cx)},${f1(y + r * 0.65)} ${f1(cx + w)},${f1(y)} Q${f1(cx)},${f1(y + r * 0.29)} ${f1(cx - w)},${f1(y)} Z"/>`;
}

const eyes = {
  neutral: lidEyeMarkup('pupil-n-l', EYE.lx, 1, NEUTRAL) + lidEyeMarkup('pupil-n-r', EYE.rx, -1, NEUTRAL),
  wide: wideEye(EYE.lx) + wideEye(EYE.rx),
  closed: closedEye(EYE.lx) + closedEye(EYE.rx),
  halfopen: lidEyeMarkup('pupil-h-l', EYE.lx, 1, HALF) + lidEyeMarkup('pupil-h-r', EYE.rx, -1, HALF),
};

// ------------------------------------------------------------------ svg
const xs = DATA.silhouette.map(p => p[0]), ys = DATA.silhouette.map(p => p[1]);
const top = Math.min(...ys) - 12, bottom = Math.max(...ys);
const shadowY = bottom + 58;
const VB = { x: Math.min(...xs) - 12, y: top, w: Math.max(...xs) - Math.min(...xs) + 24, h: shadowY + 40 - top };
const SIZE = `width="${VB.w}" height="${VB.h}"`;

const svg = `<svg class="mascot" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" ${SIZE} role="img" aria-labelledby="mascot-title" data-expr="neutral">
      <title id="mascot-title">Spiky low-poly cat mascot, neutral expression</title>
      <defs>
        <filter id="shadow-blur" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="14"/></filter>
      </defs>
      <ellipse class="shadow" cx="${AX}" cy="${shadowY}" rx="${Math.round(VB.w * 0.27)}" ry="30" fill="#000" opacity=".5" filter="url(#shadow-blur)"/>
      <g class="head">
        <g class="facets">${underlay}${facets.join('')}${sockets.join('')}</g>
        <!-- eyes: a flat layer sitting just in front of the face; never wrapped onto the facet planes -->
        <g class="eyes" fill="${WHITE}" stroke="${WHITE}" stroke-width="${STROKE}" stroke-linejoin="round" stroke-linecap="round">
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
console.log(`baked ${facets.length} facets (+${sockets.length} socket fills) into index.html; eyes at ${EYE.lx}/${EYE.rx}, y ${EYE.cy}, r ${EYE.r}`);

if (PREVIEW) {
  const at = (expr, size) => svg.replace(SIZE, `width="${size}" height="${Math.round(size * VB.h / VB.w)}"`).replace('data-expr="neutral"', `data-expr="${expr}"`);
  const wire = at('neutral', 520).replace(/stroke="#[0-9A-F]+"/g, 'stroke="#3f3" stroke-width="1.2"');
  const preview = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#2c2d30;font:600 14px/1 sans-serif;color:#ddd;letter-spacing:.1em">
  <div style="display:flex;justify-content:center;gap:0;padding:10px 0">${['neutral', 'wide', 'closed', 'halfopen'].map(x => `<figure style="margin:0;text-align:center">${at(x, 300)}<figcaption>${x.toUpperCase()}</figcaption></figure>`).join('')}</div>
  <div style="display:flex;justify-content:center;gap:30px;padding:10px 0">${at('neutral', 520)}${wire}</div>
  <style>.expr{display:none}${['neutral', 'wide', 'closed', 'halfopen'].map(x => `.mascot[data-expr="${x}"] .expr[data-expr="${x}"]{display:inline}`).join('')}</style>
  </body>`;
  writeFileSync(resolve(ROOT, 'tools/preview.html'), preview);
  console.log('wrote tools/preview.html');
}
