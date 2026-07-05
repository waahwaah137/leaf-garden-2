import * as Tone from 'tone';
import type { ModeName } from './scales';

// A "bank" is a selectable sound palette. Each defines the two morph voices (round/ambient
// and sharp/bright), a musical mode, tempo, and effect character. The Leafscape engine
// rebuilds its voices from the active bank when the user turns the Bank dial.

export type BankGroup = 'Spacey' | 'Organic' | 'Crystalline' | 'Electronic';

/** A Tone monophonic instrument class usable both standalone and as a PolySynth voice. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VoiceClass = any;

export interface RoundVoiceSpec {
  /** Poly voice class (Synth / FMSynth / AMSynth …) for the sustained pad chord. */
  voice: VoiceClass;
  options: Record<string, unknown>;
  volume: number; // dB
  /** Scale degrees of the sustained pad chord. */
  padDegrees: number[];
  /** Octave offset (in scale degrees ≈ octaves) applied to the pad, negative = lower. */
  degreeOffset: number;
}

export interface SharpVoiceSpec {
  voice: VoiceClass;
  options: Record<string, unknown>;
  volume: number; // dB
  /** Arp register as [minDegree, maxDegree]. */
  register: [number, number];
  hpHz: number; // high-pass before the sharp bus
  delayTime: string;
  delayFeedback: number;
  delayWet: number;
}

export interface Bank {
  id: string;
  name: string;
  group: BankGroup;
  rootMidi: number;
  mode: ModeName;
  bpm: number;
  arpSubdiv: string; // Tone time, e.g. '16n'
  reverbDecay: number;
  wetRound: number; // reverb wet at fully-round
  wetSharp: number; // reverb wet at fully-sharp
  cutoffMin: number; // master morph filter cutoff at round
  cutoffMax: number; // …at sharp
  round: RoundVoiceSpec;
  sharp: SharpVoiceSpec;
}

const S = Tone.Synth;
const FM = Tone.FMSynth;
const AM = Tone.AMSynth;
const METAL = Tone.MetalSynth;
const PLUCK = Tone.PluckSynth;

const padEnv = (attack: number, release: number) => ({
  attack,
  decay: 1.5,
  sustain: 0.9,
  release,
});

