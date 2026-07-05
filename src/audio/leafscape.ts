import * as Tone from 'tone';
import { clamp, lerp, smoothstep } from '../utils/math';
import { masterBus } from './engine';
import { BANKS, bankById, type Bank } from './banks';
import { degreeToMidi, makeScale, type ModeName, type ScaleDef } from './scales';

const RAMP = 0.25; // seconds — smoothing for shape-driven parameter changes

/** Spatial summary of the tracked leaves, used to map vision → sound. */
export interface Spatial {
  count: number; // number of tracked leaves
  avgX: number; // 0 (left) .. 1 (right)
  avgArea: number; // 0 .. 1, mean normalized leaf area
}

const NEUTRAL_SPATIAL: Spatial = { count: 0, avgX: 0.5, avgArea: 0 };

/** Note-trigger events, so the overlay can pulse in time with the music. */
export type NoteEvent = { voice: 'round' | 'sharp'; velocity: number };
const noteListeners = new Set<(e: NoteEvent) => void>();
export function onNote(cb: (e: NoteEvent) => void): () => void {
  noteListeners.add(cb);
  return () => noteListeners.delete(cb);
}
function emitNote(e: NoteEvent): void {
  for (const cb of noteListeners) cb(e);
}

const midiToNote = (midi: number): string => Tone.Frequency(midi, 'midi').toNote();

class LeafscapeEngine {
  // Persistent signal chain: voices -> panner -> morphFilter -> reverb -> gate -> masterBus
  private readonly gate: Tone.Gain;
  private readonly reverb: Tone.Reverb;
  private readonly morphFilter: Tone.Filter;
  private readonly panner: Tone.Panner;
  private readonly roundGain: Tone.Gain;
  private readonly sharpGain: Tone.Gain;
  private readonly arp: Tone.Loop;

  // Per-bank voices (rebuilt on bank switch). Typed loosely because the voice class varies
  // per bank (Synth/FMSynth/AMSynth/MetalSynth/PluckSynth) and Tone's generics fight that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pad!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sharpVoice!: any;
  private sharpDelay!: Tone.FeedbackDelay;
  private sharpHP!: Tone.Filter;

  // State
  private bank: Bank = BANKS[0];
  private mode: ModeName = this.bank.mode;
  private scale: ScaleDef = makeScale(this.bank.rootMidi, this.bank.mode);
  private transpose = 0; // semitones (Pitch dial)
  private timbreBias = 0.5; // Frequency/Timbre dial (0..1)
  private space = 0.5; // Space dial (0..1)
  private density = 0.6; // Density dial (0..1)
  private spatial: Spatial = NEUTRAL_SPATIAL;
  private arpDegree = 8;

  roundLevel = 1;
  sharpLevel = 0;

  // Loop recorder
  private recorder?: Tone.Recorder;
  private loopPlayer?: Tone.Player;
  private recording = false;
  private lastBlob: Blob | null = null;

  constructor() {
    this.gate = new Tone.Gain(0).connect(masterBus);
    this.reverb = new Tone.Reverb({ decay: this.bank.reverbDecay, wet: this.bank.wetRound }).connect(this.gate);
    this.morphFilter = new Tone.Filter(this.bank.cutoffMin, 'lowpass').connect(this.reverb);
    this.morphFilter.Q.value = 0.7;
    this.panner = new Tone.Panner(0).connect(this.morphFilter);
    this.roundGain = new Tone.Gain(1).connect(this.panner);
    this.sharpGain = new Tone.Gain(0).connect(this.panner);

    this.arp = new Tone.Loop((time) => this.arpStep(time), this.bank.arpSubdiv);
    this.arp.humanize = true;
    this.arp.start(0);

    this.buildVoices();
    Tone.Transport.bpm.value = this.bank.bpm;
  }

  private disposeVoices(): void {
    this.pad?.dispose();
    this.sharpVoice?.dispose();
    this.sharpDelay?.dispose();
    this.sharpHP?.dispose();
  }

  private buildVoices(): void {
    const b = this.bank;

    // Round / ambient pad (polyphonic sustained chord).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pad = new Tone.PolySynth(b.round.voice, { ...b.round.options, volume: b.round.volume } as any).connect(this.roundGain);

    // Sharp / bright arp voice → delay → high-pass → sharp bus.
    this.sharpHP = new Tone.Filter(b.sharp.hpHz, 'highpass').connect(this.sharpGain);
    this.sharpDelay = new Tone.FeedbackDelay(b.sharp.delayTime, b.sharp.delayFeedback);
    this.sharpDelay.wet.value = b.sharp.delayWet;
    this.sharpDelay.connect(this.sharpHP);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.sharpVoice = new b.sharp.voice({ ...b.sharp.options, volume: b.sharp.volume } as any).connect(this.sharpDelay);

    this.arp.interval = b.arpSubdiv;
    this.triggerPad();
  }

