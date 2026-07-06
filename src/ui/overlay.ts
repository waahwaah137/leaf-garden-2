import { clamp } from '../utils/math';
import { onNote } from '../audio/leafscape';
import type { LeafSensor } from '../sensors/leafSensor';

// Draws the leaf-tracking overlay as crisp vector boxes + corner brackets, so it reads well on
// a screen recording. Each box is tinted with the leaf's own detected hue; the largest tracked
// leaf is accented yellow, and everything pulses gently on note triggers.

const YELLOW = '#FFCF00';

/** A colour from a detected hue (degrees). Saturation/lightness fixed for a vivid, legible line. */
function hueToCss(hueDeg: number, alpha = 1): string {
  return `hsla(${Math.round(hueDeg)}, 82%, 58%, ${alpha})`;
}

// Note-driven pulse (0..1), bumped on triggers and decayed each frame.
let pulse = 0;
onNote((e) => {
  pulse = clamp(pulse + (e.voice === 'sharp' ? 0.5 : 0.3) * e.velocity + 0.15, 0, 1);
});

// --- Tap ripples: thin concentric rings that expand and fade at the touch point ----------
interface Ripple {
  x: number; // normalized 0..1
  y: number;
  start: number; // performance.now() ms
  hue: number; // colour = the tapped leaf's hue
}
const ripples: Ripple[] = [];
const RIPPLE_MS = 750;

/** Spawns a ripple at a normalized point, coloured by the tapped leaf's hue. */
export function addRipple(nx: number, ny: number, hue: number): void {
  ripples.push({ x: nx, y: ny, start: performance.now(), hue });
}

// --- Drag trail: a glowing polyline that follows the finger and fades behind it ----------
interface TrailPoint {
  x: number; // normalized 0..1
  y: number;
  hue: number;
  start: number; // performance.now() ms
}
const trail: TrailPoint[] = [];
const TRAIL_MS = 600; // how long a point lingers before it fades out

/** Appends a point to the drag trail, coloured by the dragged leaf's hue. */
export function addTrailPoint(nx: number, ny: number, hue: number): void {
  trail.push({ x: nx, y: ny, hue, start: performance.now() });
}

function drawTrail(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  // Drop expired points from the front.
  while (trail.length > 0 && now - trail[0].start > TRAIL_MS) trail.shift();
  if (trail.length < 2) return;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Draw each segment as its own stroke so alpha/width can ramp along the trail's age
  // (older = fainter/thinner, freshest point brightest under the finger).
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const age = (now - b.start) / TRAIL_MS; // 0 = fresh, 1 = about to vanish
    const alpha = (1 - age) * 0.85;
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.lineWidth = 2 + (1 - age) * 4;
    ctx.strokeStyle = hueToCss(b.hue, alpha);
    ctx.stroke();
  }
}

function drawRipples(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    const t = (now - r.start) / RIPPLE_MS;
    if (t >= 1) {
      ripples.splice(i, 1);
      continue;
    }
    const cx = r.x * w;
    const cy = r.y * h;
    const maxR = Math.min(w, h) * 0.22;
    // three offset rings for a layered "sonar" look
    for (let k = 0; k < 3; k++) {
      const tk = t - k * 0.14;
      if (tk <= 0) continue;
      const radius = tk * maxR + 4;
      const alpha = (1 - tk) * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = hueToCss(r.hue, alpha);
      ctx.stroke();
    }
  }
}

export interface FocusMarker {
  x: number;
  y: number;
  strength: number;
  hue?: number;
}

function drawFocus(ctx: CanvasRenderingContext2D, w: number, h: number, focus: FocusMarker): void {
  if (focus.strength <= 0.02) return;
  const cx = focus.x * w;
  const cy = focus.y * h;
  const hue = focus.hue ?? 120;
  const radius = Math.min(w, h) * 0.05 * (0.7 + focus.strength * 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = hueToCss(hue, focus.strength * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = hueToCss(hue, focus.strength * 0.9);
  ctx.fill();
}

function corners(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, len: number): void {
  const L = Math.min(len, w / 2, h / 2);
  ctx.beginPath();
  // top-left
  ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
  // top-right
  ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
  // bottom-right
  ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
  // bottom-left
  ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
  ctx.stroke();
}

/** Renders the overlay onto `ctx` (sized w×h): hue-tinted tracking boxes (or the pixel
 *  fallback), plus tap ripples and the sustained-focus marker on top. */
export function drawTrackingOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  leaf: LeafSensor,
  focus?: FocusMarker,
): void {
  pulse *= 0.88; // decay
  ctx.clearRect(0, 0, w, h);

  const boxes = leaf.getLeafBoxes();
  if (boxes.length === 0) {
    // No contour tracking (OpenCV not ready / no plant) — show the pixel mask+edge overlay.
    leaf.renderOverlay(ctx, w, h);
    drawTrail(ctx, w, h, performance.now());
    if (focus) drawFocus(ctx, w, h, focus);
    drawRipples(ctx, w, h, performance.now());
    return;
  }

  ctx.lineWidth = 2.25;
  ctx.lineJoin = 'round';

  // boxes are area-sorted (largest first) — accent the largest leaf in yellow.
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const x = b.x * w;
    const y = b.y * h;
    const bw = b.w * w;
    const bh = b.h * h;
    const color = i === 0 ? YELLOW : hueToCss(b.hueDeg);

    // Thin bounding box.
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyCtx = ctx as any;
    if (typeof anyCtx.roundRect === 'function') {
      ctx.beginPath();
      anyCtx.roundRect(x, y, bw, bh, 6);
      ctx.stroke();
    } else {
      ctx.strokeRect(x, y, bw, bh);
    }

    // Corner-bracket reticle (brighter, grows slightly with the pulse).
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 3.2;
    corners(ctx, x, y, bw, bh, 10 + pulse * 6);
    ctx.lineWidth = 2.25;
  }
  ctx.globalAlpha = 1;

  drawTrail(ctx, w, h, performance.now());
  if (focus) drawFocus(ctx, w, h, focus);
  drawRipples(ctx, w, h, performance.now());
}
