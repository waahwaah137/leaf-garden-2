// The herbarium: a discreet full-screen panel (mirrors the "?" about-panel pattern) holding the
// user's kept walks. Grid of cards → tap for detail → share (Web Share API with PNG, falling back
// to download) or release (delete). Also owns keepsake composition and the walk-draft lifecycle so
// main.ts stays a thin wiring layer.

import { getPhase } from '../env/daytime';
import { WalkSession } from '../journey/session';
import type { BankGroup } from '../poetry/lexicons';
import type { PoetryInput, PoetrySource } from '../poetry/poet';
import {
  clearDraft,
  deleteKeepsake,
  listKeepsakes,
  loadDraft,
  saveKeepsake,
  type Keepsake,
} from '../storage/herbariumStore';
import { renderShareCard, renderWalkArt } from './keepsakeArt';

const DRAFT_STALE_MS = 10 * 60 * 1000; // hidden longer than this → the walk quietly becomes a card

let root: HTMLElement | null = null;
let gridEl: HTMLElement | null = null;
let detailEl: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statsLine(k: Keepsake): string {
  const mins = Math.max(1, Math.round(k.minutes));
  return `${mins} min · ${k.voices} leaf-voice${k.voices === 1 ? '' : 's'} · ${k.phase}`;
}

function dateLabel(endedAt: number): string {
  return new Date(endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Builds the panel once and mounts it into the stage (hidden). */
export function initHerbarium(stage: HTMLElement): void {
  if (root) return;
  root = el('div', 'about-panel herbarium hidden');
  root.id = 'herbarium-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Your kept walks');

  const close = el('button', 'about-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => closeHerbarium());

  const title = el('h2', '', 'Herbarium 🌿');
  const lead = el('p', 'about-lead', 'Walks you chose to keep. They live only on this device.');

  gridEl = el('div', 'herb-grid');
  detailEl = el('div', 'herb-detail hidden');

  root.append(close, title, lead, gridEl, detailEl);
  stage.appendChild(root);
}

export function openHerbarium(focusId?: string): void {
  if (!root) return;
  root.classList.remove('hidden');
  void refreshGrid(focusId);
}

export function closeHerbarium(): void {
  root?.classList.add('hidden');
  showGrid();
}

function showGrid(): void {
  gridEl?.classList.remove('hidden');
  detailEl?.classList.add('hidden');
}

async function refreshGrid(focusId?: string): Promise<void> {
  if (!gridEl) return;
  let keepsakes: Keepsake[] = [];
  try {
    keepsakes = await listKeepsakes();
  } catch (err) {
    console.warn('could not read herbarium:', err);
  }

  gridEl.innerHTML = '';
  if (keepsakes.length === 0) {
    gridEl.appendChild(el('p', 'herb-empty', 'No walks kept yet — tap “keep” after a wander and it will rest here.'));
  }
  for (const k of keepsakes) {
    const card = el('button', 'herb-card');
    card.type = 'button';
    const img = document.createElement('img');
    img.src = k.art;
    img.alt = `Walk from ${dateLabel(k.endedAt)}`;
    const cap = el('span', 'herb-cap', `${dateLabel(k.endedAt)} · ${statsLine(k)}`);
    card.append(img, cap);
    card.addEventListener('click', () => showDetail(k));
    gridEl.appendChild(card);
  }

  const focus = focusId && keepsakes.find((k) => k.id === focusId);
  if (focus) showDetail(focus);
  else showGrid();
}

function showDetail(k: Keepsake): void {
  if (!detailEl) return;
  detailEl.innerHTML = '';

  const back = el('button', 'round-button herb-back', '← walks');
  back.type = 'button';
  back.addEventListener('click', () => showGrid());

  const img = document.createElement('img');
  img.src = k.art;
  img.alt = 'Walk art';

  const poem = el('div', 'herb-poem');
  for (const line of k.poem) poem.appendChild(el('div', 'poem-line', line));

  const stats = el('div', 'herb-stats', statsLine(k));
  const extra: string[] = [];
  if (k.banks.length > 0) extra.push(k.banks.join(' · '));
  if (k.linesHeard > 0) extra.push(`${k.linesHeard} line${k.linesHeard === 1 ? '' : 's'} heard`);
  extra.push(new Date(k.endedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  const sub = el('div', 'herb-stats herb-sub', extra.join(' — '));

  const actions = el('div', 'herb-actions');
  const share = el('button', 'round-button', 'share');
  share.type = 'button';
  share.addEventListener('click', () => void shareOrDownload(k, true));
  const save = el('button', 'round-button', 'save png');
  save.type = 'button';
  save.addEventListener('click', () => void shareOrDownload(k, false));
  const release = el('button', 'round-button', 'release');
  release.type = 'button';
  release.title = 'Let this walk go';
  release.addEventListener('click', async () => {
    try {
      await deleteKeepsake(k.id);
    } catch (err) {
      console.warn('could not release keepsake:', err);
    }
    void refreshGrid();
  });
  actions.append(share, save, release);

  detailEl.append(back, img, poem, stats, sub, actions);
  gridEl?.classList.add('hidden');
  detailEl.classList.remove('hidden');
}

async function shareOrDownload(k: Keepsake, preferShare: boolean): Promise<void> {
  try {
    const canvas = await renderShareCard(k);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('card render produced no image');
    const file = new File([blob], `leaf-garden-walk-${k.id}.png`, { type: 'image/png' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (preferShare && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: 'A walk in the Leaf Garden' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    // Share sheets reject on user-cancel — that's fine; only warn on real failures.
    if ((err as Error)?.name !== 'AbortError') console.warn('share/download failed:', err);
  }
}

/** Composes a keepsake from a walk (end-of-walk poem in the walk's own voice) and stores it. */
export async function composeAndSaveKeepsake(
  session: WalkSession,
  fallbackGroup: BankGroup,
  creativity: number,
  poet: PoetrySource,
  endedAt: number = Date.now(),
): Promise<Keepsake> {
  const snap = session.raw();
  const phase = getPhase(new Date(endedAt));
  const input: PoetryInput = {
    hueDeg: session.meanHue(),
    shape: session.meanShape(),
    colorSignal: session.meanColor(),
    presence: session.meanPresence(),
    leafCount: Math.max(1, session.voiceCount()),
    group: snap.lastGroup ?? fallbackGroup,
    phase,
    seed: Math.floor(endedAt / 1000),
  };
  const poem = await poet.generate(input, { structure: 'couplet', creativity });
  const keepsake: Keepsake = {
    id: String(endedAt),
    endedAt,
    minutes: session.minutes(endedAt),
    taps: snap.taps,
    voices: session.voiceCount(),
    linesHeard: snap.poems.length,
    banks: [...snap.banks],
    phase,
    poem,
    hues: [...snap.hues],
    art: renderWalkArt(snap.hues),
  };
  await saveKeepsake(keepsake);
  return keepsake;
}

/**
 * Draft lifecycle on startup: a walk interrupted recently resumes (returns the revived session);
 * one abandoned for a while quietly becomes a keepsake ("the garden kept this for you"). Returns
 * null when there is nothing to resume.
 */
export async function restoreOrFinalizeDraft(
  poet: PoetrySource,
  fallbackGroup: BankGroup,
  creativity: number,
): Promise<WalkSession | null> {
  let draft;
  try {
    draft = await loadDraft();
  } catch {
    return null;
  }
  if (!draft) return null;
  const hiddenAt = draft.hiddenAt ?? draft.startedAt;
  try {
    await clearDraft();
  } catch {
    /* non-fatal */
  }

  if (Date.now() - hiddenAt <= DRAFT_STALE_MS) {
    return new WalkSession(draft); // picked the phone back up — carry on
  }
  const abandoned = new WalkSession(draft);
  if (abandoned.isMeaningful(hiddenAt)) {
    try {
      await composeAndSaveKeepsake(abandoned, fallbackGroup, creativity, poet, hiddenAt);
    } catch (err) {
      console.warn('could not finalize interrupted walk:', err);
    }
  }
  return null;
}
