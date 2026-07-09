// The pinned-sounds list that lives inside the controls drawer, revealed by the "pins" pill.
// Each row: a hue dot + the whimsical name (tap to replay the sound) + a small × to delete it.

import { deletePreset, listPresets } from '../presets/presetStore';
import type { PresetConfig } from '../presets/preset';

let panel: HTMLElement | null = null;
let onApply: ((cfg: PresetConfig) => void) | null = null;

export function initPinnedDrawer(container: HTMLElement, apply: (cfg: PresetConfig) => void): void {
  panel = container;
  onApply = apply;
}

export async function refreshPinnedDrawer(): Promise<void> {
  if (!panel) return;
  let presets;
  try {
    presets = await listPresets();
  } catch (err) {
    console.warn('could not read pinned sounds:', err);
    return;
  }

  panel.innerHTML = '';
  if (presets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'pins-empty';
    empty.textContent = 'No pinned sounds yet — roll one and tap the pin.';
    panel.appendChild(empty);
    return;
  }

  for (const p of presets) {
    const row = document.createElement('div');
    row.className = 'pinned-item';
    row.style.setProperty('--pin-hue', String(p.hueDeg));

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'pinned-item__play';
    const dot = document.createElement('span');
    dot.className = 'pinned-item__dot';
    const name = document.createElement('span');
    name.className = 'pinned-item__name';
    name.textContent = p.name;
    play.append(dot, name);
    play.addEventListener('click', () => onApply?.(p.config));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pinned-item__del';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete ${p.name}`);
    del.addEventListener('click', async () => {
      try {
        await deletePreset(p.id);
      } catch (err) {
        console.warn('could not delete pinned sound:', err);
      }
      void refreshPinnedDrawer();
    });

    row.append(play, del);
    panel.appendChild(row);
  }
}

/** Toggles the list; refreshes it when opening. Returns whether it's now visible. */
export function togglePinnedDrawer(): boolean {
  if (!panel) return false;
  const visible = panel.classList.toggle('hidden') === false;
  if (visible) void refreshPinnedDrawer();
  return visible;
}
