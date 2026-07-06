// Generative keepsake art. Phase 2 ships a "walk swatch": a golden-angle spiral of glowing dots,
// one per hue sample, in chronological order — an abstract memory of the walk's colours. Phase 3
// replaces this with the journey trail sigil (same data-URL contract, so nothing else changes).

import type { Keepsake } from '../storage/herbariumStore';

// Same family as the rest of the UI (body font stack).
const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BG = '#0b1410';

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create 2D context for keepsake art');
  return { canvas, ctx };
}

/** Renders the walk's hue trail as a spiral of soft glowing dots. Returns a PNG data URL. */
export function renderWalkArt(hues: number[], size = 640): string {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.4;

  // Faint guide rings, like growth rings.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (const f of [0.5, 0.78, 1.04]) {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
    ctx.stroke();
  }

  const pts = hues.length > 0 ? hues : [120];
  const golden = Math.PI * (3 - Math.sqrt(5)); // golden angle — organic phyllotaxis spacing
  for (let i = 0; i < pts.length; i++) {
    const t = pts.length > 1 ? i / (pts.length - 1) : 0.5;
    const r = maxR * Math.sqrt(t); // sqrt keeps area density even, like a sunflower head
    const a = i * golden - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    const dot = size * 0.026 * (1.25 - 0.5 * t); // early samples slightly larger (the walk's start)
    const glow = ctx.createRadialGradient(x, y, 0, x, y, dot * 2.6);
    glow.addColorStop(0, `hsla(${Math.round(pts[i])}, 75%, 62%, 0.95)`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, dot * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load keepsake art image'));
    img.src = src;
  });
}

function statsLine(k: Keepsake): string {
  const mins = Math.max(1, Math.round(k.minutes));
  return `${mins} min · ${k.voices} leaf-voice${k.voices === 1 ? '' : 's'} · ${k.phase}`;
}

/** Composes the shareable card PNG: art + poem + soft stats. */
export async function renderShareCard(k: Keepsake): Promise<HTMLCanvasElement> {
  const W = 720;
  const H = 960;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Wordmark.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0, 224, 186, 0.85)';
  ctx.font = `600 20px ${UI_FONT}`;
  ctx.fillText('L E A F   G A R D E N', W / 2, 56);

  // The walk art.
  const img = await loadImage(k.art);
  const artSize = 540;
  ctx.drawImage(img, (W - artSize) / 2, 92, artSize, artSize);

  // Poem lines (same UI font, italic — matching the on-screen poem overlay).
  ctx.fillStyle = 'rgba(244, 255, 249, 0.95)';
  ctx.font = `italic 26px ${UI_FONT}`;
  let y = 700;
  for (const line of k.poem) {
    ctx.fillText(line, W / 2, y);
    y += 40;
  }

  // Soft stats + date.
  ctx.fillStyle = 'rgba(143, 183, 172, 0.9)';
  ctx.font = `18px ${UI_FONT}`;
  ctx.fillText(statsLine(k), W / 2, y + 26);
  ctx.fillStyle = 'rgba(143, 183, 172, 0.6)';
  ctx.font = `15px ${UI_FONT}`;
  ctx.fillText(
    new Date(k.endedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    W / 2,
    y + 54,
  );

  return canvas;
}
