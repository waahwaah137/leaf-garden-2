// The Cubbon audio-landmark map: an on-brand dark, NON-GEO map of the park. The unique sounds you've
// collected are pinned to the six landmarks; a pin is PROXIMITY-LOCKED — you must be physically at its
// landmark to unlock + retrieve it. GPS is used only transiently (map/proximity.ts); pins carry a
// landmark id, never coordinates. `#unlock` in the URL unlocks everything for off-site testing.

import { CUBBON_LANDMARKS, landmarkById, type Landmark } from '../map/landmarks';
import { buildCubbonMapSvg } from '../map/cubbonMapArt';
import { watch as watchProximity, stopWatch, forceUnlock, type Proximity } from '../map/proximity';
import { listPresets, savePreset, deletePreset } from '../presets/presetStore';
import type { Preset, PresetConfig } from '../presets/preset';
import { showToast } from './toast';

let root: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let fieldEl: HTMLElement | null = null;
let nodesEl: HTMLElement | null = null;
let detailEl: HTMLElement | null = null;
let unplacedEl: HTMLElement | null = null;

let onApplyCfg: ((c: PresetConfig) => void) | null = null;
let presets: Preset[] = [];
let prox: Proximity | null = null;
let openLandmarkId: string | null = null; // which landmark's detail is showing
let placingId: string | null = null; // an unplaced pin selected for tap-to-place

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

export function initCubbonMap(apply: (c: PresetConfig) => void): void {
  onApplyCfg = apply;
}

function isUnlocked(id: string): boolean {
  if (forceUnlock()) return true;
  return !!prox && prox.unlocked && prox.landmarkId === id;
}

const pinsAt = (id: string): Preset[] => presets.filter((p) => p.place?.landmarkId === id);
const unplaced = (): Preset[] => presets.filter((p) => !p.place);

function build(): void {
  if (root) return;
  root = el('div', 'cubbon-map hidden');

  const close = el('button', 'about-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close map');
  close.textContent = '×';
  close.addEventListener('click', () => closeCubbonMap());

  statusEl = el('p', 'cubbon-map__status');
  fieldEl = el('div', 'cubbon-map__field');
  // The illustrated, non-geo Cubbon map, drawn as a scalable SVG (persistent art layer). The
  // interactive markers live in a separate layer so re-rendering them never wipes the art.
  const art = el('div', 'cubbon-map__art');
  art.innerHTML = buildCubbonMapSvg();
  nodesEl = el('div', 'cubbon-map__nodes');
  fieldEl.append(art, nodesEl);
  detailEl = el('div', 'cubbon-map__detail hidden');
  unplacedEl = el('div', 'cubbon-map__unplaced hidden');

  root.append(close, statusEl, fieldEl, detailEl, unplacedEl);
  document.body.appendChild(root);
}

function renderField(): void {
  const layer = nodesEl;
  if (!layer) return;
  layer.innerHTML = '';

  // The illustrated map already draws + labels each landmark; we only overlay glowing markers (with a
  // pin count) as tap targets, and pulse the one you're standing at.
  for (const l of CUBBON_LANDMARKS) {
    const n = pinsAt(l.id).length;
    const node = el('button', 'map-node');
    node.type = 'button';
    node.style.left = `${l.x * 100}%`;
    node.style.top = `${l.y * 100}%`;
    node.setAttribute('aria-label', l.label);
    node.classList.toggle('has-pins', n > 0);
    node.classList.toggle('unlocked', isUnlocked(l.id) && n > 0);
    node.classList.toggle('here', !!prox && prox.landmarkId === l.id);

    node.append(el('span', 'map-node__dot'));
    if (n > 0) {
      const badge = el('span', 'map-node__badge');
      badge.textContent = String(n);
      node.appendChild(badge);
    }
    node.addEventListener('click', () => onLandmarkTap(l));
    layer.appendChild(node);
  }
}

function onLandmarkTap(l: Landmark): void {
  // Tap-to-place mode: assign the selected unplaced pin to this landmark.
  if (placingId) {
    const p = presets.find((x) => x.id === placingId);
    placingId = null;
    if (p) {
      p.place = { landmarkId: l.id };
      void savePreset(p).then(() => {
        showToast(`placed at ${l.label}`);
        return refresh();
      });
    }
    return;
  }
  openLandmarkId = l.id;
  renderDetail();
}

