#!/usr/bin/env node
// Bakes the mascot's 3D mesh into index.html.
//
//   node tools/build-mascot.mjs   # rewrite the <!-- mesh:start/end --> block in index.html
//
// The front planes come from tools/mascot-facets.json (traced from ref/head-half.png
// by tools/trace-ref.mjs and mirrored). Each shared corner becomes one vertex, every
// vertex gets a depth from how far it sits inside the outline (with the lower face
// capped flat), and a mirrored, slightly deeper copy of the planes closes the back of
// the head. The page rotates, culls, shades and draws that mesh as SVG polygons.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(readFileSync(resolve(ROOT, 'tools/mascot-facets.json'), 'utf8'));

const ENV = k => process.env[k] !== undefined ? Number(process.env[k]) : undefined;
const INFLATE = ENV('INFLATE') ?? 26;        // depth scale: z = INFLATE * dist^DEPTH_POW (normalised so the centre lands near INFLATE*sqrt(350))
const DEPTH_POW = ENV('DEPTH_POW') ?? 0.75;
const FACE_Y = 505, FACE_Z = ENV('FACE_Z') ?? 330;   // below the brow line the front is capped flat
const BACK = ENV('BACK') ?? 1.1;             // the skull behind is a little deeper than the face in front

// ------------------------------------------------------------------ depth
const sil = DATA.silhouette;
function edgeDist([x, y]) {
  let best = Infinity;
  for (let i = 0, j = sil.length - 1; i < sil.length; j = i++) {
    const [ax, ay] = sil[j], [bx, by] = sil[i]; const dx = bx - ax, dy = by - ay; const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}
const dome = p => INFLATE * Math.pow(edgeDist(p), DEPTH_POW) * Math.pow(350, 0.5 - DEPTH_POW);
const frontZ = p => { let z = dome(p); if (p[1] > FACE_Y) z = Math.min(z, FACE_Z); return z; };
const backZ = p => -BACK * dome(p);

// ------------------------------------------------------------------ indexed mesh
const AX = DATA.axis;
const ys = sil.map(p => p[1]);
const CY = (Math.min(...ys) + Math.max(...ys)) / 2;   // rotate about the head's centre
const verts = [], index = new Map();
const vid = (p, side) => {
  const key = `${p[0]},${p[1]},${side}`;
  if (!index.has(key)) {
    const z = side === 'f' ? frontZ(p) : backZ(p);
    index.set(key, verts.length);
    verts.push([Math.round((p[0] - AX) * 10) / 10, Math.round((p[1] - CY) * 10) / 10, Math.round(z * 10) / 10]);
  }
  return index.get(key);
};
const onOutline = p => edgeDist(p) < 1.5;
const faces = [];
for (const f of DATA.facets) faces.push(f.poly.map(p => vid(p, 'f')));
for (const f of DATA.facets) faces.push(f.poly.map(p => vid(p, onOutline(p) ? 'f' : 'b')).reverse());

const mesh = { v: verts, f: faces, front: DATA.facets.length };
const json = JSON.stringify(mesh);

// ------------------------------------------------------------------ output
const indexPath = resolve(ROOT, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const START = '<!-- mesh:start -->', END = '<!-- mesh:end -->';
const s = html.indexOf(START), e = html.indexOf(END);
if (s < 0 || e < 0) throw new Error('index.html is missing the <!-- mesh:start --> / <!-- mesh:end --> markers');
writeFileSync(indexPath, html.slice(0, s + START.length) + `\n<script id="mascot-mesh" type="application/json">${json}</script>\n` + html.slice(e));
console.log(`baked ${verts.length} vertices, ${faces.length} faces (${mesh.front} front) into index.html`);
