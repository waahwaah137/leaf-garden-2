// The small random button — a fingerprint-spot dial at lower-centre (replaces the full-screen
// fidget wheel). Tap it to roll a curated random sound (applies live); a teal cooldown ring sweeps
// over a few seconds before it re-arms. Animated sparkles in the centre; a fidget of the phone makes
// it pulse. A little location-pin below pins the current sound. Rebuilt from RandomButton_0.svg's
// palette (teal #01ddcd, purple #701065, pink #f93671, yellow #fec402) as clean inline SVG.

import { rollSpecimen, type Specimen } from '../presets/preset';

export interface RandomButtonCallbacks {
  bankIds: string[];
  onApply: (s: Specimen) => void; // a roll → apply the sound live
  onPin: (s: Specimen) => void; // the pin below → keep the current sound
}

const SVGNS = 'http://www.w3.org/2000/svg';
const COOLDOWN_MS = 2800; // ring sweep after each roll before it re-arms
const RING_R = 33;
const RING_C = 2 * Math.PI * RING_R; // circumference

let cb: RandomButtonCallbacks | null = null;
let root: HTMLElement | null = null;
let dial: HTMLButtonElement | null = null;
let prog: SVGCircleElement | null = null;
let nameEl: HTMLElement | null = null;
let current: Specimen | null = null;
let armed = true;
let seed = Math.floor(Math.random() * 1e9);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  return n;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// Four four-point sparkles (two big, two small), matching the reference.
function buildStars(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 48 48', fill: 'currentColor' });
  const star = (cx: number, cy: number, r: number): SVGElement => {
    const k = r * 0.34; // waist of the concave star
    const d = `M${cx} ${cy - r} C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy} C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r} C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy} C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r} Z`;
    const p = svg('path', { d, class: 'random-btn__star' });
    return p;
  };
  s.append(star(19, 20, 11), star(32, 30, 8), star(33, 15, 5), star(15, 33, 4));
  return s;
}

// Pink-ringed yellow location pin with a plus (the "pin to a place" mark).
function buildPin(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 34 34' });
  s.append(svg('circle', { cx: '17', cy: '17', r: '15.5', fill: 'none', stroke: '#f93671', 'stroke-width': '2' }));
  // teardrop pin
  s.append(
    svg('path', {
      d: 'M17 7 C13.7 7 11 9.7 11 13 C11 17.2 17 24 17 24 C17 24 23 17.2 23 13 C23 9.7 20.3 7 17 7 Z',
      fill: '#fec402',
    }),
  );
  // plus inside
  s.append(svg('circle', { cx: '17', cy: '13', r: '3.4', fill: 'none', stroke: '#010101', 'stroke-width': '1.4' }));
  s.append(svg('path', { d: 'M17 11.2 V14.8 M15.2 13 H18.8', stroke: '#010101', 'stroke-width': '1.4', 'stroke-linecap': 'round' }));
  return s;
}

function showName(name: string): void {
  if (!nameEl) return;
  nameEl.textContent = name;
  nameEl.classList.add('show');
}

function roll(): void {
  if (!armed || !cb || !dial || !prog) return;
  const s = rollSpecimen(seed++, cb.bankIds);
  current = s;
  cb.onApply(s);
  showName(s.name);

  // sparkle burst + haptic
  dial.classList.remove('rolled');
  void dial.offsetWidth;
  dial.classList.add('rolled');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (navigator as any).vibrate?.(10);

  // Cooldown: teal ring drains to empty, then refills over COOLDOWN_MS; disarmed until full.
  armed = false;
  dial.disabled = true;
  prog.style.transition = 'none';
  prog.style.strokeDashoffset = String(RING_C); // empty
  void prog.getBoundingClientRect();
  prog.style.transition = `stroke-dashoffset ${COOLDOWN_MS}ms linear`;
  prog.style.strokeDashoffset = '0'; // fill = re-armed
  window.setTimeout(() => {
    armed = true;
    if (dial) dial.disabled = false;
  }, COOLDOWN_MS);
}

/** Builds the button + pin and mounts them (lower-centre). */
export function initRandomButton(stage: HTMLElement, callbacks: RandomButtonCallbacks): void {
  if (root) return;
  cb = callbacks;

  root = el('div', 'random-btn');

  nameEl = el('div', 'random-btn__name');
  nameEl.setAttribute('aria-hidden', 'true');

  dial = el('button', 'random-btn__dial');
  dial.type = 'button';
  dial.setAttribute('aria-label', 'Roll a random sound');

  const ring = svg('svg', { class: 'random-btn__ring', viewBox: '0 0 72 72' });
  ring.append(svg('circle', { class: 'random-btn__track', cx: '36', cy: '36', r: String(RING_R) }));
  prog = svg('circle', {
    class: 'random-btn__prog',
    cx: '36',
    cy: '36',
    r: String(RING_R),
    'stroke-dasharray': String(RING_C),
    'stroke-dashoffset': '0',
  }) as SVGCircleElement;
  ring.append(prog);

  const stars = el('span', 'random-btn__stars');
  stars.append(buildStars());

  dial.append(ring, stars);
  dial.addEventListener('click', roll);

  const pin = el('button', 'pin-btn');
  pin.type = 'button';
  pin.setAttribute('aria-label', 'Pin this sound');
  pin.append(buildPin());
  pin.addEventListener('click', () => {
    if (current) cb?.onPin(current);
  });

  root.append(nameEl, dial, pin);
  stage.appendChild(root);
}

/** A brief attention pulse (driven by the fidget sensor when you're bored + wiggling the phone). */
export function pulseRandomButton(): void {
  if (!root) return;
  root.classList.remove('pulse');
  void root.offsetWidth;
  root.classList.add('pulse');
}

/** Hide the button while the controls drawer is open (they'd otherwise overlap). */
export function setRandomButtonHidden(hidden: boolean): void {
  root?.classList.toggle('rb-hidden', hidden);
}
