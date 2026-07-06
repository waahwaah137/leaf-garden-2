import { clamp } from '../utils/math';
import { cv, isCvReady } from './opencvLoader';
import { computeColorStats } from './colorStats';

/** A tracked leaf: bounding box (normalized 0-1) + its shape + color signals. */
export interface LeafBox {
  x: number;
  y: number;
  w: number;
  h: number;
  shapeSignal: number; // 0 = round/compact, 1 = jagged/elongated ("form")
  colorSignal: number; // 0-1 color richness
  hueDeg: number; // 0-360
}

export interface ShapeResult {
  shapeSignal: number; // area-weighted mean form across leaves
  colorSignal: number; // frame-level color richness
  hueDeg: number; // frame-level circular-mean hue
  boxes: LeafBox[];
}

const MIN_AREA_FRAC = 0.004; // ignore specks smaller than this fraction of the frame
const MAX_BOXES = 14;

// Whether the loaded OpenCV build actually exposes *callable* moment bindings. The reduced 4.8
// docs build does NOT — the wrappers may exist (`typeof … === 'function'`) but throw when called
// (this is exactly what silenced the app). The full build does. `typeof` is only a cheap
// pre-filter; the real proof is a successful call, so nativeHu flips to false permanently the
// first time a native call throws (see the call site) and we fall back to pure-JS Hu.
let nativeHu: boolean | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasNativeHu(c: any): boolean {
  if (nativeHu === null) {
    nativeHu = typeof c?.moments === 'function' && typeof c?.HuMoments === 'function';
  }
  return nativeHu;
}

// --- Hu-moment shape calibration -------------------------------------------------------
// Shape signal comes from Hu moments 1 & 2 (global, scale/rotation-invariant descriptors),
// which degrade more gracefully at 80×60 than fine-boundary circularity/convexity did.
// Only Hu1 (spread/compactness) and Hu2 (elongation/asymmetry) are used — higher-order Hu
// values are too noisy at this pixel count. Log-transform then normalize into 0-1.
//
// Constants seeded from a synthetic sanity check (disk vs ellipse/star): a round disk sits at
// Hu1 log ≈ -0.80, elongated/jagged shapes rise toward ≈ -0.62; Hu2 log spans ≈ -6 (compact)
// to ≈ -1.5 (elongated). THESE WILL NEED ON-DEVICE RE-TUNING against real leaves — the
// Sensitivity slider is the in-app escape hatch.
const HU1_LOG_MIN = -0.8;
const HU1_LOG_MAX = -0.62;
const HU2_LOG_MIN = -6.0;
const HU2_LOG_MAX = -1.5;

/** Signed log10 so tiny/zero Hu values don't explode. */
function logHu(v: number): number {
  return Math.sign(v) * Math.log10(Math.abs(v) + 1e-12);
}

function normLog(l: number, min: number, max: number): number {
  return clamp((l - min) / (max - min), 0, 1);
}

/**
 * Hu moments 1 & 2 of a closed contour, computed in PURE JS from its polygon vertices via
 * Green's theorem — identical values to `cv.HuMoments(cv.moments(contour))`, but with no
 * dependency on the `moments`/`HuMoments` bindings (absent from the 4.8 reduced build, present
 * in the full build). `pts` is the flat `[x0,y0,x1,y1,…]` from `contour.data32S`.
 *
 * Only the second-order normalized central moments are needed for Hu 1 & 2:
 *   Hu1 = η20 + η02          (spread / compactness)
 *   Hu2 = (η20-η02)² + 4η11² (elongation / asymmetry)
 * Returns [0, 0] for degenerate contours (fewer than 3 points or ~zero area).
 */
