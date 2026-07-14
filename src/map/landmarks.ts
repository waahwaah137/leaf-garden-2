// The six Cubbon Park landmarks the audio-map anchors to. This is a NON-GEO map: `x,y` are normalized
// positions for drawing each node on the stylized field (layout mirrors the illustrated map). `lat,lng`
// are approximate public coordinates used ONLY to compute proximity (never stored per pin) — TUNE
// THEM ON-GROUND; the unlock radius is generous to tolerate error and Cubbon's notoriously poor GPS.

import { haversineMeters } from '../sensors/journeySensor';

export interface Landmark {
  id: string;
  label: string;
  x: number; // 0..1 across the stylized map
  y: number; // 0..1 down the stylized map
  lat: number; // approximate — proximity only
  lng: number;
}

// x,y are placed on top of where each landmark is DRAWN in public/cubbon-map.png (the illustrated,
// non-geo map) — the buildings/icons, not the labels. lat,lng stay approximate (proximity only).
export const CUBBON_LANDMARKS: Landmark[] = [
  { id: 'state-library', label: 'State Library', x: 0.48, y: 0.3, lat: 12.9745, lng: 77.5936 },
  { id: 'high-court', label: 'High Court', x: 0.76, y: 0.14, lat: 12.9766, lng: 77.5926 },
  { id: 'central-garden', label: 'Central Garden', x: 0.5, y: 0.5, lat: 12.9752, lng: 77.5915 },
  { id: 'metro-gate', label: 'Metro Station Gate', x: 0.17, y: 0.54, lat: 12.976, lng: 77.596 },
  { id: 'temple', label: 'Temple', x: 0.17, y: 0.73, lat: 12.972, lng: 77.5905 },
  { id: 'mg-road-gate', label: 'MG Road Gate', x: 0.85, y: 0.66, lat: 12.9755, lng: 77.6 },
];

export const UNLOCK_RADIUS_M = 70; // within this of a landmark → its pins unlock
export const IN_PARK_M = 350; // a pin only attaches to a landmark if you're this close to one (i.e. in the park)

export function landmarkById(id: string): Landmark | undefined {
  return CUBBON_LANDMARKS.find((l) => l.id === id);
}

/** The nearest landmark to a coordinate, plus the great-circle distance in metres. */
export function nearestLandmark(lat: number, lng: number): { landmark: Landmark; distanceM: number } {
  let best = CUBBON_LANDMARKS[0];
  let bestD = Infinity;
  for (const l of CUBBON_LANDMARKS) {
    const d = haversineMeters(lat, lng, l.lat, l.lng);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return { landmark: best, distanceM: bestD };
}
