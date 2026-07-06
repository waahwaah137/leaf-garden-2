// One walk's memory, accumulated in RAM: circular-mean hue, mean form/vividness, distinct
// "leaf-voices" (hue-family × form buckets), banks visited, poem lines spoken, and a chronological
// hue trail for the keepsake art. Pure data + math — no DOM/Tone imports, so it's node-testable.
// A snapshot serializes to the storage draft slot and back (resume after the app is hidden/killed).

import type { BankGroup } from '../poetry/lexicons';
import { bucketHue } from '../poetry/poet';

const MAX_HUES = 48; // chronological hue samples kept for the card art
const MAX_POEM_LINES = 12;
const AMBIENT_MIN_PRESENCE = 0.08; // ignore ambient samples with little plant in frame

export interface WalkSnapshot {
  startedAt: number;
  hiddenAt?: number; // set when snapshotted for the draft slot
  taps: number;
  hueX: number; // circular hue accumulator (unit vectors)
  hueY: number;
  shapeSum: number;
  colorSum: number;
  presenceSum: number;
  samples: number;
  voices: string[]; // distinct leaf-voice buckets, e.g. "green-round"
  banks: string[]; // bank names visited, in order
  lastGroup?: BankGroup;
  poems: string[]; // first lines of poems spoken
  hues: number[]; // chronological hue trail
}

function freshSnapshot(): WalkSnapshot {
  return {
    startedAt: Date.now(),
    taps: 0,
    hueX: 0,
    hueY: 0,
    shapeSum: 0,
    colorSum: 0,
    presenceSum: 0,
    samples: 0,
    voices: [],
    banks: [],
    poems: [],
    hues: [],
  };
}

export class WalkSession {
  private readonly s: WalkSnapshot;

  /** Fresh walk, or resume from a stored draft snapshot (arrays are copied, not shared). */
  constructor(resume?: WalkSnapshot) {
    this.s = resume
      ? { ...resume, voices: [...resume.voices], banks: [...resume.banks], poems: [...resume.poems], hues: [...resume.hues] }
      : freshSnapshot();
  }

  /** A deliberate leaf pluck — also registers the leaf's voice bucket. */
  recordTap(hueDeg: number, shape: number, colorSignal: number, presence: number): void {
    this.s.taps++;
    this.addSample(hueDeg, shape, colorSignal, presence);
    const voice = `${bucketHue(hueDeg, colorSignal)}-${shape < 0.5 ? 'round' : 'jagged'}`;
    if (!this.s.voices.includes(voice)) this.s.voices.push(voice);
  }

  /** A throttled background sample from the live signals (only when a plant is actually in frame). */
  recordAmbient(hueDeg: number, shape: number, colorSignal: number, presence: number): void {
    if (presence < AMBIENT_MIN_PRESENCE) return;
    this.addSample(hueDeg, shape, colorSignal, presence);
  }

  recordBank(name: string, group: BankGroup): void {
    if (!this.s.banks.includes(name)) this.s.banks.push(name);
    this.s.lastGroup = group;
  }

  recordPoemLine(line: string): void {
    if (this.s.poems.length < MAX_POEM_LINES) this.s.poems.push(line);
  }

  private addSample(hueDeg: number, shape: number, colorSignal: number, presence: number): void {
    const rad = (hueDeg * Math.PI) / 180;
    this.s.hueX += Math.cos(rad);
    this.s.hueY += Math.sin(rad);
    this.s.shapeSum += shape;
    this.s.colorSum += colorSignal;
    this.s.presenceSum += presence;
    this.s.samples++;
    if (this.s.hues.length < MAX_HUES) this.s.hues.push(Math.round(hueDeg));
  }

  minutes(at: number = Date.now()): number {
    return Math.max(0, at - this.s.startedAt) / 60000;
  }

  /** Worth keeping? A pluck, or a minute+ of actual plant-watching (≥6 ambient samples ≈ 30s). */
  isMeaningful(at: number = Date.now()): boolean {
    return this.s.taps > 0 || (this.minutes(at) >= 1 && this.s.samples >= 6);
  }

  meanHue(): number {
    if (this.s.samples === 0) return 120;
    const deg = (Math.atan2(this.s.hueY, this.s.hueX) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  meanShape(): number {
    return this.s.samples > 0 ? this.s.shapeSum / this.s.samples : 0.4;
  }

  meanColor(): number {
    return this.s.samples > 0 ? this.s.colorSum / this.s.samples : 0.4;
  }

  meanPresence(): number {
    return this.s.samples > 0 ? this.s.presenceSum / this.s.samples : 0.3;
  }

  voiceCount(): number {
    return this.s.voices.length;
  }

  /** Serializable copy for the draft slot (stamps hiddenAt = now). */
  snapshot(): WalkSnapshot {
    return {
      ...this.s,
      hiddenAt: Date.now(),
      voices: [...this.s.voices],
      banks: [...this.s.banks],
      poems: [...this.s.poems],
      hues: [...this.s.hues],
    };
  }

  /** Read-only view of the raw accumulator (for keepsake composition). */
  raw(): Readonly<WalkSnapshot> {
    return this.s;
  }
}
