// A subtle, auto-fading poem overlay. Non-modal and `pointer-events: none` (set in CSS) so taps
// pass through to keep playing the leaves. Matches the calm aesthetic — it drifts in, holds, fades.

let el: HTMLElement | null = null;
let hideTimer: number | undefined;

const HOLD_MS = 7000; // how long a poem lingers before auto-fading

export function initPoemOverlay(): void {
  el = document.getElementById('poem');
}

/** Fades a poem in (lines stacked), tinted by the leaf hue, then auto-fades after HOLD_MS. */
export function showPoem(lines: string[], hueDeg = 120): void {
  if (!el || lines.length === 0) return;
  el.innerHTML = '';
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'poem-line';
    div.textContent = line;
    el.appendChild(div);
  }
  // Soft hue-matched glow so the words feel of-a-piece with the plant on screen.
  el.style.setProperty('--poem-glow', `hsla(${Math.round(hueDeg)}, 70%, 62%, 0.55)`);
  el.classList.remove('hidden');

  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => hidePoem(), HOLD_MS);
}

export function hidePoem(): void {
  if (!el) return;
  el.classList.add('hidden');
  window.clearTimeout(hideTimer);
}
