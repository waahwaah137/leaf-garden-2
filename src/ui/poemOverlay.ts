// A subtle poem overlay, up-top and left-aligned like a stray line of code. Non-modal and
// `pointer-events: none` (CSS) so taps still play the leaves. A single CSS animation owns the whole
// lifecycle: fade in while rising a few px → hold → rise again and fade out.
//
// Each poem is wrapped in a receding diamond of abstract coded glyphs (Braille dot-patterns — a
// tactile cipher) that taper 4 → 2 → 1 above and below and fade outward, hue-tinted to the leaf. It
// should feel like a private transmission decoded just for you. The glyph *density* reflects the
// leaf's form (round → sparse, jagged → dense), so there's a non-verbal signal in the code itself.

let el: HTMLElement | null = null;

// Two density bands of Braille patterns (U+2800–U+28FF): sparse (few dots) → dense (many).
const SPARSE = ['⠂', '⠄', '⠆', '⠉', '⠒', '⠔', '⠋', '⠌', '⠑', '⠊'];
const DENSE = ['⠿', '⡿', '⣟', '⣷', '⣿', '⡇', '⢸', '⣇', '⣾', '⣻'];

// Rows above and below the text, given as glyph counts (nearest the text first).
const FRAME_COUNTS = [4, 2, 1];

export function initPoemOverlay(): void {
  el = document.getElementById('poem');
}

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}

/** A row of `n` abstract glyphs; denser as the leaf gets more jagged. */
function glyphRow(n: number, shape: number): string {
  const denseChance = 0.25 + shape * 0.55;
  let s = '';
  for (let i = 0; i < n; i++) s += Math.random() < denseChance ? pick(DENSE) : pick(SPARSE);
  return s;
}

/** Builds a top/bottom frame of receding glyph rows. `reversed` gives the top (1 → 4 downward). */
function buildFrame(shape: number, reversed: boolean): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'poem-frame';
  frame.setAttribute('aria-hidden', 'true'); // decorative cipher — screen readers read the words
  const counts = reversed ? [...FRAME_COUNTS].reverse() : FRAME_COUNTS;
  for (const n of counts) {
    const row = document.createElement('div');
    // Nearest-to-text row (count 4) is tier 1 (brightest); the lone glyph is tier 3 (faintest).
    const tier = n >= 4 ? 1 : n === 2 ? 2 : 3;
    row.className = `poem-gline poem-gline--${tier}`;
    row.textContent = glyphRow(n, shape);
    frame.appendChild(row);
  }
  return frame;
}

/**
 * Plays a poem: a receding glyph frame above, the left-aligned lines, and a matching frame below —
 * the CSS `poem-cycle` animation runs the full reveal/hold/fade. Re-triggers on each new poem.
 * `shape` (0 round → 1 jagged) sets the glyph density; colour is white (styled in CSS).
 */
export function showPoem(lines: string[], shape = 0.4): void {
  if (!el || lines.length === 0) return;

  el.innerHTML = '';
  el.appendChild(buildFrame(shape, true)); // top: 1 → 2 → 4 downward

  const body = document.createElement('div');
  body.className = 'poem-body';
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'poem-line';
    div.textContent = line;
    body.appendChild(div);
  }
  el.appendChild(body);

  el.appendChild(buildFrame(shape, false)); // bottom: 4 → 2 → 1 downward

  // Restart the animation from the top (remove → force reflow → re-add).
  el.classList.remove('play');
  void el.offsetWidth;
  el.classList.add('play');
}

export function hidePoem(): void {
  if (!el) return;
  el.classList.remove('play'); // back to the base (opacity 0) state
}