  private triggerPad(): void {
    if (!this.pad) return;
    const count = Math.max(1, Math.round(lerp(1, this.bank.round.padDegrees.length, this.density)));
    const notes = this.bank.round.padDegrees
      .slice(0, count)
      .map((d) => midiToNote(degreeToMidi(this.scale, d, this.bank.round.degreeOffset) + this.transpose));
    this.pad.releaseAll();
    this.pad.triggerAttack(notes, '+0.02');
    emitNote({ voice: 'round', velocity: 0.6 });
  }

  private arpStep(time: number): void {
    if (this.sharpLevel < 0.05) return; // save CPU when fully round
    const prob = lerp(0.3, 1, this.density);
    if (Math.random() > prob) return;

    const [lo, hi] = this.bank.sharp.register;
    const step = Math.random() < 0.5 ? 2 : 1;
    this.arpDegree += Math.random() < 0.5 ? step : -step;
    this.arpDegree = Math.max(lo, Math.min(hi, this.arpDegree));

    // Bigger leaves nudge the arp up an octave or two (area → register).
    const octaveShift = Math.round(lerp(0, 2, this.spatial.avgArea)) * this.scale.intervals.length;
    const midi = degreeToMidi(this.scale, this.arpDegree + octaveShift) + this.transpose;
    const velocity = 0.4 + Math.random() * 0.4;
    this.sharpVoice.triggerAttackRelease(midiToNote(midi), '16n', time, velocity);
    emitNote({ voice: 'sharp', velocity });
  }

  update(spikiness: number, presence: number, spatial: Spatial, accent = 0): void {
    this.spatial = spatial;
    const s = clamp(spikiness, 0, 1);

    // Equal-power crossfade round ↔ sharp.
    const round = Math.cos((s * Math.PI) / 2);
    const sharp = Math.sin((s * Math.PI) / 2);
    this.roundGain.gain.rampTo(round, RAMP);
    this.sharpGain.gain.rampTo(sharp, RAMP);
    this.roundLevel = round;
    this.sharpLevel = sharp;

    // Timbre dial sets the base cutoff; leaf pointiness scales it around that centre.
    const base = lerp(this.bank.cutoffMin, this.bank.cutoffMax, this.timbreBias);
    const cutoff = clamp(base * lerp(0.5, 2.5, s * s), 120, 16000);
    this.morphFilter.frequency.rampTo(cutoff, RAMP);

    // Reverb wet: bank's round/sharp values scaled by the Space dial.
    const wet = clamp(lerp(this.bank.wetRound, this.bank.wetSharp, s) * lerp(0.3, 1.6, this.space), 0, 1);
    this.reverb.wet.rampTo(wet, RAMP);

    // Average leaf x-position → stereo pan.
    this.panner.pan.rampTo(clamp((spatial.avgX - 0.5) * 2, -1, 1), RAMP);

    // Presence gate: fade the whole scene with how much plant is visible. A deliberate tap
    // (accent) lifts the floor so the influenced sound is audible even with little plant in frame.
    const gateLevel = Math.max(smoothstep(0.02, 0.16, presence), accent * 0.85);
    this.gate.gain.rampTo(gateLevel, RAMP);
  }

  /**
   * Plays one soft note "at" a tapped leaf, routed through the live voices so it inherits the
   * current pan/filter/reverb. Pointy taps ping the bright voice, round taps swell the pad.
   */
  pluck(spik: number): void {
    const s = clamp(spik, 0, 1);
    if (s >= 0.5) {
      const [lo, hi] = this.bank.sharp.register;
      const degree = lo + Math.floor(Math.random() * Math.max(1, hi - lo));
      const midi = degreeToMidi(this.scale, degree) + this.transpose;
      this.sharpVoice?.triggerAttackRelease(midiToNote(midi), '8n', undefined, 0.6);
      emitNote({ voice: 'sharp', velocity: 0.7 });
    } else {
      const degree = this.bank.round.padDegrees[Math.floor(Math.random() * this.bank.round.padDegrees.length)];
      const midi = degreeToMidi(this.scale, degree, this.bank.round.degreeOffset + this.scale.intervals.length) + this.transpose;
      this.pad?.triggerAttackRelease(midiToNote(midi), '2n', undefined, 0.5);
      emitNote({ voice: 'round', velocity: 0.6 });
    }
  }

