import { clamp, lerp } from '../utils/math';

export interface ColorStats {
  /** 0-1 richness/saturation-ish measure of the plant pixels' color. */
  colorSignal: number;
  /** Circular-mean hue of the plant pixels, in degrees 0-360 (green ~120 fallback). */
  hueDeg: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Summarizes the color of the masked (plant) pixels — optionally within `rect`. Hue is a
 * *circular* mean: never average hue as a scalar (0° and 359° would cancel to 180°); instead
 * accumulate weighted unit vectors and recover the angle via atan2 at the end. Color survives
 * camera blur far better than fine edge detail, which is why it's a useful signal at 80×60.
 *
 * `mask` is a w*h array where any truthy value marks a plant pixel (works with 0/1 or 0/255).
 * `rgba` is the raw getImageData buffer (length w*h*4).
 */
export function computeColorStats(
  mask: Uint8Array,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  rect?: Rect,
): ColorStats {
  const x0 = rect ? Math.max(0, rect.x) : 0;
  const y0 = rect ? Math.max(0, rect.y) : 0;
  const x1 = rect ? Math.min(w, rect.x + rect.width) : w;
  const y1 = rect ? Math.min(h, rect.y + rect.height) : h;

  let sumX = 0;
  let sumY = 0;
  let sumS = 0;
  let sumV = 0;
  let count = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const i = p * 4;
      const r = rgba[i] / 255;
      const g = rgba[i + 1] / 255;
      const b = rgba[i + 2] / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const v = max;
      const s = max <= 1e-6 ? 0 : d / max;

      let hRad = 0;
      if (d > 1e-6) {
        let hh: number;
        if (max === r) hh = ((g - b) / d) % 6;
        else if (max === g) hh = (b - r) / d + 2;
        else hh = (r - g) / d + 4;
        hh *= 60;
        if (hh < 0) hh += 360;
        hRad = (hh * Math.PI) / 180;
      }

      const weight = s * v; // vivid pixels dominate the hue estimate
      sumX += weight * Math.cos(hRad);
      sumY += weight * Math.sin(hRad);
      sumS += s;
      sumV += v;
      count++;
    }
  }

  if (count === 0) return { colorSignal: 0, hueDeg: 120 };

  const meanS = sumS / count;
  const meanV = sumV / count;
  const hueDeg = sumX === 0 && sumY === 0 ? 120 : (((Math.atan2(sumY, sumX) * 180) / Math.PI) + 360) % 360;
  const colorSignal = clamp(meanS * lerp(0.7, 1.3, meanV), 0, 1);
  return { colorSignal, hueDeg };
}