export function huMoments12(pts: Int32Array | number[]): [number, number] {
  const n = pts.length >> 1;
  if (n < 3) return [0, 0];

  // Raw polygon moments (Green's theorem over the closed edge loop).
  let m00 = 0, m10 = 0, m01 = 0, m20 = 0, m11 = 0, m02 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = pts[i * 2], y0 = pts[i * 2 + 1];
    const x1 = pts[j * 2], y1 = pts[j * 2 + 1];
    const cross = x0 * y1 - x1 * y0;
    m00 += cross;
    m10 += (x0 + x1) * cross;
    m01 += (y0 + y1) * cross;
    m20 += (x0 * x0 + x0 * x1 + x1 * x1) * cross;
    m11 += (2 * x0 * y0 + x0 * y1 + x1 * y0 + 2 * x1 * y1) * cross;
    m02 += (y0 * y0 + y0 * y1 + y1 * y1) * cross;
  }
  m00 /= 2;
  if (Math.abs(m00) < 1e-6) return [0, 0];
  m10 /= 6; m01 /= 6;
  m20 /= 12; m11 /= 24; m02 /= 12;

  // Central moments about the centroid.
  const cx = m10 / m00;
  const cy = m01 / m00;
  const mu20 = m20 - cx * m10;
  const mu02 = m02 - cy * m01;
  const mu11 = m11 - cx * m01;

  // Normalized central moments (order 2 → divide by m00²), then Hu 1 & 2.
  const inv = 1 / (m00 * m00);
  const n20 = mu20 * inv;
  const n02 = mu02 * inv;
  const n11 = mu11 * inv;
  const hu1 = n20 + n02;
  const hu2 = (n20 - n02) * (n20 - n02) + 4 * n11 * n11;
  return [hu1, hu2];
}

/**
 * OpenCV contour analysis of a binary plant mask. Per leaf-sized contour: shape from Hu
 * moments, color from an HSV summary of that leaf's pixels. Returns per-leaf boxes plus
 * frame-level area-weighted shape and (whole-mask) color. `mask` is 0/255; `rgba` is the raw
 * getImageData buffer. Returns null if OpenCV isn't ready. All Mats are freed.
 */
export function analyzeLeafShape(
  mask: Uint8Array,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): ShapeResult | null {
  if (!isCvReady()) return null;
  const c = cv();
  const minArea = MIN_AREA_FRAC * w * h;

  const src = new c.Mat(h, w, c.CV_8UC1);
  src.data.set(mask);
  const contours = new c.MatVector();
  const hierarchy = new c.Mat();
  c.findContours(src, contours, hierarchy, c.RETR_EXTERNAL, c.CHAIN_APPROX_SIMPLE);

  let shapeSum = 0;
  let weightSum = 0;
  const boxes: LeafBox[] = [];

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = Math.abs(c.contourArea(cnt, false));
    if (area < minArea) {
      cnt.delete();
      continue;
    }

    // Hu moments 1 & 2 → shape signal. Prefer native cv.HuMoments when the full build exposes it
    // (verified once, cached), else the pure-JS polygon-moment fallback — identical values, and it
    // works on the reduced build that lacks the binding.
    let hu1: number;
    let hu2: number;
    if (hasNativeHu(c)) {
      try {
        const m = c.moments(cnt, false);
        const hu = new c.Mat();
        c.HuMoments(m, hu);
        hu1 = hu.data64F[0];
        hu2 = hu.data64F[1];
        hu.delete();
      } catch (err) {
        // Binding present but not actually callable (reduced build) — disable native for good and
        // use the pure-JS fallback from here on.
        console.warn('native cv.HuMoments not callable; using pure-JS Hu moments:', err);
        nativeHu = false;
        [hu1, hu2] = huMoments12(cnt.data32S);
      }
    } else {
      [hu1, hu2] = huMoments12(cnt.data32S);
    }
    const n1 = normLog(logHu(hu1), HU1_LOG_MIN, HU1_LOG_MAX);
    const n2 = normLog(logHu(hu2), HU2_LOG_MIN, HU2_LOG_MAX);
    const shape = clamp(0.65 * n1 + 0.35 * n2, 0, 1);

    // Color of this leaf's pixels (bounding-rect sampling — can bleed between overlapping
    // boxes; acceptable at this resolution, upgrade path is a per-contour mask if needed).
    const rect = c.boundingRect(cnt);
    const cs = computeColorStats(mask, rgba, w, h, rect);

    boxes.push({
      x: rect.x / w,
      y: rect.y / h,
      w: rect.width / w,
      h: rect.height / h,
      shapeSignal: shape,
      colorSignal: cs.colorSignal,
      hueDeg: cs.hueDeg,
    });
    shapeSum += shape * area;
    weightSum += area;
    cnt.delete();
  }

  src.delete();
  contours.delete();
  hierarchy.delete();

  // Frame-level color: one circular-mean pass over the whole mask (cleaner than re-deriving
  // from per-box stats).
  const frameColor = computeColorStats(mask, rgba, w, h);

  boxes.sort((a, b) => b.w * b.h - a.w * a.h);
  return {
    shapeSignal: weightSum > 0 ? shapeSum / weightSum : 0,
    colorSignal: frameColor.colorSignal,
    hueDeg: frameColor.hueDeg,
    boxes: boxes.slice(0, MAX_BOXES),
  };
}
