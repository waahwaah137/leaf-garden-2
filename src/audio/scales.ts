import * as Tone from 'tone';

export interface ScaleDef {
  name: string;
  /** MIDI note number of the tonic. */
  rootMidi: number;
  /** Semitone offsets from the tonic, one octave, ascending. */
  intervals: number[];
}

// A simple "night -> day" progression of pentatonic-ish modes. Kept to a small
// discrete set (not continuous pitch-bending) per design — transitions read as
// mood shifts, not detuning.
export const SCALES: ScaleDef[] = [
  { name: 'dawn', rootMidi: 45, intervals: [0, 3, 5, 7, 10] }, // A2, minor-leaning pentatonic
  { name: 'morning', rootMidi: 47, intervals: [0, 2, 4, 7, 9] }, // B2, open pentatonic
  { name: 'midday', rootMidi: 50, intervals: [0, 2, 4, 7, 9] }, // D3, brighter/higher register
];

const BAND_EDGES = [0.33, 0.66]; // boundaries between dawn/morning and morning/midday
const HYSTERESIS = 0.04;

let currentBandIndex = 1; // start at "morning"

/** Picks a scale band from smoothed brightness (0-1), with hysteresis to prevent flicker at boundaries. */
export function getScaleForBrightness(brightness: number): ScaleDef {
  const [lowEdge, highEdge] = BAND_EDGES;

  if (currentBandIndex === 0 && brightness > lowEdge + HYSTERESIS) {
    currentBandIndex = 1;
  } else if (currentBandIndex === 1 && brightness < lowEdge - HYSTERESIS) {
    currentBandIndex = 0;
  } else if (currentBandIndex === 1 && brightness > highEdge + HYSTERESIS) {
    currentBandIndex = 2;
  } else if (currentBandIndex === 2 && brightness < highEdge - HYSTERESIS) {
    currentBandIndex = 1;
  }

  return SCALES[currentBandIndex];
}

/**
 * Resolves a scale degree (may exceed the interval count, wrapping into higher/lower octaves)
 * plus a plant-specific tonal offset (in scale degrees) to a concrete note name, e.g. "A3".
 */
export function degreeToNote(scale: ScaleDef, degree: number, tonalOffsetDegrees = 0): string {
  const totalDegree = degree + tonalOffsetDegrees;
  const octave = Math.floor(totalDegree / scale.intervals.length);
  const indexInScale = ((totalDegree % scale.intervals.length) + scale.intervals.length) % scale.intervals.length;
  const midi = scale.rootMidi + scale.intervals[indexInScale] + octave * 12;
  return Tone.Frequency(midi, 'midi').toNote();
}

/** Same as degreeToNote but returns the raw MIDI number (so callers can transpose/detune). */
export function degreeToMidi(scale: ScaleDef, degree: number, tonalOffsetDegrees = 0): number {
  const totalDegree = degree + tonalOffsetDegrees;
  const octave = Math.floor(totalDegree / scale.intervals.length);
  const indexInScale = ((totalDegree % scale.intervals.length) + scale.intervals.length) % scale.intervals.length;
  return scale.rootMidi + scale.intervals[indexInScale] + octave * 12;
}

// --- Selectable modes (used by the bank/mode dials) -----------------------------------
export type ModeName = 'pentatonic' | 'minor' | 'dorian' | 'lydian' | 'wholeTone' | 'phrygian';

export const MODE_NAMES: ModeName[] = ['pentatonic', 'minor', 'dorian', 'lydian', 'wholeTone', 'phrygian'];

export const MODE_INTERVALS: Record<ModeName, number[]> = {
  pentatonic: [0, 2, 4, 7, 9],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  wholeTone: [0, 2, 4, 6, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** Builds a ScaleDef from a tonic MIDI note and a named mode. */
export function makeScale(rootMidi: number, mode: ModeName): ScaleDef {
  return { name: mode, rootMidi, intervals: MODE_INTERVALS[mode] };
}
