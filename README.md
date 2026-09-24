# urchi-test

A single-page mascot close-up: a compact, dark, low-poly spiky cat head with four
selectable eye expressions (Neutral, Wide, Closed, Half-open) and an Auto cycle.

- `index.html` — the whole page. The mascot is a static inline SVG (flat polygon
  facets, one `<g>` per expression), with the controls and the Auto cycle in a few
  lines of vanilla JS. No build step; open the file or serve the folder.
- `ref/head-front.png` — flat-lit front view the head geometry and greys are traced from.
- `mascot-close-up.jpg` — the four-expression sheet the eye designs follow.
- `tools/trace-ref.mjs` — traces `ref/head-front.png` into `tools/mascot-facets.json`
  (edge-based facet segmentation, snapped and mirrored vertices). Needs the
  `playwright` package with Chromium; only rerun it if the reference changes.
- `tools/build-mascot.mjs` — bakes the facets and the parametric eyes into `index.html`.
  Run `node tools/build-mascot.mjs` after editing it; `--preview` writes
  `tools/preview.html` with a four-up and a wireframe.

Debug knobs: `index.html?expr=wide` forces an expression, `?still` freezes the hover.
