# urchi-test

A single-page mascot close-up: a compact, dark, low-poly spiky cat head with four
selectable eye expressions (Neutral, Wide, Closed, Half-open) and an Auto cycle.

- `index.html` — the whole page. The mascot is a static inline SVG (flat polygon
  facets, one `<g>` per expression), with the controls and the Auto cycle in a few
  lines of vanilla JS. No build step; open the file or serve the folder.
- `mascot-close-up.jpg` — the four-expression reference the head is matched against.
- `tools/build-mascot.mjs` — optional generator that bakes the SVG into `index.html`
  from a hand-placed vertex list. Run `node tools/build-mascot.mjs` after editing it;
  `--preview` writes `tools/preview.html` with a four-up and a labelled wireframe.

Debug knobs: `index.html?expr=wide` forces an expression, `?still` freezes the hover.
