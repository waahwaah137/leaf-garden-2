import * as Tone from 'tone';
import { clamp, lerp, smoothstep } from '../utils/math';
import { masterBus } from './engine';
import { bankById, type Bank } from './banks';
import { degreeToMidi, makeScale, type ModeName, type ScaleDef } from './scales';

const RAMP = 0.25; // seconds — smoothing for shape-driven parameter changes

/** Spatial summary of the tracked leaves, used to map vision → sound. */
export interface Spatial {
  count: number; // number of tracked leaves
  avgX: number; // 0 (left) .. 1 (right)
  avgArea: number; // 0 .. 1, mean normalized leaf area
}

const NEUTRAL_SPATIAL: Spatial = { count: 0, avgX: 0.5, avgArea: 0 };

// Minimum green (plant presence, 0..1) in frame before the instrument makes ANY sound. Below GREEN_LO
// everything is silent — taps, drags, and the ambient bed alike; by GREEN_HI it's at full level.
// "Point at anything green — it's yours to play": no green, no sound. Tunable.
export const GREEN_LO = 0.035;
export const GREEN_HI = 0.07;

/** The vision sampled under the finger during a drag: Hu shape + HSL hue/colour of the nearest leaf. */
export interface DragVision {
  shape: number; // 0 round/compact → 1 jagged/elongated (from Hu moments)
  hue: number; // 0..360
  color: number; // 0..1 colour richness
}

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

  // Drag textures: three quiet, glide-free, vision-driven instruments (one per play mode). All route
  // through dragBus so a drag is always subordinate to a tap. Persistent across bank switches (they
  // read the live scale). See buildDrag / dragStart / dragMove / dragEnd.
  private dragBus!: Tone.Gain;
  private brushPluck!: Tone.PluckSynth; // mode 1 — rustling grains
  private windNoise!: Tone.Noise; // mode 2 — filtered-noise breath
  private windFilter!: Tone.Filter;
  private windGain!: Tone.Gain;
  private bowSynth!: Tone.Synth; // mode 3 — soft stepped pad
  private bowFilter!: Tone.Filter;
  private windOn = false;
  private lastGrainAt = 0; // brush throttle (ms, performance.now)
  private bowDegree = Number.NaN; // last bowed degree (retrigger only when the step changes)

  // State
  private bank: Bank = bankById('glass');
  private mode: ModeName = this.bank.mode;
  private scale: ScaleDef = makeScale(this.bank.rootMidi, this.bank.mode);
  private transpose = 0; // semitones (Pitch dial)
  private timbreBias = 0.5; // Frequency/Timbre dial (0..1)
  private space = 0.5; // Space dial (0..1)
  private density = 0.6; // Density dial (0..1)
  private spatial: Spatial = NEUTRAL_SPATIAL;
  private arpDegree = 8;
  private playMode: 1 | 2 | 3 = 1; // touch/drag position→sound mapping (see positionToMusic)

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
    this.buildDrag();
    Tone.Transport.bpm.value = this.bank.bpm;
  }

  private buildDrag(): void {
    // Everything drag-related sits well below the leads (dragBus ≈ −14 dB) and shares the reverb +
    // presence gate, so a drag is never the loudest sound.
    this.dragBus = new Tone.Gain(0.2).connect(this.reverb);

    // Mode 1 — Brush: soft plucked grains (Karplus-Strong), retriggered as the finger moves.
    this.brushPluck = new Tone.PluckSynth({ attackNoise: 0.8, dampening: 2600, resonance: 0.72, release: 0.6 });
    this.brushPluck.volume.value = -8;
    this.brushPluck.connect(this.dragBus);

    // Mode 2 — Wind: pink noise → bandpass → breath-swell gain → bus. The noise only runs while a
    // wind-drag is active (started/stopped on demand, not left humming).
    this.windGain = new Tone.Gain(0).connect(this.dragBus);
    this.windFilter = new Tone.Filter(700, 'bandpass');
    this.windFilter.Q.value = 8; // resonant → the noise whistles a pitch (tuned live by X)
    this.windFilter.connect(this.windGain);
    this.windNoise = new Tone.Noise('pink');
    this.windNoise.volume.value = -3;
    this.windNoise.connect(this.windFilter);

    // Mode 3 — Bow: a soft sustained voice → its own lowpass → bus. No portamento → clean steps.
    this.bowFilter = new Tone.Filter(1200, 'lowpass').connect(this.dragBus);
    this.bowFilter.Q.value = 0.8;
    this.bowSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.25, decay: 0.2, sustain: 0.8, release: 0.6 },
      portamento: 0,
      volume: -9,
    }).connect(this.bowFilter);
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

  update(shapeSignal: number, colorSignal: number, presence: number, spatial: Spatial, accent = 0): void {
    this.spatial = spatial;
    const s = clamp(shapeSignal, 0, 1);

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

    // Color signal → the sharp voice's echo character, modulated AROUND each bank's base
    // delay values (orthogonal to the Space/Density dials, which only touch reverb/arp).
    const cc = clamp(colorSignal, 0, 1);
    const fb = clamp(this.bank.sharp.delayFeedback + (cc - 0.5) * 2 * 0.15, 0.05, 0.92);
    const dwet = clamp(this.bank.sharp.delayWet * lerp(0.65, 1.35, cc), 0, 1);
    this.sharpDelay.feedback.rampTo(fb, RAMP);
    this.sharpDelay.wet.rampTo(dwet, RAMP);

    // Green gate: the WHOLE output is masked by how much green is in frame — below GREEN_LO there's
    // no sound at all, even from a deliberate tap/drag. Above it, the ambient bed scales with presence
    // and a touch (accent) lifts to full. ("Point at anything green — it's yours to play.")
    const greenMask = smoothstep(GREEN_LO, GREEN_HI, presence);
    const gateLevel = greenMask * Math.max(smoothstep(0.05, 0.18, presence), accent * 0.85);
    this.gate.gain.rampTo(gateLevel, RAMP);
  }

  setPlayMode(mode: 1 | 2 | 3): void {
    this.playMode = mode;
  }

  /**
   * Maps a normalized touch point (0..1) to a musical position, per the active play mode. Returns a
   * scale degree (fed to degreeToMidi, which wraps octaves), an octave shift in degrees, and a 0..1
   * brightness. Top of screen (small y) is bright / high; the pitch axis spans ~2 octaves.
   */
  private positionToMusic(x: number, y: number): { degree: number; octaveShift: number; brightness: number } {
    const len = this.scale.intervals.length;
    const span = 2 * len; // ~2 octaves across the pitch axis
    const cx = clamp(x, 0, 1);
    const cy = clamp(y, 0, 1);
    switch (this.playMode) {
      case 2: // X = pitch (within one octave) · Y = octave
        return { degree: Math.round(cx * (len - 1)), octaveShift: Math.round((1 - cy) * 2) * len, brightness: 0.5 };
      case 3: // Y = pitch (up is higher) · X = brightness
        return { degree: Math.round((1 - cy) * span), octaveShift: 0, brightness: cx };
      case 1: // X = pitch · Y = brightness (top = bright)
      default:
        return { degree: Math.round(cx * span), octaveShift: 0, brightness: 1 - cy };
    }
  }

  /**
   * Plays one soft note at the touched point. Pitch + timbre follow the position (via
   * positionToMusic), quantized to the current scale so it's always in key. Brightness (and, softly,
   * leaf pointiness) chooses the bright arp vs the round pad; touching a tracked leaf (`onLeaf`) adds
   * a brighter, louder accent.
   */
  pluck(shape: number, x = 0.5, y = 0.5, onLeaf = false): void {
    const { degree, octaveShift, brightness } = this.positionToMusic(x, y);
    const b = clamp(brightness, 0, 1);
    const accent = onLeaf ? 0.2 : 0;
    // Blend brightness with a little leaf-shape influence to pick the voice.
    const bright = b + accent * 0.5 + (clamp(shape, 0, 1) - 0.5) * 0.3;
    if (bright >= 0.5) {
      // Bright voice, one octave above the pad's register.
      const midi =
        degreeToMidi(this.scale, degree + octaveShift, this.bank.round.degreeOffset + this.scale.intervals.length) +
        this.transpose;
      const velocity = clamp(0.5 + b * 0.35 + accent, 0, 1);
      this.sharpVoice?.triggerAttackRelease(midiToNote(midi), '8n', undefined, velocity);
      emitNote({ voice: 'sharp', velocity });
    } else {
      const midi = degreeToMidi(this.scale, degree + octaveShift, this.bank.round.degreeOffset) + this.transpose;
      const velocity = clamp(0.42 + (1 - b) * 0.3 + accent, 0, 1);
      this.pad?.triggerAttackRelease(midiToNote(midi), '2n', undefined, velocity);
      emitNote({ voice: 'round', velocity });
    }
  }

  // --- Drag textures (press-and-drag) -------------------------------------------------
  /** X position → a scale-quantized note, ~2 octaves, in the drag register (an octave up). */
  private dragNote(x: number): { degree: number; note: string } {
    const len = this.scale.intervals.length;
    const degree = Math.round(clamp(x, 0, 1) * 2 * len);
    const midi = degreeToMidi(this.scale, degree, this.bank.round.degreeOffset + len) + this.transpose;
    return { degree, note: midiToNote(midi) };
  }

  /** Mode 1 — Brush: emit a soft plucked grain, gated by drag speed + Hu jaggedness under the finger. */
  private brushGrain(x: number, v: DragVision, speed: number): void {
    const jag = clamp(v.shape, 0, 1);
    const drive = clamp(speed * 0.5 + jag * 0.55, 0, 1);
    const now = performance.now();
    const minGap = lerp(120, 45, drive); // faster/jaggeder → denser rustle
    if (now - this.lastGrainAt < minGap) return;
    this.lastGrainAt = now;
    if (Math.random() > clamp(0.25 + drive * 0.7, 0, 1)) return; // a still finger barely rustles
    const { note } = this.dragNote(x);
    this.brushPluck.dampening = lerp(1400, 5200, jag); // jagged leaf → brighter pluck
    this.brushPluck.volume.value = lerp(-15, -5, drive); // soft; PluckSynth has no per-note velocity
    this.brushPluck.triggerAttack(note);
  }

  /**
   * Mode 2 — Wind: a pitched "whistling wind." A high-resonance bandpass tuned to a scale note by X
   * makes the noise sing an in-key tone that varies as you move; colour/hue push the resonance, and
   * height sets the breath level. Airy like before, but with real tonal variation.
   */
  private applyWind(x: number, y: number, v: DragVision): void {
    const cc = clamp(v.color, 0, 1);
    const hue01 = clamp(v.hue / 360, 0, 1);
    const freq = Tone.Frequency(this.dragNote(x).note).toFrequency();
    this.windFilter.frequency.rampTo(freq, 0.08);
    // High Q → the noise resonates a clear pitch; richer colour/hue makes it sing more.
    this.windFilter.Q.rampTo(clamp(lerp(7, 16, cc) * (0.85 + 0.3 * hue01), 4, 22), 0.1);
    const airier = 0.5 + 0.6 * (1 - clamp(y, 0, 1)); // higher on screen = fuller breath
    this.windGain.gain.rampTo(clamp(lerp(0.2, 0.6, cc) * airier, 0, 0.75), 0.15);
  }

  /** Mode 3 — Bow: Hu jaggedness under the finger opens its own filter (round = pure, jagged = textured). */
  private applyBowTimbre(v: DragVision): void {
    this.bowFilter.frequency.rampTo(lerp(600, 4000, clamp(v.shape, 0, 1)), 0.15);
  }

  dragStart(x: number, y: number, v: DragVision): void {
    switch (this.playMode) {
      case 2:
        this.applyWind(x, y, v);
        if (!this.windOn) {
          this.windNoise.start();
          this.windOn = true;
        }
        break;
      case 3: {
        const { degree, note } = this.dragNote(x);
        this.bowDegree = degree;
        this.applyBowTimbre(v);
        this.bowSynth.triggerAttack(note);
        break;
      }
      case 1:
      default:
        this.lastGrainAt = 0; // allow an immediate first grain
        this.brushGrain(x, v, 1);
        break;
    }
  }

  dragMove(x: number, y: number, v: DragVision, speed: number): void {
    switch (this.playMode) {
      case 2:
        this.applyWind(x, y, v);
        break;
      case 3: {
        this.applyBowTimbre(v);
        const { degree, note } = this.dragNote(x);
        if (degree !== this.bowDegree) {
          this.bowDegree = degree;
          this.bowSynth.setNote(note); // portamento 0 → a clean step, no glide
        }
        break;
      }
      case 1:
      default:
        this.brushGrain(x, v, speed);
        break;
    }
  }

  /** Ends any active drag texture (called on pointer up AND cancel). Safe to call redundantly. */
  dragEnd(): void {
    if (this.windOn) {
      this.windGain.gain.rampTo(0, 0.2);
      this.windNoise.stop('+0.25');
      this.windOn = false;
    }
    this.bowSynth.triggerRelease();
    this.bowDegree = Number.NaN;
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
  shapeSignal: number,
  colorSignal: number,
  plantPresence: number,
  spatial: Spatial = NEUTRAL_SPATIAL,
  accent = 0,
): void {
  engine?.update(shapeSignal, colorSignal, plantPresence, spatial, accent);
}

/** Plays a soft note at a touched point; pitch/timbre follow position (see LeafscapeEngine.pluck). */
export const pluckLeafscape = (shape: number, x = 0.5, y = 0.5, onLeaf = false) =>
  engine?.pluck(shape, x, y, onLeaf);

/** Switches the play mode (1: Brush, 2: Wind, 3: Bow — each a different tap mapping + drag texture). */
export const setPlayMode = (mode: 1 | 2 | 3) => engine?.setPlayMode(mode);

// Press-and-drag textures. `v` is the vision sampled under the finger (Hu shape + HSL hue/colour);
// `speed` is a 0..1-ish drag-speed estimate. The active mode picks Brush / Wind / Bow.
export const dragStart = (x: number, y: number, v: DragVision) => engine?.dragStart(x, y, v);
export const dragMove = (x: number, y: number, v: DragVision, speed: number) => engine?.dragMove(x, y, v, speed);
export const dragEnd = () => engine?.dragEnd();

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
