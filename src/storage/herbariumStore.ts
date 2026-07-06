// The herbarium: locally-kept walk keepsakes (IndexedDB), plus a single "walk draft" slot so a
// session interrupted by the app being hidden/killed can be resumed or gently finalized later.
// Nothing here ever leaves the device unless the user explicitly shares a card.

import type { DaytimePhase } from '../env/daytime';
import type { WalkSnapshot } from '../journey/session';
import { idb, KEEPSAKES, META } from './idb';

export interface Keepsake {
  id: string; // endedAt as string (keyPath)
  endedAt: number;
  minutes: number;
  taps: number;
  voices: number; // distinct leaf-voice buckets heard
  linesHeard: number; // poem lines spoken during the walk
  banks: string[]; // bank names visited, in order
  phase: DaytimePhase;
  poem: string[]; // the end-of-walk poem
  hues: number[]; // chronological hue samples (drives the card art)
  art: string; // PNG data URL of the walk art (swatch now, trail sigil in Phase 3)
}

const DRAFT_KEY = 'walk-draft';

export const saveKeepsake = (k: Keepsake): Promise<IDBValidKey> => idb.put(KEEPSAKES, k);

export async function listKeepsakes(): Promise<Keepsake[]> {
  const all = await idb.getAll<Keepsake>(KEEPSAKES);
  return all.sort((a, b) => b.endedAt - a.endedAt);
}

export const deleteKeepsake = (id: string): Promise<undefined> => idb.del(KEEPSAKES, id);

export const saveDraft = (snap: WalkSnapshot): Promise<IDBValidKey> => idb.put(META, snap, DRAFT_KEY);
export const loadDraft = (): Promise<WalkSnapshot | undefined> => idb.get<WalkSnapshot>(META, DRAFT_KEY);
export const clearDraft = (): Promise<undefined> => idb.del(META, DRAFT_KEY);
