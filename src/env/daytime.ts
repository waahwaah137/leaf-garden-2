// Time-of-day drift. Reads the device clock only (offline, no network) and reports a coarse phase
// that gently biases the poem lexicon, a UI accent tint, and a default-bank suggestion. Nothing is
// forced — this is ambient flavour, consistent with the app's calm/minimal feel.

export type DaytimePhase = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';

/** Coarse phase from a local hour. Boundaries are intentionally soft/approximate. */
export function getPhase(date: Date = new Date()): DaytimePhase {
  const h = date.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'golden';
  if (h >= 19 && h < 21) return 'dusk';
  return 'night';
}

/** A human label for the phase (used in keepsake stats, HUD, etc.). */
export function phaseLabel(phase: DaytimePhase): string {
  return phase; // already reads naturally ("dawn", "golden", …)
}

/**
 * A representative accent hue (degrees) for each phase, for subtle UI tinting via the existing
 * `hueToCss` helper. Warm at golden/dusk, cool at dawn/night, green-neutral by day.
 */
export function phaseAccentHue(phase: DaytimePhase): number {
  switch (phase) {
    case 'dawn':
      return 190; // pale cyan
    case 'day':
      return 130; // green
    case 'golden':
      return 40; // amber
    case 'dusk':
      return 20; // warm orange-red
    case 'night':
      return 250; // deep indigo
  }
}

/**
 * A gentle default-bank *group* suggestion for a phase (non-forcing — callers may ignore). Maps to
 * the bank groups in banks.ts. Golden/dusk lean warm/organic; night leans spacey; dawn crystalline.
 */
export function phaseBankGroupHint(phase: DaytimePhase): string {
  switch (phase) {
    case 'dawn':
      return 'Crystalline';
    case 'day':
      return 'Organic';
    case 'golden':
      return 'Organic';
    case 'dusk':
      return 'Electronic';
    case 'night':
      return 'Spacey';
  }
}
