# Leaf Garden 2.0 — Shape + Color Signal Redesign

> Roadmap / design spec for the **2.0** line of Leaf Garden. The current **1.0** app is the
> one that's live and running today; nothing in this document is implemented yet — it
> replaces the round/pointy `spikiness` classifier with two new signals (shape + color).

## Context

The app currently reduces every detected leaf to a single scalar `spikiness`
(0=round, 1=sharp), computed from contour **circularity** + **convexity-defect**
counting in `analyzeLeafShape()`. That approach needs well-resolved contour/edge
detail, but the camera is analyzed at a tiny 80×60 buffer — round-vs-pointy
isn't reliably distinguishable at that resolution, so the distinction doesn't
read as meaningful ("doesn't reflect that much," per the user).

Decision: drop the circularity/convexity-defect formula entirely. Replace it
with two new signals computed from the same contours:

1. **Shape signal** — from OpenCV **Hu moments** (`cv.moments` → `cv.HuMoments`,
   7 values). These are statistical/global shape descriptors (translation/
   scale/rotation invariant) rather than fine-boundary-dependent, so they
   degrade more gracefully at low resolution.
2. **Color signal** — an HSV histogram/circular-hue-mean summary of the pixels
   inside each leaf's contour. Color survives blur far better than edge detail.

Confirmed product decisions (already approved, not open questions):
- Shape signal replaces `spikiness` **in-place** in the existing round/sharp
  two-voice crossfade architecture (`leafscape.ts`) — same plumbing, new input.
- Color signal gets a new job: modulates the sharp voice's delay
  feedback/wetness around each bank's base values, **and** tints tracking
  boxes/ripples with the leaf's actual detected hue instead of a fixed
  teal→pink gradient.
- Fallback (OpenCV not yet loaded): keep the existing edge/corner heuristic
  under the hood for shape (unchanged), but never call it "round/pointy" in
  copy. Color histogram doesn't need OpenCV, so it works even before CV loads.
- Copy rewrite is poetic/short, not technical — no "Hu moments"/"HSV" language
  in the UI.

## Known risk (flagged up front, not solved here)

- **Hu1/Hu2 normalization ranges** are seeded from synthetic circle/star
  contours, not real leaf masks at 80×60 with camera noise — will need
  on-device re-tuning. The existing Sensitivity slider stays as the in-app
  escape hatch for this.
- **The ExG plant mask (`EXG_THRESHOLD=24`) only detects green-ish foliage** —
  it silently limits what colorSignal can ever see (a red flower or autumn
  leaf won't register as plant at all, so its color never reaches the
  histogram). Worth knowing going in: color signal will mostly distinguish
  shades/tones of green, not a full color wheel. Not in scope to fix the mask
  threshold now, but this bounds what "color makes it feel dynamic" can
  deliver until/unless that's revisited separately.
- No camera in this sandbox — sign/ordering of the Hu formula (round shape →
  low signal, jagged shape → high signal) should get a synthetic-contour
  sanity check before relying on it, since true end-to-end verification isn't
  possible here.

## Implementation

### 1. `src/vision/colorStats.ts` (new file)
`computeColorStats(mask, rgba, w, h, rect?)` → `{ colorSignal, hueDeg }`.
Iterate pixels (within `rect` if given, else whole frame) where mask is set;
convert RGB→HSV; accumulate `weight = S*V` and circular-mean hue via
`sumX += weight*cos(H)`, `sumY += weight*sin(H)` (never average hue directly —
always accumulate as vectors, recover via `atan2` at the end). Also track
`sumS`/`sumV`. Final: `hueDeg = atan2(sumY,sumX)` normalized to 0-360 (fallback
120°/green if no chroma pixels); `colorSignal = clamp(meanS * lerp(0.7,1.3,meanV), 0, 1)`.

### 2. `src/vision/leafShapeCv.ts`
- `analyzeLeafShape(mask, rgba, w, h)` — new `rgba` param.
- Delete circularity/`convexHull`/`convexityDefects` block. Per contour:
  `cv.moments(cnt)` → `cv.HuMoments(m)` → use only **Hu1, Hu2** (higher-order
  Hu values are too noisy at this pixel count — explicitly excluded).
  Log-transform each: `L(v) = sign(v)*log10(abs(v)+1e-12)`. Normalize/clamp via
  calibration consts (`HU1_LOG_MIN/MAX`, `HU2_LOG_MIN/MAX`, seeded from one
  synthetic circle + one synthetic star computed once during implementation).
  `shapeSignal = clamp(0.65*n1 + 0.35*n2, 0, 1)`.
- Per contour, call `computeColorStats(mask, rgba, w, h, cv.boundingRect(cnt))`
  (reuses the already-computed rect — no new polygon test; bounding-rect-based
  sampling can bleed color between adjacent overlapping boxes, acceptable
  tradeoff at this resolution, flagged as the upgrade path if it looks wrong
  on-device).
- `LeafBox`: `{ x, y, w, h, shapeSignal, colorSignal, hueDeg }` (no
  "spikiness"/round/sharp naming — that language is retired).
- `ShapeResult`: `{ shapeSignal, colorSignal, hueDeg, boxes }`, all area-weighted
  means (hueDeg via the same circular-mean approach — recommend just calling
  `computeColorStats` once more over the whole mask/rgba for the frame-level
  value rather than re-deriving from per-box stats).
- Feed `shapeSignal` into the **existing** `contrastCurve()`/sensitivity-gain
  logic in `leafSensor.ts` unchanged — that machinery is generic to "a 0-1 raw
  metric," not specific to the old formula.

