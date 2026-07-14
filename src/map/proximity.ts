// Proximity to Cubbon's landmarks. Privacy-first: raw coordinates are read transiently to compute the
// nearest landmark + distance, then discarded — nothing positional is ever stored or exposed beyond a
// landmark id. `#unlock` in the URL force-unlocks every landmark for off-site testing (debug only).

import { nearestLandmark, UNLOCK_RADIUS_M } from './landmarks';

export interface Proximity {
  landmarkId: string;
  label: string;
  distanceM: number;
  unlocked: boolean; // within UNLOCK_RADIUS_M of this (the nearest) landmark
}

/** Debug: `#unlock` in the URL unlocks every landmark, so retrieval can be tested away from Cubbon. */
export function forceUnlock(): boolean {
  return typeof location !== 'undefined' && location.hash.toLowerCase().includes('unlock');
}

function toProximity(lat: number, lng: number): Proximity {
  const { landmark, distanceM } = nearestLandmark(lat, lng);
  return { landmarkId: landmark.id, label: landmark.label, distanceM, unlocked: distanceM <= UNLOCK_RADIUS_M };
}

/** One-shot nearest landmark (used when pinning). Resolves null if geolocation is denied/unavailable. */
export function nearestOnce(timeoutMs = 8000): Promise<Proximity | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toProximity(pos.coords.latitude, pos.coords.longitude)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 },
    );
  });
}

let watchId: number | null = null;

/** Live nearest-landmark updates while the map is open. Coordinates are never retained. */
export function watch(cb: (p: Proximity | null) => void): void {
  if (!navigator.geolocation) {
    cb(null);
    return;
  }
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => cb(toProximity(pos.coords.latitude, pos.coords.longitude)),
    () => cb(null),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
}

export function stopWatch(): void {
  if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}
