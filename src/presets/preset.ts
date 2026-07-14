// A Preset is a full snapshot of the sound engine's controls — everything the knobs + bank set.
// It's what a "specimen" on the fidget wheel plays, and what gets pinned (and later placed on the
// Cubbon map). Kept free of Tone/DOM imports so it stays node-testable: the curated roller takes the
// available bank ids as an argument rather than importing the (Tone-dependent) banks module.

import { mulberry32 } from '../poetry/grammar';

/** Every controllable value — mirrors the Play-mode knobs 1:1 (mode is an index into MODE_NAMES). */
export interface PresetConfig {
  bankId: string;
  volume: number; // 0..1
  mode: number; // 0..5 (index into MODE_NAMES)
  pitch: number; // -12..12 semitones
  freq: number; // 0..1 timbre bias
  space: number; // 0..1 reverb space
  density: number; // 0..1 arp density
  tempo: number; // 50..140 bpm
  sens: number; // 0..1 shape sensitivity
}

/** A pinned/labelled specimen: the config + how it presents (name, hue) + when it was made. */
export interface Preset {
  id: string;
  config: PresetConfig;
  name: string;
  hueDeg: number; // colours the wheel card + (Phase C) the map dot
  createdAt: number;
  /** Phase C: the Cubbon landmark this pin lives at (a landmark id — never raw coordinates). */
  place?: { landmarkId: string };
}

export const MODE_COUNT = 6; // keep in sync with MODE_NAMES in scales.ts

// Curated bounds — deliberately kept out of the muddy extremes (no drowning reverb + wall-of-arp),
// so every roll lands pleasant. `isMuddy` encodes the excluded zone the sandbox check asserts against.
const SPACE_MIN = 0.3;
const SPACE_MAX = 0.75;
const DENSITY_MIN = 0.4;
const DENSITY_MAX = 0.8;
const FREQ_MIN = 0.35;
const FREQ_MAX = 0.75;
const SENS_MIN = 0.4;
const SENS_MAX = 0.8;
const TEMPO_MIN = 60;
const TEMPO_MAX = 110;
const VOLUME_MIN = 0.85;
const VOLUME_MAX = 1.0;
// Consonant-leaning transpositions (favours small, musical intervals over random chromatic jumps).
const PITCHES = [-7, -5, -3, 0, 0, 2, 3, 5, 7];

/** True for the excluded "mud" zone (drowning reverb stacked on a wall of arp). Roller never hits it. */
export function isMuddy(c: PresetConfig): boolean {
  return c.space > 0.85 && c.density > 0.85;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A vetted, coherent random config. Seeded (same seed → same config) so the wheel is reproducible
 * and the sandbox can assert coverage. `bankIds` is the list of available bank ids (passed in to
 * keep this module Tone-free).
 */
export function rollCuratedPreset(seed: number, bankIds: string[]): PresetConfig {
  const rng = mulberry32(seed);
  const ids = bankIds.length > 0 ? bankIds : ['forest'];
  return {
    bankId: ids[Math.floor(rng() * ids.length)],
    volume: lerp(VOLUME_MIN, VOLUME_MAX, rng()),
    mode: Math.floor(rng() * MODE_COUNT),
    pitch: PITCHES[Math.floor(rng() * PITCHES.length)],
    freq: lerp(FREQ_MIN, FREQ_MAX, rng()),
    space: lerp(SPACE_MIN, SPACE_MAX, rng()),
    density: lerp(DENSITY_MIN, DENSITY_MAX, rng()),
    tempo: Math.round(lerp(TEMPO_MIN, TEMPO_MAX, rng())),
    sens: lerp(SENS_MIN, SENS_MAX, rng()),
  };
}

// Whimsical two-word names for specimens — cosmic/mystic with a thread of Cubbon (evocative, not
// literal), e.g. "Mystic Globe", "Monsoon Comet", "Velvet Grove".
const NAME_ADJ = [
  'mystic', 'velvet', 'amber', 'monsoon', 'lucid', 'hollow', 'silver', 'dusk', 'feral', 'gilded',
  'shaded', 'cosmic', 'laterite', 'misted', 'golden', 'verdant', 'electric', 'quiet', 'stray', 'lunar',
];
const NAME_NOUN = [
  'globe', 'comet', 'grove', 'bell', 'drift', 'hush', 'ember', 'orbit', 'veil', 'tide',
  'canopy', 'bloom', 'arc', 'glow', 'halo', 'echo', 'signal', 'mirage', 'lantern', 'current',
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short, Cubbon-flavoured specimen name, e.g. "Monsoon Hush". Seeded. */
export function generatePresetName(seed: number): string {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  return `${cap(NAME_ADJ[Math.floor(rng() * NAME_ADJ.length)])} ${cap(NAME_NOUN[Math.floor(rng() * NAME_NOUN.length)])}`;
}

export interface Specimen {
  seed: number;
  config: PresetConfig;
  name: string;
  hueDeg: number;
}

/** Bundles one wheel detent: a curated config + a name + a hue (all from the seed). */
export function rollSpecimen(seed: number, bankIds: string[]): Specimen {
  const rng = mulberry32(seed ^ 0x85ebca6b);
  return {
    seed,
    config: rollCuratedPreset(seed, bankIds),
    name: generatePresetName(seed),
    hueDeg: Math.floor(rng() * 360),
  };
}