export const BANKS: Bank[] = [
  // ---------------- Spacey ----------------
  {
    id: 'deep-space', name: 'Deep Space', group: 'Spacey',
    rootMidi: 45, mode: 'minor', bpm: 60, arpSubdiv: '8n',
    reverbDecay: 9, wetRound: 0.75, wetSharp: 0.3, cutoffMin: 300, cutoffMax: 5000,
    round: { voice: S, options: { oscillator: { type: 'sine' }, envelope: padEnv(5, 8) }, volume: -12, padDegrees: [0, 2, 4], degreeOffset: -7 },
    sharp: { voice: FM, options: { harmonicity: 2, modulationIndex: 6, oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.3, sustain: 0.05, release: 0.5 } }, volume: -14, register: [7, 15], hpHz: 900, delayTime: '4n.', delayFeedback: 0.45, delayWet: 0.4 },
  },
  {
    id: 'nebula', name: 'Nebula', group: 'Spacey',
    rootMidi: 48, mode: 'lydian', bpm: 66, arpSubdiv: '8n',
    reverbDecay: 8, wetRound: 0.7, wetSharp: 0.28, cutoffMin: 360, cutoffMax: 6000,
    round: { voice: AM, options: { harmonicity: 1.5, oscillator: { type: 'triangle' }, envelope: padEnv(4, 7) }, volume: -13, padDegrees: [0, 3, 6], degreeOffset: -7 },
    sharp: { voice: FM, options: { harmonicity: 3, modulationIndex: 9, envelope: { attack: 0.003, decay: 0.2, sustain: 0.02, release: 0.35 } }, volume: -13, register: [8, 17], hpHz: 1100, delayTime: '8n.', delayFeedback: 0.4, delayWet: 0.42 },
  },
  {
    id: 'glacier', name: 'Glacier', group: 'Spacey',
    rootMidi: 43, mode: 'dorian', bpm: 58, arpSubdiv: '4n',
    reverbDecay: 10, wetRound: 0.8, wetSharp: 0.35, cutoffMin: 280, cutoffMax: 4200,
    round: { voice: S, options: { oscillator: { type: 'triangle' }, envelope: padEnv(6, 9) }, volume: -12, padDegrees: [0, 4, 7], degreeOffset: -7 },
    sharp: { voice: AM, options: { harmonicity: 2, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.6 } }, volume: -15, register: [6, 13], hpHz: 800, delayTime: '2n', delayFeedback: 0.5, delayWet: 0.45 },
  },

  // ---------------- Organic ----------------
  {
    id: 'forest', name: 'Forest', group: 'Organic',
    rootMidi: 50, mode: 'pentatonic', bpm: 74, arpSubdiv: '8n',
    reverbDecay: 5, wetRound: 0.55, wetSharp: 0.2, cutoffMin: 420, cutoffMax: 6500,
    round: { voice: S, options: { oscillator: { type: 'triangle' }, envelope: padEnv(3, 5) }, volume: -12, padDegrees: [0, 2, 4], degreeOffset: -5 },
    sharp: { voice: PLUCK, options: { attackNoise: 1, dampening: 3500, resonance: 0.85 }, volume: -8, register: [7, 16], hpHz: 700, delayTime: '8n', delayFeedback: 0.28, delayWet: 0.28 },
  },
  {
    id: 'meadow', name: 'Meadow', group: 'Organic',
    rootMidi: 52, mode: 'lydian', bpm: 80, arpSubdiv: '16n',
    reverbDecay: 4.5, wetRound: 0.5, wetSharp: 0.18, cutoffMin: 460, cutoffMax: 7000,
    round: { voice: S, options: { oscillator: { type: 'sine' }, envelope: padEnv(2.5, 4.5) }, volume: -13, padDegrees: [0, 3, 5], degreeOffset: -5 },
    sharp: { voice: PLUCK, options: { attackNoise: 0.7, dampening: 4200, resonance: 0.8 }, volume: -7, register: [8, 18], hpHz: 900, delayTime: '16n', delayFeedback: 0.22, delayWet: 0.3 },
  },
  {
    id: 'rainfall', name: 'Rainfall', group: 'Organic',
    rootMidi: 48, mode: 'dorian', bpm: 88, arpSubdiv: '16n',
    reverbDecay: 6, wetRound: 0.6, wetSharp: 0.25, cutoffMin: 380, cutoffMax: 6000,
    round: { voice: AM, options: { harmonicity: 1.2, oscillator: { type: 'sine' }, envelope: padEnv(3, 5) }, volume: -13, padDegrees: [0, 2, 4], degreeOffset: -5 },
    sharp: { voice: PLUCK, options: { attackNoise: 1.2, dampening: 3000, resonance: 0.9 }, volume: -9, register: [6, 15], hpHz: 650, delayTime: '16n.', delayFeedback: 0.35, delayWet: 0.35 },
  },

  // ---------------- Crystalline ----------------
  {
    id: 'glass', name: 'Glass', group: 'Crystalline',
    rootMidi: 55, mode: 'pentatonic', bpm: 84, arpSubdiv: '16n',
    reverbDecay: 5.5, wetRound: 0.6, wetSharp: 0.3, cutoffMin: 500, cutoffMax: 9000,
    round: { voice: FM, options: { harmonicity: 2, modulationIndex: 3, oscillator: { type: 'sine' }, envelope: padEnv(3, 5) }, volume: -14, padDegrees: [0, 4, 7], degreeOffset: -5 },
    sharp: { voice: FM, options: { harmonicity: 5, modulationIndex: 12, envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 } }, volume: -12, register: [9, 20], hpHz: 1500, delayTime: '16n', delayFeedback: 0.3, delayWet: 0.4 },
  },
  {
    id: 'music-box', name: 'Music Box', group: 'Crystalline',
    rootMidi: 60, mode: 'pentatonic', bpm: 78, arpSubdiv: '8n',
    reverbDecay: 4, wetRound: 0.5, wetSharp: 0.28, cutoffMin: 600, cutoffMax: 9500,
    round: { voice: S, options: { oscillator: { type: 'sine' }, envelope: padEnv(2, 4) }, volume: -15, padDegrees: [0, 2, 4], degreeOffset: -7 },
    sharp: { voice: FM, options: { harmonicity: 4, modulationIndex: 8, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.4 } }, volume: -10, register: [7, 18], hpHz: 1200, delayTime: '8n', delayFeedback: 0.25, delayWet: 0.35 },
  },
  {
    id: 'bells', name: 'Bells', group: 'Crystalline',
    rootMidi: 53, mode: 'lydian', bpm: 72, arpSubdiv: '8n',
    reverbDecay: 7, wetRound: 0.65, wetSharp: 0.35, cutoffMin: 450, cutoffMax: 10000,
    round: { voice: FM, options: { harmonicity: 3, modulationIndex: 4, envelope: padEnv(3, 6) }, volume: -14, padDegrees: [0, 3, 7], degreeOffset: -5 },
    sharp: { voice: METAL, options: { harmonicity: 5.1, resonance: 3000, modulationIndex: 20, envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.5 } }, volume: -22, register: [7, 15], hpHz: 1000, delayTime: '4n', delayFeedback: 0.35, delayWet: 0.4 },
  },

  // ---------------- Electronic ----------------
  {
    id: 'synthwave', name: 'Synthwave', group: 'Electronic',
    rootMidi: 45, mode: 'minor', bpm: 100, arpSubdiv: '16n',
    reverbDecay: 4, wetRound: 0.45, wetSharp: 0.2, cutoffMin: 400, cutoffMax: 8000,
    round: { voice: S, options: { oscillator: { type: 'sawtooth' }, envelope: padEnv(1.5, 3) }, volume: -16, padDegrees: [0, 3, 7], degreeOffset: -7 },
    sharp: { voice: S, options: { oscillator: { type: 'square' }, envelope: { attack: 0.005, decay: 0.12, sustain: 0.1, release: 0.15 } }, volume: -14, register: [7, 16], hpHz: 700, delayTime: '8n.', delayFeedback: 0.38, delayWet: 0.35 },
  },
  {
    id: 'drone', name: 'Drone', group: 'Electronic',
    rootMidi: 41, mode: 'phrygian', bpm: 64, arpSubdiv: '4n',
    reverbDecay: 8, wetRound: 0.6, wetSharp: 0.3, cutoffMin: 260, cutoffMax: 5000,
    round: { voice: S, options: { oscillator: { type: 'sawtooth' }, envelope: padEnv(4, 7) }, volume: -14, padDegrees: [0, 3, 5], degreeOffset: -7 },
    sharp: { voice: FM, options: { harmonicity: 1.5, modulationIndex: 14, oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.4 } }, volume: -15, register: [5, 12], hpHz: 600, delayTime: '4n', delayFeedback: 0.45, delayWet: 0.35 },
  },
  {
    id: 'pulse', name: 'Pulse', group: 'Electronic',
    rootMidi: 48, mode: 'dorian', bpm: 112, arpSubdiv: '16n',
    reverbDecay: 3.5, wetRound: 0.4, wetSharp: 0.15, cutoffMin: 450, cutoffMax: 9000,
    round: { voice: AM, options: { harmonicity: 2, oscillator: { type: 'square' }, envelope: padEnv(1.5, 3) }, volume: -16, padDegrees: [0, 2, 4], degreeOffset: -5 },
    sharp: { voice: S, options: { oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.08, sustain: 0.05, release: 0.1 } }, volume: -13, register: [8, 18], hpHz: 1000, delayTime: '16n', delayFeedback: 0.3, delayWet: 0.3 },
  },
];

export function bankById(id: string): Bank {
  return BANKS.find((b) => b.id === id) ?? BANKS[0];
}
