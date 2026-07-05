import * as Tone from 'tone';
import { clamp, emaStep } from '../utils/math';

const SAMPLE_INTERVAL_MS = 60; // ~16Hz, throttled independently of rAF
const MAPPING_SMOOTHING_ALPHA = 0.09; // slower — feeds tempo/intensity, avoid jitter
const DISPLAY_ATTACK_ALPHA = 0.6; // fast attack for a lively meter
const DISPLAY_RELEASE_ALPHA = 0.08; // slow release ("peak hold with decay")
const RMS_TO_UNIT_SCALE = 4; // empirical: typical ambient RMS rarely exceeds ~0.25

export class MicSensor {
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: Tone.Analyser | null = null;
  private lastSampleTime = 0;
  private mappingValue = 0.3; // moderate default so tempo/intensity aren't pinned at minimum when mic is unavailable
  private displayValue = 0;
  private waveform: Float32Array = new Float32Array(1024);
  private started = false;

  async start(): Promise<void> {
    // Raw getUserMedia (rather than Tone.UserMedia) so we can disable
    // AGC/noise-suppression/echo-cancellation — they actively fight
    // measuring true ambient loudness, which is exactly what we want here.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.attachStream(stream);
  }

  /** Uses an already-acquired audio track (e.g. from a combined camera+mic getUserMedia call) instead of requesting our own. */
  attachStream(stream: MediaStream): void {
    this.stream = stream;
    const rawContext = Tone.getContext().rawContext as AudioContext;
    this.sourceNode = rawContext.createMediaStreamSource(stream);
    this.analyser = new Tone.Analyser('waveform', 1024);
    Tone.connect(this.sourceNode, this.analyser);
    this.started = true;
  }

  update(now: number): void {
    if (!this.started || !this.analyser) return;
    if (now - this.lastSampleTime < SAMPLE_INTERVAL_MS) return;
    this.lastSampleTime = now;

    const data = this.analyser.getValue() as Float32Array;
    this.waveform = data;

    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const raw = clamp(rms * RMS_TO_UNIT_SCALE, 0, 1);

    this.mappingValue = emaStep(this.mappingValue, raw, MAPPING_SMOOTHING_ALPHA);

    const attackAlpha = raw > this.displayValue ? DISPLAY_ATTACK_ALPHA : DISPLAY_RELEASE_ALPHA;
    this.displayValue = emaStep(this.displayValue, raw, attackAlpha);
  }

  /** Smoothed 0-1 "wind" value, used to drive tempo/intensity mapping. */
  getValue(): number {
    return this.mappingValue;
  }

  /** Fast-attack/slow-release 0-1 value, for a lively UI meter only. */
  getDisplayLevel(): number {
    return this.displayValue;
  }

  getWaveform(): Float32Array {
    return this.waveform;
  }

  isActive(): boolean {
    return this.started;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.started = false;
  }
}
