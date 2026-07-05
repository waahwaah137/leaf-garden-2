import { clamp, emaStep } from '../utils/math';

const CAPTURE_WIDTH = 160;
const CAPTURE_HEIGHT = 120;
const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 24;
const SAMPLE_INTERVAL_MS = 110; // ~9Hz — getImageData is the expensive part, throttle it independently of rAF
const SMOOTHING_ALPHA = 0.05;

type FacingMode = 'environment' | 'user';

export class LightSensor {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;
  private lastSampleTime = 0;
  private rawValue = 0.5;
  private smoothedValue = 0.5;
  private started = false;
  private facingMode: FacingMode = 'environment';

  constructor() {
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = SAMPLE_WIDTH;
    this.sampleCanvas.height = SAMPLE_HEIGHT;
    const ctx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create 2D context for light sampling canvas');
    this.sampleCtx = ctx;
  }

  /** Attaches the camera stream to the given <video> element (reused for the dashboard preview) and starts sampling. */
  async start(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;
    await this.openStream(this.facingMode);
    this.started = true;
  }

  /** Uses an already-acquired video track (e.g. from a combined camera+mic getUserMedia call) instead of requesting our own. */
  async attachStream(videoEl: HTMLVideoElement, stream: MediaStream): Promise<void> {
    this.videoEl = videoEl;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
    this.started = true;
  }

  /** Toggles between rear ("environment") and front ("user") cameras, re-requesting getUserMedia. */
  async switchCamera(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;
    const nextFacingMode: FacingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    await this.openStream(nextFacingMode);
    this.facingMode = nextFacingMode;
    this.started = true;
  }

  private async openStream(facingMode: FacingMode): Promise<void> {
    if (!this.videoEl) throw new Error('LightSensor.start() must be called with a <video> element first');

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: CAPTURE_WIDTH },
        height: { ideal: CAPTURE_HEIGHT },
        facingMode: { ideal: facingMode },
      },
      audio: false,
    });

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = newStream;
    this.videoEl.srcObject = newStream;
    await this.videoEl.play();
  }

  getFacingMode(): FacingMode {
    return this.facingMode;
  }

  /** Call every animation frame; internally throttles the expensive pixel read. */
  update(now: number): void {
    if (!this.started || !this.videoEl) return;
    if (now - this.lastSampleTime < SAMPLE_INTERVAL_MS) return;
    if (this.videoEl.readyState < this.videoEl.HAVE_CURRENT_DATA) return;
    this.lastSampleTime = now;

    this.sampleCtx.drawImage(this.videoEl, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const { data } = this.sampleCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      count++;
    }
    this.rawValue = clamp(sum / count / 255, 0, 1);
    this.smoothedValue = emaStep(this.smoothedValue, this.rawValue, SMOOTHING_ALPHA);
  }

  /** Smoothed 0-1 brightness, used to drive audio mapping. */
  getValue(): number {
    return this.smoothedValue;
  }

  getRawValue(): number {
    return this.rawValue;
  }

  isActive(): boolean {
    return this.started;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.started = false;
  }
}
