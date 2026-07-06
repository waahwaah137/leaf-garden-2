# Leaf Garden 2.0 — Session Handoff

> Read this first. It captures the current state, the decisions already made, and what's left to
> verify. This repo is **Leaf Garden 2.0** (the Shape + Color redesign). The stable
> **1.0** app lives in a separate repo/folder and must not be touched from here.

---

## 🟢 Current status: fix implemented locally, NOT YET DEPLOYED

The silent/frozen bug is fixed in the working tree (not yet committed/pushed). Live production
(`https://waahwaah137.github.io/leaf-garden-2/`) still runs the old broken build until this is
pushed to `main`.

**What was broken:** `src/vision/leafShapeCv.ts` called `cv.HuMoments()`/`cv.moments()`, absent
from the vendored 4.8.0 reduced `opencv.js`. The instant a plant was in frame, the call threw →
`LeafSensor.analyze()` threw → the unguarded `requestAnimationFrame(tick)` died before
rescheduling → the whole loop stopped → silence + frozen overlay.

**What changed this session** (see `git status`/`git diff` for the exact diff):

1. **Crash-proofed**: `tick()` in `src/main.ts` now wraps its body in `try { … } finally {
   requestAnimationFrame(tick) }`. `LeafSensor.analyze()` wraps the OpenCV call in `try/catch`
   and falls back to the heuristic on any throw. No single CV call can silence the app again.
2. **Ensemble shape**: the 1.0-style edge/corner heuristic now **always** runs as the base shape
   signal (previously only in the fallback branch). When CV succeeds, Hu-moment shape blends in
   as a refinement via `HU_WEIGHT` (`src/sensors/leafSensor.ts`, starts at 0.5/0.5).
3. **Pure-JS Hu moments**: `huMoments12()` in `src/vision/leafShapeCv.ts` computes Hu 1 & 2
   directly from `findContours`' polygon points (Green's theorem) — identical math to
   `cv.HuMoments`, no dependency on that binding. Validated against a synthetic disk/ellipse
   check: disk Hu1 log ≈ **-0.798** (seeded min -0.8), elongated ellipse Hu2 log ≈ **-1.366**
   (seeded max -1.5) — matches the calibration constants closely.
4. **Drag-to-play** (`src/main.ts`, `src/ui/overlay.ts`): tap and drag now coexist automatically
   by gesture. A quick tap = the original discrete pluck + ripple. A press-and-move (past a
   12px threshold) = a drag: a glowing hue-tinted trail follows the finger
   (`overlay.addTrailPoint`/`drawTrail`), the focus is held open (sustained tone tracking the
   leaf under the finger via `sampleAt`/`focusAt`) instead of decaying, and on release it fades
   out through the existing `FOCUS_DECAY_MS` path.
5. **Resolution bumped**: `SAMPLE_WIDTH/HEIGHT` 80×60 → 160×120, `CAPTURE_WIDTH/HEIGHT` 320×240 →
   640×480 (`src/sensors/leafSensor.ts`). ~4× the per-frame CPU for the Sobel/Harris passes —
   **not yet profiled on a phone**.
6. **Vendored the full OpenCV build**: `public/vendor/opencv.js` replaced with
   `@techstark/opencv-js` v5.0.0-release.1's `dist/opencv.js` (9.99MB → 12.68MB), which has real
   `moments`/`HuMoments`/`matchShapes` bindings (confirmed present in the bundle text). **Caught a
   real integration gap while doing this**: that build exposes the global `cv` as a *Promise*
   (newer emscripten async MODULARIZE output), not a synchronous object with
   `onRuntimeInitialized` like the old docs.opencv.org build. `src/vision/opencvLoader.ts` now
   handles both shapes — it awaits the promise if present, then reassigns `window.cv` to the
   resolved module so every other call site keeps working unchanged. `src/vision/leafShapeCv.ts`
   runtime-verifies native Hu is actually *callable* (not just present) and self-heals to the
   pure-JS fallback on the first throw (`hasNativeHu`/`nativeHu` flag) — so a native binding that
   exists but misbehaves can't regress to silence either.
   - `vite.config.ts`: `maximumFileSizeToCacheInBytes` raised 14MB → 20MB so the larger file still
     precaches for offline PWA use.

**Verified so far (in the sandbox, no camera):**
- `tsc --noEmit` — clean.
- Pure-JS Hu self-check against synthetic shapes — matches seeded calibration (see above).
- Production build (`BASE_PATH=/leaf-garden-2/`) — succeeds, `/leaf-garden-2/` paths resolve
  correctly, `dist/vendor/opencv.js` present, total `dist/` = **13.68 MB**.
- **⚠️ Build must be run via PowerShell/cmd, NOT Git Bash** — Git Bash's MSYS path conversion
  mangles `BASE_PATH=/leaf-garden-2/` into a Windows path (`/Program Files/Git/leaf-garden-2/`)
  before Vite sees it. Use the PowerShell tool / `set` in cmd, as documented below.