  // --- Live control setters (from the dials) -----------------------------------------
  setBank(id: string): void {
    const b = bankById(id);
    if (b.id === this.bank.id) return;
    this.disposeVoices();
    this.bank = b;
    this.mode = b.mode;
    this.scale = makeScale(b.rootMidi, b.mode);
    this.reverb.decay = b.reverbDecay;
    Tone.Transport.bpm.rampTo(b.bpm, 0.5);
    this.buildVoices();
  }

  setMode(mode: ModeName): void {
    this.mode = mode;
    this.scale = makeScale(this.bank.rootMidi, mode);
    this.triggerPad();
  }

  setTranspose(semitones: number): void {
    this.transpose = Math.round(semitones);
    this.triggerPad();
  }

  setTimbreBias(v: number): void {
    this.timbreBias = clamp(v, 0, 1);
  }

  setSpace(v: number): void {
    this.space = clamp(v, 0, 1);
  }

  setDensity(v: number): void {
    this.density = clamp(v, 0, 1);
  }

  setTempo(bpm: number): void {
    Tone.Transport.bpm.rampTo(clamp(bpm, 40, 180), 0.3);
  }

  getState() {
    return {
      bankId: this.bank.id,
      bankName: this.bank.name,
      mode: this.mode,
      transpose: this.transpose,
      timbreBias: this.timbreBias,
      space: this.space,
      density: this.density,
      bpm: Tone.Transport.bpm.value,
    };
  }

  // --- Loop recorder ------------------------------------------------------------------
  startRecording(): void {
    if (this.recording) return;
    if (!this.recorder) {
      this.recorder = new Tone.Recorder();
      masterBus.connect(this.recorder);
    }
    this.recorder.start();
    this.recording = true;
  }

  async stopRecordingAndLoop(): Promise<void> {
    if (!this.recorder || !this.recording) return;
    const blob = await this.recorder.stop();
    this.recording = false;
    this.lastBlob = blob;
    const url = URL.createObjectURL(blob);
    this.loopPlayer?.dispose();
    this.loopPlayer = new Tone.Player({ url, loop: true, autostart: true, volume: -7 }).connect(masterBus);
  }

  isRecording(): boolean {
    return this.recording;
  }

  clearLoop(): void {
    this.loopPlayer?.stop();
    this.loopPlayer?.dispose();
    this.loopPlayer = undefined;
  }

  getLastRecording(): Blob | null {
    return this.lastBlob;
  }
}

let engine: LeafscapeEngine | null = null;

export function createLeafscape(): void {
  engine = new LeafscapeEngine();
}

export function updateLeafscape(
  spikiness: number,
  plantPresence: number,
  spatial: Spatial = NEUTRAL_SPATIAL,
  accent = 0,
): void {
  engine?.update(spikiness, plantPresence, spatial, accent);
}

/** Plays a soft note at a tapped leaf (spik 0=round pad swell, 1=bright ping). */
export const pluckLeafscape = (spik: number) => engine?.pluck(spik);

export function getVoiceLevels(): { round: number; sharp: number } {
  return { round: engine?.roundLevel ?? 0, sharp: engine?.sharpLevel ?? 0 };
}

// Control passthroughs (no-ops before createLeafscape).
export const setBank = (id: string) => engine?.setBank(id);
export const setMode = (mode: ModeName) => engine?.setMode(mode);
export const setTranspose = (semi: number) => engine?.setTranspose(semi);
export const setTimbreBias = (v: number) => engine?.setTimbreBias(v);
export const setSpace = (v: number) => engine?.setSpace(v);
export const setDensity = (v: number) => engine?.setDensity(v);
export const setTempo = (bpm: number) => engine?.setTempo(bpm);
export const getLeafscapeState = () => engine?.getState();

export const startRecording = () => engine?.startRecording();
export const stopRecordingAndLoop = () => engine?.stopRecordingAndLoop();
export const clearLoop = () => engine?.clearLoop();
export const isRecording = () => engine?.isRecording() ?? false;
export const getLastRecording = () => engine?.getLastRecording() ?? null;

// Re-export the option lists the dials iterate over.
export { BANKS } from './banks';
export { MODE_NAMES } from './scales';
export type { ModeName } from './scales';
