# urchi-test

A single-page mascot close-up: a compact, dark, low-poly spiky cat head with four
selectable eye expressions (Neutral, Wide, Closed, Half-open) and an Auto cycle.

- `index.html` — the whole page. The mascot is a static inline SVG (flat polygon
  facets, one `<g>` per expression), with the controls and the Auto cycle in a few
  lines of vanilla JS. No build step; open the file or serve the folder.
- `ref/head-half.png` — the half-face plane diagram (blue planes, green edges) the head
  geometry is traced from and mirrored. `ref/head-front.png` is the flat render the eye
  positions were measured on; `mascot-close-up.jpg` is the four-expression sheet the
  eye designs follow. The planes are relit in monochrome from one overhead light, with
  black facet outlines.
- `tools/trace-ref.mjs` — traces `ref/head-half.png` into `tools/mascot-facets.json`
  (one polygon per blue region, snapped vertices, mirrored across the centre line).
  Needs the `playwright` package with Chromium; only rerun it if the diagram changes.
- `tools/build-mascot.mjs` — bakes the facets and the parametric eyes into `index.html`.
  Run `node tools/build-mascot.mjs` after editing it; `--preview` writes
  `tools/preview.html` with a four-up and a wireframe.

Debug knobs: `index.html?expr=wide` forces an expression, `?still` freezes the hover.