function renderDetail(): void {
  if (!detailEl) return;
  if (!openLandmarkId) {
    detailEl.classList.add('hidden');
    return;
  }
  const l = landmarkById(openLandmarkId);
  if (!l) return;
  const pins = pinsAt(l.id);
  detailEl.classList.remove('hidden');
  detailEl.innerHTML = '';

  const head = el('h3', 'cubbon-map__detail-title');
  head.textContent = l.label;
  detailEl.appendChild(head);

  if (!isUnlocked(l.id)) {
    const locked = el('p', 'cubbon-map__locked');
    const dist = prox && prox.landmarkId === l.id ? ` · ${Math.round(prox.distanceM)} m away` : '';
    locked.textContent = pins.length
      ? `Locked — go to ${l.label} to unlock its ${pins.length} sound${pins.length > 1 ? 's' : ''}${dist}.`
      : `No sounds here yet.${dist}`;
    detailEl.appendChild(locked);
    return;
  }

  if (pins.length === 0) {
    const empty = el('p', 'cubbon-map__locked');
    empty.textContent = 'No sounds here yet — collect one and pin it.';
    detailEl.appendChild(empty);
    return;
  }

  for (const p of pins) {
    const row = el('div', 'pinned-item');
    row.style.setProperty('--pin-hue', String(p.hueDeg));

    const play = el('button', 'pinned-item__play');
    play.type = 'button';
    play.append(el('span', 'pinned-item__dot'));
    const nm = el('span', 'pinned-item__name');
    nm.textContent = p.name;
    play.append(nm);
    play.addEventListener('click', () => {
      onApplyCfg?.(p.config);
      showToast(`retrieved · ${p.name}`);
      closeCubbonMap();
    });

    const del = el('button', 'pinned-item__del');
    del.type = 'button';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete ${p.name}`);
    del.addEventListener('click', () => void deletePreset(p.id).then(refresh));

    row.append(play, del);
    detailEl.appendChild(row);
  }
}

function renderUnplaced(): void {
  if (!unplacedEl) return;
  const up = unplaced();
  if (up.length === 0) {
    unplacedEl.classList.add('hidden');
    unplacedEl.innerHTML = '';
    return;
  }
  unplacedEl.classList.remove('hidden');
  unplacedEl.innerHTML = '';

  const label = el('p', 'cubbon-map__unplaced-label');
  label.textContent = placingId ? 'Tap a landmark to place it' : 'Unplaced sounds — tap one, then a landmark';
  unplacedEl.appendChild(label);

  const chips = el('div', 'cubbon-map__chips');
  for (const p of up) {
    const chip = el('button', 'map-chip');
    chip.type = 'button';
    chip.style.setProperty('--pin-hue', String(p.hueDeg));
    chip.textContent = p.name;
    chip.classList.toggle('sel', placingId === p.id);
    chip.addEventListener('click', () => {
      placingId = placingId === p.id ? null : p.id;
      renderUnplaced();
      renderField();
    });
    chips.appendChild(chip);
  }
  unplacedEl.appendChild(chips);
}

function renderStatus(): void {
  if (!statusEl) return;
  if (forceUnlock()) {
    statusEl.textContent = 'All landmarks unlocked (test mode). Tap one to hear its sounds.';
    return;
  }
  if (!prox) {
    statusEl.textContent = 'Finding you… landmarks unlock when you reach them.';
    return;
  }
  statusEl.textContent = prox.unlocked
    ? `You're at ${prox.label} — its sounds are unlocked.`
    : `Nearest: ${prox.label}, ${Math.round(prox.distanceM)} m away.`;
}

async function refresh(): Promise<void> {
  try {
    presets = await listPresets();
  } catch (err) {
    console.warn('could not read pins for the map:', err);
    presets = [];
  }
  renderStatus();
  renderField();
  renderDetail();
  renderUnplaced();
}

export function openCubbonMap(): void {
  build();
  root?.classList.remove('hidden');
  openLandmarkId = null;
  placingId = null;
  watchProximity((p) => {
    prox = p;
    renderStatus();
    renderField();
    renderDetail();
  });
  void refresh();
}

export function closeCubbonMap(): void {
  stopWatch();
  root?.classList.add('hidden');
}
