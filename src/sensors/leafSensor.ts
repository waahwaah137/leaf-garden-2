import { clamp, emaStep, lerp } from '../utils/math';
import { isCvReady } from '../vision/opencvLoader';
import { analyzeLeafShape, type LeafBox } from '../vision/leafShapeCv';

// Analysis resolution — higher than the old brightness sensor because edge/corner
// detection needs spatial detail. Still tiny, so per-frame CPU stays cheap on phones.
const SAMPLE_WIDTH = 80;
const SAMPLE_HEIGHT = 60;
const CAPTURE_WIDTH = 320;
const CAPTURE_HEIGHT = 240;
const SAMPLE_INTERVAL_MS = 100; // ~10Hz; the getImageData + convolution is the expensive part

const SMOOTHING_ALPHA = 0.12; // EMA on the derived metrics

// Vegetation detection: excess-green index exg = 2g - r - b (on 0-255 channels).
// Foliage sits well above this threshold; grey/skin/sky/wood fall below it.
const EXG_THRESHOLD = 24;
const MIN_LUMA = 28; // ignore near-black pixels (noise in shadow)
const MAX_LUMA = 245; // ignore blown-out highlights

// Edge/corner thresholds and blend weights, tuned for the 0-1 spikiness output.
const EDGE_MAG_NORM = 420; // Sobel magnitude that maps to "1.0" edge strength (lower = pick up fainter edges)
const STRONG_EDGE = 0.2; // normalized edge magnitude counted as an actual leaf outline
const CORNER_THRESHOLD = 0.055; // Harris response (normalized) counted as a corner/spike
const EDGE_WEIGHT = 0.5;
const CORNER_WEIGHT = 0.5;

// The Sensitivity slider drives BOTH a gain on the raw shape blend (subtle edge
// differences become audible) and the steepness of the round<->sharp contrast curve.
const SENS_GAIN_MIN = 1.8; // slider = 0
const SENS_GAIN_MAX = 6.5; // slider = 1
const SENS_CONTRAST_MIN = 0.1; // slider = 0 -> nearly linear
const SENS_CONTRAST_MAX = 0.85; // slider = 1 -> hard round/sharp split
const DEFAULT_SENSITIVITY = 0.6;

/**
 * Normalized logistic "contrast" curve centered at 0.5: pushes values toward 0 or 1 as
 * `amount` rises, while keeping the 0->0 / 0.5->0.5 / 1->1 anchors. Sharpens the
 * distinction between round and pointy leaves without clipping the extremes.
 */
function contrastCurve(x: number, amount: number): number {
  const k = lerp(1, 12, amount);
  const f = (v: number) => 1 / (1 + Math.exp(-k * (v - 0.5)));
  const lo = f(0);
  const hi = f(1);
  return clamp((f(x) - lo) / (hi - lo), 0, 1);
}

type FacingMode = 'environment' | 'user';

/**
 * Camera analyzer that isolates plant/foliage pixels (excess-green mask), traces leaf
 * outlines (Sobel), and scores how "pointy" vs "round" the visible leaves are (corner
 * density + edge density). Drives the leaf soundscape.
 *
 * Public camera methods mirror the old LightSensor so ui/permissions.ts can drive it
 * unchanged (start / attachStream / switchCamera / getFacingMode / stop).
 */
export class LeafSensor {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;
  private lastSampleTime = 0;
  private started = false;
  private facingMode: FacingMode = 'environment';

  // Derived, smoothed metrics (0-1).
  private spikiness = 0;
  private plantPresence = 0;
  private sensitivity = DEFAULT_SENSITIVITY;

