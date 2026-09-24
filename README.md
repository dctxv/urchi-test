# urchi-test

A single-page mascot close-up: a compact, monochrome, low-poly spiky cat head that
turns to follow the cursor. The eyes and expression controls are parked for now.

- `index.html` — the whole page. The head is a small 3D mesh (baked in as JSON) that a
  few lines of vanilla JS rotate, back-face cull, flat-shade from one overhead light,
  depth-sort and draw as SVG polygons every frame, with one black edge layer on top so
  every outline is the same width. No build step; open the file or serve the folder.
- `ref/head-half.png` — the half-face plane diagram (blue planes, green edges) the head
  geometry is traced from and mirrored. `ref/head-front.png` and `mascot-close-up.jpg`
  are the earlier renders the look follows.
- `tools/trace-ref.mjs` — traces `ref/head-half.png` into `tools/mascot-facets.json`
  (one polygon per blue region, corners snapped to shared points, tips sharpened,
  mirrored across the centre line). Needs the `playwright` package with Chromium;
  only rerun it if the diagram changes.
- `tools/build-mascot.mjs` — turns those planes into the 3D mesh (depth from distance to
  the outline, a mirrored back) and bakes it into `index.html`. Run it after editing.

Debug knobs: `index.html?still` freezes the hover and the cursor follow;
`?look=0.6,-0.3` fixes the gaze target (x right, y down, each -1..1).