### 3. `src/sensors/leafSensor.ts`
- `spikiness` → `shapeSignal` (state + `getShapeSignal()`); drop
  `getRoundness()` (confirmed unused elsewhere).
- Add `colorSignal`, `hueDeg` (smoothed via `AngleEma` from `utils/math.ts` —
  reuse, don't write new circular-smoothing code) + getters.
- Pass the existing `data` (RGBA array from `getImageData`, already available
  in `analyze()`) into `analyzeLeafShape(mask255, data, w, h)`.
- Fallback branch (`!cvOk`): shape heuristic (edge/corner density) stays
  functionally identical, just renamed. Add
  `computeColorStats(this.isPlant, data, w, h)` so color still works pre-CV.

### 4. `src/audio/leafscape.ts`
- `update(shapeSignal, colorSignal, presence, spatial, accent)` — round/sharp
  crossfade, filter cutoff, reverb-wet formulas are **mechanically unchanged**,
  just consuming the renamed input.
- New color-driven block modulating **around** each bank's base delay values
  (confirmed orthogonal to Space/Density dials — those only touch
  `reverb.wet`/arp probability):
  ```
  const fb = clamp(bank.sharp.delayFeedback + (colorSignal-0.5)*2*0.15, 0.05, 0.92);
  const dwet = clamp(bank.sharp.delayWet * lerp(0.65, 1.35, colorSignal), 0, 1);
  sharpDelay.feedback.rampTo(fb, RAMP);
  sharpDelay.wet.rampTo(dwet, RAMP);
  ```
- `pluck(spik)` → `pluck(shape)`: rename only, voice-choice threshold logic
  unchanged (color intentionally doesn't affect which voice a tap triggers).
- `updateLeafscape`/module exports: add `colorSignal` param in the chain.

### 5. `src/main.ts`
- `focus`: `{ x, y, strength, spik }` → `{ x, y, strength, shape, color }`.
- `onStageTap()`: read nearest box's `shapeSignal`/`colorSignal`/`hueDeg` (same
  nearest-neighbor logic), fall back to sensor's global getters. `addRipple(mx, ny, hue)`
  (ripple color keyed on hue now, not shape). `pluckLeafscape(shape)`.
- `tick()`: read `getShapeSignal()`/`getColorSignal()`/`getHueDeg()`; blend
  **both** shape and color toward focus (`effShape`, new `effColor` — needed so
  a tap doesn't bias shape toward the tapped leaf while leaving color/delay
  untouched); call `updateLeafscape(effShape, effColor, presence, effSpatial, focus.strength)`;
  update `render()`'s state object (section 7 below).

### 6. `src/ui/overlay.ts`
- Add `hueToCss(hueDeg, alpha) => hsla(hueDeg, 82%, 58%, alpha)`; retire
  `TEAL`/`PINK`/`mix()` spikiness-keyed coloring.
- `Ripple.spik` → `Ripple.hue`; `FocusMarker` gains optional `hue`.
- Box tint: `hueToCss(b.hueDeg)` instead of the round/sharp gradient.
- Accent-box highlight: since there's no "pointiest" concept anymore, highlight
  `boxes[0]` (largest tracked leaf — boxes are already area-sorted) in yellow.
  Low-stakes call, easy to change later.
- Per-box numeric label (`b.spikiness.toFixed(2)`): **remove** — a raw
  Hu-derived number isn't meaningful the way even the old label marginally
  was, and it fits the poetic/non-technical direction. Trivial to re-add as a
  debug toggle if wanted.

### 7. `src/ui/dashboard.ts`
- `DashboardState`: `spikiness`/`roundness` → `shapeSignal`, `colorSignal`, `hueDeg`.
- `render()` HUD text: drop the sharp/round ternary. New format:
  `form ${shapeSignal.toFixed(2)} · hue ${Math.round(hueDeg)}° · ${plantPresence%}`
  (kept numeric since it's the only on-device calibration surface available
  given no camera access in this environment).

### 8. `index.html`
- Start-screen feature card: replace "Round leaves make spacey, ambient
  sound." / "Pointy leaves make bright, high-frequency sound." with two short
  lines in the same tone, e.g. "Every leaf's shape bends the sound around
  it." / "Every leaf's color paints in its own texture."
- About panel: replace "round leaves sound spacey, pointy leaves sound
  bright" with "every plant's shape and color shift the sound, so no two
  gardens play the same."
- HUD placeholder text: `pointiness 0.00` → `form 0.00`.

### 9. `src/audio/banks.ts` — no changes (confirmed its `delayFeedback`/
`delayWet`/`hpHz` schema already supports the modulate-around-base design).

## Verification

No camera in this sandbox, so full end-to-end testing isn't possible here.
What can be checked:
- `npm run build` (tsc + vite build) to catch type errors across the renamed
  interfaces/call sites.
- A small synthetic-contour sanity script (feed a hand-built circle point set
  and a star/jagged point set through `cv.moments`/`HuMoments`) to confirm
  sign/ordering before trusting the calibration constants.
- `npm run dev` + manual check in-browser that the app still boots, HUD text
  renders, and no runtime errors occur (camera permission can be granted from
  a laptop webcam even without real plants, just to confirm the pipeline
  doesn't throw — color/shape values won't mean much without real foliage).
- Flag explicitly to the user after implementation: Hu-moment thresholds and
  the `hsla` box-tint constants will very likely need on-device re-tuning
  against real plants before this feels "right" — that's expected, not a bug.
