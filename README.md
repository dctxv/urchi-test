# urchi-test

A single-page mascot close-up: a compact, near-black, low-poly spiky cat head with a
white rim and large open eyes that turns to follow the cursor, blinks every few seconds
(about 0.2s, occasionally twice), and breathes with a slow nod. Only the neutral face
exists for now; the other expressions and their controls come later.

- `index.html` — the whole page. The head is a small 3D mesh (baked in as JSON) that a
  few lines of vanilla JS turn toward the cursor, back-face cull, flat-shade from one
  overhead light, and paint far-to-near as SVG polygons every frame, with no outlines. No build step; open the file or serve the folder.
- `ref/head-half.png` — the half-face plane diagram (blue planes, green edges) the front
  of the head is traced from and mirrored.
- `ref/head-side.png` — the side view the depth is taken from: the centre line follows
  its outline exactly, and the ear, spikes and cheeks are placed from it. Its neck is
  ignored. `ref/head-front.png` and `mascot-close-up.jpg` are earlier references.
- `tools/trace-ref.mjs` — traces both references into `tools/mascot-facets.json` and
  `tools/side-profile.json`. Needs the `playwright` package with Chromium; only rerun it
  if a reference changes.
- `tools/build-mascot.mjs` — makes every plane meet its neighbours corner to corner
  (clipped spike tips merged, T-junctions inserted), mirrors the half, closes the back,
  assigns depth from the side view, splits planes into triangles for drawing (shaded as
  one plane each) (then stretches the front 1.3× and leaves the back as traced,
  set with `FRONT_GROW` / `BACK_GROW`), checks the result is one closed surface with every
  edge shared by exactly two planes, and bakes it into `index.html`. Run it after
  editing; `--verbose` lists every repair it made. It also places the eyes: flat oval
  rings on a plane fitted to the face under them and lifted clear of it.

Debug knobs: `index.html?still` freezes the hover and the cursor follow;
`?look=0.6,-0.3` fixes the gaze target (x right, y down, each -1..1);
`?yaw=90&pitch=0` fixes the angles in degrees (90 is the right side view);
`?ortho` drops perspective for comparing against the reference views;
`?blink=0.5` fixes how far the eyes are shut (0 open, 1 closed).
