export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Shortest signed distance from `b` to `a` on a circle, in degrees, range [0, 180]. */
export function angularDistance(a: number, b: number): number {
  const d = (((a - b + 180) % 360) + 360) % 360 - 180;
  return Math.abs(d);
}

/**
 * Raised-cosine falloff: 1 at distance 0, 0 at distance >= width, smooth in between.
 * With width equal to the spacing between evenly-distributed points on a circle,
 * the weights across all points sum to 1 at every angle.
 */
export function raisedCosineFalloff(distance: number, width: number): number {
  if (distance >= width) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * distance) / width));
}

/** Exponential moving average step: alpha closer to 1 reacts faster. */
export function emaStep(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha;
}

/**
 * EMA for circular quantities (e.g. compass heading in degrees, 0-360),
 * smoothed in unit-vector space so it doesn't sweep the "wrong way" across the 0/360 seam.
 */
export class AngleEma {
  private x: number;
  private y: number;
  private initialized = false;

  constructor(private readonly alpha: number) {
    this.x = 1;
    this.y = 0;
  }

  update(degrees: number): number {
    const rad = (degrees * Math.PI) / 180;
    const nx = Math.cos(rad);
    const ny = Math.sin(rad);
    if (!this.initialized) {
      this.x = nx;
      this.y = ny;
      this.initialized = true;
    } else {
      this.x = emaStep(this.x, nx, this.alpha);
      this.y = emaStep(this.y, ny, this.alpha);
    }
    const angle = (Math.atan2(this.y, this.x) * 180) / Math.PI;
    return (angle + 360) % 360;
  }
}