**Not yet done:**
- On-device test (no camera in this sandbox) — sound returning, `form`/`hue`/`presence` moving,
  tap vs. drag feel, and whether the full opencv.js's native Hu path actually engages (vs. falling
  back to pure-JS) are all unverified until run on a phone.
- Commit + push to `main` (this triggers the GitHub Actions auto-deploy to production Pages —
  hasn't been done, pending your go-ahead).
- CPU profiling of the 160×120/640×480 resolution bump on a real phone.

---

## ✅ Decisions (locked with the user — do not re-litigate)

1. **Shape = ENSEMBLE, not replacement.** 1.0's edge/corner heuristic is the always-on **base**
   shape signal (the lively part); Hu-moment shape blends in as a **refinement**. Color is a
   **separate** modulation + hue tint. No single CV call may ever be able to silence the app.
2. **Full OpenCV build vendored** (`@techstark/opencv-js`, ~12.7MB) for native
   `moments`/`HuMoments`/`matchShapes` — with the pure-JS Hu fallback and runtime
   callability-verification kept as the permanent safety net, not a temporary stopgap.
3. **Resolution**: 80×60 → 160×120 analysis, capture toward 640×480. Target ~10Hz; **needs
   on-phone profiling** — back off the sample resolution if it can't hold the rate.
4. **Tap + drag coexist automatically by gesture** (no mode toggle). Tap = discrete pluck +
   ripple. Drag = continuous trail + sustained tone that tracks the leaf under the finger and
   fades out on release.

---

## 🗂 Key files

- `src/vision/leafShapeCv.ts` — Hu shape (native-if-callable + pure-JS fallback via
  `huMoments12`/`hasNativeHu`) + per-leaf color.
- `src/vision/colorStats.ts` — HSV circular-hue-mean + colorSignal (unchanged).
- `src/vision/opencvLoader.ts` — script-tag loader; handles both classic-object and
  Promise-based `window.cv` shapes.
- `src/sensors/leafSensor.ts` — signals (`getShapeSignal`/`getColorSignal`/`getHueDeg`),
  try/catch fallback, resolution consts (`SAMPLE_*`/`CAPTURE_*`), ensemble blend (`HU_WEIGHT`).
- `src/audio/leafscape.ts` — `update(shape, color, presence, spatial, accent)`; color → delay.
  Unchanged this session.
- `src/main.ts` — `focus` state, `dragging` flag, `pointerToStage`/`sampleAt`/`focusAt`,
  `attachTapToPlay()` (tap/drag pointer state machine), `tick()` (now crash-proofed).
- `src/ui/overlay.ts` — `hueToCss`, ripples, and the new drag `trail`
  (`addTrailPoint`/`drawTrail`).
- `public/vendor/opencv.js` — now the full `@techstark/opencv-js` build.
- Full original spec: `v2.0/README.md`.

---

## 🛠 How to run / deploy (this Windows machine)

`npm`/`node` are **not on PATH**. Use the portable Node:

```
C:\Users\Sourav\AppData\Local\nodejs_portable\node-v22.13.1-win-x64\node.exe
```

- Type-check: `node node_modules\typescript\bin\tsc --noEmit`
- Build: **use PowerShell or cmd, not Git Bash** (see mangling note above) —
  `$env:BASE_PATH = "/leaf-garden-2/"` then `node node_modules\vite\bin\vite.js build`
- Deploy: commit + push to `main` → **GitHub Actions** auto-deploys to Pages
  (`waahwaah137.github.io/leaf-garden-2/`). First `gh` push of a workflow file may be blocked by
  OAuth scope — a plain `git push` works.
- **No camera in the sandbox** — the definitive "sound is back + signals move + tap/drag feel
  right" test is on a phone against real plants. HUD shows `form / hue / presence` for on-device
  calibration; the Sensitivity dial is the tuning escape hatch.

---

## ⚠️ Known caveats

- Hu thresholds (`HU1/HU2_LOG_*`) and `HU_WEIGHT` will likely need **on-device re-tuning** —
  expected; validated only against synthetic shapes so far, not real leaves.
- The green-only ExG plant mask (`EXG_THRESHOLD=24`) means color currently reads mostly as
  shades of green, not a full color wheel (revisiting the mask is a separate future task).
- The resolution bump (160×120/640×480) is ~4× the per-frame CPU of the Sobel/Harris passes —
  unverified on a real phone; back off `SAMPLE_WIDTH/HEIGHT` if it can't hold ~10Hz.
- Whether the full opencv.js build's native Hu path actually engages at runtime (vs. always
  falling back to pure-JS) is unverified — only observable on-device via console warnings /
  `leaf.isUsingCv()` in the HUD.
