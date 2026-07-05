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

    // Hu moments 1 & 2 → shape signal.
    const m = c.moments(cnt, false);
    const hu = new c.Mat();
    c.HuMoments(m, hu);
    const n1 = normLog(logHu(hu.data64F[0]), HU1_LOG_MIN, HU1_LOG_MAX);
    const n2 = normLog(logHu(hu.data64F[1]), HU2_LOG_MIN, HU2_LOG_MAX);
    hu.delete();
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
