// Local, on-device storage of pinned presets (IndexedDB). Nothing leaves the device.
// Phase C reads these back onto the Cubbon map; for now we only save + count.

import { idb, PRESETS } from '../storage/idb';
import type { Preset } from './preset';

export const savePreset = (p: Preset): Promise<IDBValidKey> => idb.put(PRESETS, p);

export const countPresets = (): Promise<number> => idb.count(PRESETS);

export const deletePreset = (id: string): Promise<undefined> => idb.del(PRESETS, id);

export async function listPresets(): Promise<Preset[]> {
  const all = await idb.getAll<Preset>(PRESETS);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
