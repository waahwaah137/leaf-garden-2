import { clamp } from '../utils/math';
import { cv, isCvReady } from './opencvLoader';

/** A tracked leaf: bounding box in normalized [0,1] coords + its own pointiness. */
export interface LeafBox {
  x: number;
  y: number;
  w: number;
  h: number;
  spikiness: number;
}

export interface ShapeResult {
  spikiness: number; // area-weighted mean pointiness across leaves (0 round → 1 sharp)
  boxes: LeafBox[];
}

const MIN_AREA_FRAC = 0.004; // ignore specks smaller than this fraction of the frame
const MAX_BOXES = 14;

/**
 * OpenCV contour analysis of a binary plant mask. For each leaf-sized contour, pointiness
 * blends low circularity (jagged/elongated) with sharp convexity defects (spikes). Returns
 * an area-weighted mean plus per-leaf boxes for the tracking overlay. All Mats are freed.
 *
 * `mask` must be a w*h Uint8Array of 0/255. Returns null if OpenCV isn't ready.
 */
export function analyzeLeafShape(mask: Uint8Array, w: number, h: number): ShapeResult | null {
  if (!isCvReady()) return null;
  const c = cv();
  const minArea = MIN_AREA_FRAC * w * h;

  const src = new c.Mat(h, w, c.CV_8UC1);
  src.data.set(mask);
  const contours = new c.MatVector();
  const hierarchy = new c.Mat();
  c.findContours(src, contours, hierarchy, c.RETR_EXTERNAL, c.CHAIN_APPROX_SIMPLE);

  let scoreSum = 0;
  let weightSum = 0;
  const boxes: LeafBox[] = [];

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = Math.abs(c.contourArea(cnt, false));
    if (area < minArea) {
      cnt.delete();
      continue;
    }
    const perim = c.arcLength(cnt, true);
    const circularity = perim > 0 ? clamp((4 * Math.PI * area) / (perim * perim), 0, 1) : 0;

    let defectScore = 0;
    try {
      const hull = new c.Mat();
      c.convexHull(cnt, hull, false, false); // hull as point indices
      if (hull.rows > 3) {
        const defects = new c.Mat();
        c.convexityDefects(cnt, hull, defects);
        const depthThresh = 0.02 * Math.sqrt(area);
        let deep = 0;
        for (let d = 0; d < defects.rows; d++) {
          const depth = defects.data32S[d * 4 + 3] / 256; // fixed-point 1/256 px
          if (depth > depthThresh) deep++;
        }
        defectScore = clamp(deep / 8, 0, 1); // ~8 sharp indentations → fully spiky
        defects.delete();
      }
      hull.delete();
    } catch {
      // convexityDefects throws on degenerate/self-intersecting contours — ignore.
    }

    const spik = clamp(0.6 * (1 - circularity) + 0.4 * defectScore, 0, 1);
    const rect = c.boundingRect(cnt);
    boxes.push({ x: rect.x / w, y: rect.y / h, w: rect.width / w, h: rect.height / h, spikiness: spik });
    scoreSum += spik * area;
    weightSum += area;
    cnt.delete();
  }

  src.delete();
  contours.delete();
  hierarchy.delete();

  boxes.sort((a, b) => b.w * b.h - a.w * a.h);
  return {
    spikiness: weightSum > 0 ? scoreSum / weightSum : 0,
    boxes: boxes.slice(0, MAX_BOXES),
  };
}
