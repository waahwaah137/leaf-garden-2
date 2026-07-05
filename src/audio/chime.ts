import * as Tone from 'tone';
import { degreeToNote, type ScaleDef } from './scales';

const RISE_THRESHOLD = 0.08; // minimum jump in mic level to count as a triggering onset
const MIN_LEVEL = 0.12; // ignore rises below this absolute level (background noise floor)
const COOLDOWN_MS = 220; // minimum time between chime hits, so a sustained loud sound doesn't machine-gun
const FULL_VELOCITY_LEVEL = 0.85;
const CHIME_DEGREES = [7, 8, 9, 10, 11]; // upper register, bell-like register above the flute/vocal layers

export interface ChimeLayer {
  gainNode: Tone.Gain;
  /** `level` should be a fast-attack signal (e.g. MicSensor.getDisplayLevel()), not a heavily-smoothed one — onset detection needs it to actually jump on transients. */
  update: (level: number, scale: ScaleDef, nowMs: number) => void;
}

export function createChimeLayer(destination: Tone.Gain): ChimeLayer {
  const gainNode = new Tone.Gain(Tone.dbToGain(-6)).connect(destination);
  const shimmer = new Tone.PingPongDelay('8n', 0.2).connect(gainNode);
  shimmer.wet.value = 0.25;
  const synth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.9, release: 0.3 },
    harmonicity: 5.1,
    modulationIndex: 16,
    resonance: 3500,
    octaves: 1.2,
  }).connect(shimmer);
  synth.volume.value = -8;

  let previousLevel = 0;
  let lastTriggerTime = -Infinity;

  function update(level: number, scale: ScaleDef, nowMs: number): void {
    const rising = level - previousLevel;
    const cooledDown = nowMs - lastTriggerTime > COOLDOWN_MS;

    if (rising > RISE_THRESHOLD && level > MIN_LEVEL && cooledDown) {
      const degree = CHIME_DEGREES[Math.floor(Math.random() * CHIME_DEGREES.length)];
      const note = degreeToNote(scale, degree);
      const velocity = Math.min(1, level / FULL_VELOCITY_LEVEL);
      synth.triggerAttackRelease(note, '2n', undefined, 0.3 + velocity * 0.5);
      lastTriggerTime = nowMs;
    }

    previousLevel = level;
  }

  return { gainNode, update };
}