  // Reusable buffers so we don't allocate per frame.
  private readonly luma = new Float32Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
  private readonly isPlant = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
  private readonly mask255 = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT); // 0/255 for OpenCV
  private readonly edgeMag = new Float32Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
  private overlayImage: ImageData | null = null;

  // OpenCV tracking output (empty when running the heuristic fallback).
  private leafBoxes: LeafBox[] = [];
  private usingCv = false;

  constructor() {
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = SAMPLE_WIDTH;
    this.sampleCanvas.height = SAMPLE_HEIGHT;
    const ctx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create 2D context for leaf sampling canvas');
    this.sampleCtx = ctx;
  }

  /** Attaches the camera stream to the given <video> element and starts sampling. */
  async start(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;
    await this.openStream(this.facingMode);
    this.started = true;
  }

  /** Uses an already-acquired video track (e.g. from a combined camera+mic getUserMedia call). */
  async attachStream(videoEl: HTMLVideoElement, stream: MediaStream): Promise<void> {
    this.videoEl = videoEl;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
    this.started = true;
  }

  /** Toggles between rear ("environment") and front ("user") cameras. */
  async switchCamera(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;
    const nextFacingMode: FacingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    await this.openStream(nextFacingMode);
    this.facingMode = nextFacingMode;
    this.started = true;
  }

  private async openStream(facingMode: FacingMode): Promise<void> {
    if (!this.videoEl) throw new Error('LeafSensor.start() must be called with a <video> element first');

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

  isActive(): boolean {
    return this.started;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.started = false;
  }

  /** Call every animation frame; internally throttles the expensive pixel read + convolution. */
  update(now: number): void {
    if (!this.started || !this.videoEl) return;
    if (now - this.lastSampleTime < SAMPLE_INTERVAL_MS) return;
    if (this.videoEl.readyState < this.videoEl.HAVE_CURRENT_DATA) return;
    this.lastSampleTime = now;

    this.sampleCtx.drawImage(this.videoEl, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const image = this.sampleCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    this.analyze(image);
  }

  private analyze(image: ImageData): void {
    const { data } = image;
    const w = SAMPLE_WIDTH;
    const h = SAMPLE_HEIGHT;

    // Pass 1: luma + vegetation mask.
    let plantCount = 0;
    for (let p = 0, i = 0; p < this.luma.length; p++, i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      this.luma[p] = y;
      const exg = 2 * g - r - b;
      const plant = exg > EXG_THRESHOLD && y > MIN_LUMA && y < MAX_LUMA ? 1 : 0;
      this.isPlant[p] = plant;
      this.mask255[p] = plant ? 255 : 0;
      plantCount += plant;
    }
    const plantPresenceRaw = plantCount / this.luma.length;

    // Pass 2: Sobel edge magnitude on luma, kept only where the plant mask is set
    // (we only care about *leaf* outlines, not background clutter).
    this.edgeMag.fill(0);
    let edgeSum = 0;
    let strongEdgeCount = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!this.isPlant[p]) continue;

        const tl = this.luma[p - w - 1];
        const tc = this.luma[p - w];
        const tr = this.luma[p - w + 1];
        const ml = this.luma[p - 1];
        const mr = this.luma[p + 1];
        const bl = this.luma[p + w - 1];
        const bc = this.luma[p + w];
        const br = this.luma[p + w + 1];

        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
        const mag = clamp(Math.sqrt(gx * gx + gy * gy) / EDGE_MAG_NORM, 0, 1);
        this.edgeMag[p] = mag;
        edgeSum += mag;
        if (mag > STRONG_EDGE) strongEdgeCount++;
      }
    }
    // Edge density = share of plant pixels that are strong leaf outlines.
    const edgeDensity = plantCount > 0 ? strongEdgeCount / plantCount : 0;

    // Pass 3: Harris-style corner response over the edge map. Corners/spikes (where
    // gradients point in many directions within a small window) mark pointy leaf tips;
    // long smooth outlines of round leaves score low.
    let cornerCount = 0;
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const p = y * w + x;
        if (this.edgeMag[p] <= STRONG_EDGE) continue;

        let sxx = 0;
        let syy = 0;
        let sxy = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const q = p + dy * w + dx;
            // Recompute local gradient from luma (cheap, window is 3x3).
            const gx = this.luma[q + 1] - this.luma[q - 1];
            const gy = this.luma[q + w] - this.luma[q - w];
            sxx += gx * gx;
            syy += gy * gy;
            sxy += gx * gy;
          }
        }
        const det = sxx * syy - sxy * sxy;
        const trace = sxx + syy;
        // Harris response R = det - k*trace^2, normalized by trace^2 to stay scale-free.
        const response = trace > 1 ? (det - 0.05 * trace * trace) / (trace * trace) : 0;
        if (response > CORNER_THRESHOLD) cornerCount++;
      }
    }
    const cornerDensity = strongEdgeCount > 0 ? cornerCount / strongEdgeCount : 0;

    // Derive raw pointiness. Prefer OpenCV contour analysis (accurate) when its runtime is
    // ready; otherwise fall back to the edge+corner heuristic so the app always responds.
    // The Sensitivity dial then steepens the round↔sharp distinction either way.
    let spikinessRaw = 0;
    this.leafBoxes = [];
    this.usingCv = false;
    if (plantPresenceRaw > 0.02) {
      const contrast = lerp(SENS_CONTRAST_MIN, SENS_CONTRAST_MAX, this.sensitivity);
      let cvOk = false;
      if (isCvReady()) {
        const result = analyzeLeafShape(this.mask255, w, h);
        if (result) {
          this.usingCv = true;
          this.leafBoxes = result.boxes;
          // cv spikiness is already ~0-1; apply a gentle gain + the contrast curve.
          const scaled = clamp(result.spikiness * lerp(1.0, 1.8, this.sensitivity), 0, 1);
          spikinessRaw = contrastCurve(scaled, contrast);
          cvOk = true;
        }
      }
      if (!cvOk) {
        const gain = lerp(SENS_GAIN_MIN, SENS_GAIN_MAX, this.sensitivity);
        const blended = clamp((EDGE_WEIGHT * edgeDensity + CORNER_WEIGHT * cornerDensity) * gain, 0, 1);
        spikinessRaw = contrastCurve(blended, contrast);
      }
    }

    this.plantPresence = emaStep(this.plantPresence, plantPresenceRaw, SMOOTHING_ALPHA);
    this.spikiness = emaStep(this.spikiness, spikinessRaw, SMOOTHING_ALPHA);

    void edgeSum; // (kept for future tuning/telemetry)
    this.buildOverlay();
  }

  /** Builds an ImageData at analysis resolution: green tint on plant pixels, white on strong edges. */
  private buildOverlay(): void {
    if (!this.overlayImage) {
      this.overlayImage = this.sampleCtx.createImageData(SAMPLE_WIDTH, SAMPLE_HEIGHT);
    }
    const out = this.overlayImage.data;
    for (let p = 0, i = 0; p < this.edgeMag.length; p++, i += 4) {
      if (this.edgeMag[p] > STRONG_EDGE) {
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = 235; // white leaf edges
      } else if (this.isPlant[p]) {
        out[i] = 60;
        out[i + 1] = 230;
        out[i + 2] = 120;
        out[i + 3] = 90; // translucent green plant mask
      } else {
        out[i + 3] = 0; // transparent — show raw video underneath
      }
    }
  }

  /**
   * Draws the plant-mask + leaf-edge overlay onto the given canvas context, stretched to
   * fill it. The overlay is at analysis resolution; nearest-neighbour upscaling gives a
   * clean pixelated look over the live video.
   */
  renderOverlay(ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number): void {
    if (!this.overlayImage) return;
    // Blit the small ImageData into a scratch canvas, then draw it scaled.
    this.sampleCtx.putImageData(this.overlayImage, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(this.sampleCanvas, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT, 0, 0, targetWidth, targetHeight);
  }

  /** 0 = round/smooth leaves, 1 = sharp/pointy leaves. Smoothed. */
  getSpikiness(): number {
    return this.spikiness;
  }

  /** 1 - spikiness, for convenience/display. */
  getRoundness(): number {
    return 1 - this.spikiness;
  }

  /** Fraction of the frame that reads as plant/foliage (0-1). Smoothed. */
  getPlantPresence(): number {
    return this.plantPresence;
  }

  /**
   * Sets how aggressively round vs pointy leaves are distinguished (0-1). Higher values
   * amplify subtle edge/corner differences and steepen the contrast between the two, so
   * the audio morph swings harder for small shape changes.
   */
  setSensitivity(value: number): void {
    this.sensitivity = clamp(value, 0, 1);
  }

  getSensitivity(): number {
    return this.sensitivity;
  }

  /** Whether the accurate OpenCV path produced this frame's metrics (vs. the fallback). */
  isUsingCv(): boolean {
    return this.usingCv;
  }

  /** Tracked leaf bounding boxes (normalized 0-1) for the overlay. Empty in fallback mode. */
  getLeafBoxes(): LeafBox[] {
    return this.leafBoxes;
  }

  /** Spatial summary for the audio engine: leaf count, mean centre-x, mean normalized area. */
  getSpatial(): { count: number; avgX: number; avgArea: number } {
    const boxes = this.leafBoxes;
    if (boxes.length === 0) return { count: 0, avgX: 0.5, avgArea: 0 };
    let sx = 0;
    let sa = 0;
    for (const b of boxes) {
      sx += b.x + b.w / 2;
      sa += b.w * b.h;
    }
    return {
      count: boxes.length,
      avgX: sx / boxes.length,
      avgArea: clamp((sa / boxes.length) * 6, 0, 1),
    };
  }
}
