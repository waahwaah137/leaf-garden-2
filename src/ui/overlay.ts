import { clamp, lerp } from '../utils/math';
import { onNote } from '../audio/leafscape';
import type { LeafSensor } from '../sensors/leafSensor';

// Draws the leaf-tracking overlay as crisp vector boxes + corner brackets in the palette,
// so it reads well on a screen recording. Boxes are colour-graded teal(round)→pink(sharp),
// the pointiest box is accented yellow, and everything pulses gently on note triggers.

const TEAL: [number, number, number] = [0x00, 0xe0, 0xba];
const PINK: [number, number, number] = [0xff, 0x34, 0x83];
const YELLOW = '#FFCF00';

// Note-driven pulse (0..1), bumped on triggers and decayed each frame.
let pulse = 0;
onNote((e) => {
  pulse = clamp(pulse + (e.voice === 'sharp' ? 0.5 : 0.3) * e.velocity + 0.15, 0, 1);
});

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(lerp(a[0], b[0], t));
  const g = Math.round(lerp(a[1], b[1], t));
  const bl = Math.round(lerp(a[2], b[2], t));
  return `rgb(${r}, ${g}, ${bl})`;
}

function rgba(a: [number, number, number], b: [number, number, number], t: number, alpha: number): string {
  const r = Math.round(lerp(a[0], b[0], t));
  const g = Math.round(lerp(a[1], b[1], t));
  const bl = Math.round(lerp(a[2], b[2], t));
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}

// --- Tap ripples: thin concentric rings that expand and fade at the touch point ----------
interface Ripple {
  x: number; // normalized 0..1
  y: number;
  start: number; // performance.now() ms
  spik: number; // 0 round .. 1 sharp — sets colour
}
const ripples: Ripple[] = [];
const RIPPLE_MS = 750;

/** Spawns a ripple at a normalized point, coloured by the tapped leaf's pointiness. */
export function addRipple(nx: number, ny: number, spik: number): void {
  ripples.push({ x: nx, y: ny, start: performance.now(), spik: clamp(spik, 0, 1) });
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
      ctx.strokeStyle = rgba(TEAL, PINK, r.spik, alpha);
      ctx.stroke();
    }
  }
}

function drawFocus(ctx: CanvasRenderingContext2D, w: number, h: number, focus: FocusMarker): void {
  if (focus.strength <= 0.02) return;
  const cx = focus.x * w;
  const cy = focus.y * h;
  const radius = Math.min(w, h) * 0.05 * (0.7 + focus.strength * 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(TEAL, PINK, 0.5, focus.strength * 0.7);
  ctx.stroke();
  // small centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = rgba(TEAL, PINK, 0.5, focus.strength * 0.9);
  ctx.fill();
}

export interface FocusMarker {
  x: number;
  y: number;
  strength: number;
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

/** Renders the overlay onto `ctx` (sized w×h): tracking boxes (or the pixel fallback), plus
 *  tap ripples and the sustained-focus marker on top. */
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
    if (focus) drawFocus(ctx, w, h, focus);
    drawRipples(ctx, w, h, performance.now());
    return;
  }

  let maxSpik = -1;
  let maxIdx = -1;
  boxes.forEach((b, i) => {
    if (b.spikiness > maxSpik) {
      maxSpik = b.spikiness;
      maxIdx = i;
    }
  });

  ctx.lineWidth = 2.25;
  ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.lineJoin = 'round';

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const x = b.x * w;
    const y = b.y * h;
    const bw = b.w * w;
    const bh = b.h * h;
    const color = i === maxIdx ? YELLOW : mix(TEAL, PINK, b.spikiness);

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

    // Pointiness tag.
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    const ty = y - 4 > 10 ? y - 4 : y + bh + 13;
    ctx.fillText(b.spikiness.toFixed(2), x + 2, ty);
  }
  ctx.globalAlpha = 1;

  if (focus) drawFocus(ctx, w, h, focus);
  drawRipples(ctx, w, h, performance.now());
}
