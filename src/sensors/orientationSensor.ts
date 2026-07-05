import { AngleEma, clamp, emaStep } from '../utils/math';

// iOS-only extensions not present in the standard DOM lib.
interface IOSDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}
type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const HEADING_ALPHA = 0.18;
const TILT_ALPHA = 0.18;
const TILT_MIN_BETA = 20;
const TILT_MAX_BETA = 100;

export type HeadingMode = 'true-north' | 'relative' | 'unavailable';

export class OrientationSensor {
  private headingEma = new AngleEma(HEADING_ALPHA);
  private heading = 0;
  private tiltValue = 0.5;
  private headingMode: HeadingMode = 'unavailable';
  private relativeCalibration: number | null = null;
  private started = false;
  private resolvedSource: 'ios' | 'absolute' | 'relative' | null = null;

  /** Must be called from within a user-gesture handler (e.g. the Start button click) on iOS 13+. */
  async start(): Promise<void> {
    const DOE = DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
    if (typeof DOE.requestPermission === 'function') {
      const result = await DOE.requestPermission();
      if (result !== 'granted') {
        throw new Error('Device orientation permission denied');
      }
    }

    if (typeof DeviceOrientationEvent === 'undefined') {
      throw new Error('DeviceOrientationEvent not supported');
    }

    // Race absolute vs relative sources; prefer whichever gives us usable heading data first.
    window.addEventListener('deviceorientationabsolute', this.handleAbsolute, true);
    window.addEventListener('deviceorientation', this.handleRelative, true);

    this.started = true;
  }

  private handleAbsolute = (event: DeviceOrientationEvent): void => {
    if (event.alpha === null) return;
    if (this.resolvedSource === null) this.resolvedSource = 'absolute';
    if (this.resolvedSource !== 'absolute') return;

    const trueHeading = (360 - event.alpha) % 360;
    this.applyHeading(trueHeading, 'true-north');
    this.applyTilt(event.beta);
  };

  private handleRelative = (event: DeviceOrientationEvent): void => {
    const iosEvent = event as IOSDeviceOrientationEvent;

    if (typeof iosEvent.webkitCompassHeading === 'number') {
      if (this.resolvedSource === null) this.resolvedSource = 'ios';
      if (this.resolvedSource !== 'ios') return;
      this.applyHeading(iosEvent.webkitCompassHeading, 'true-north');
      this.applyTilt(event.beta);
      return;
    }

    // Absolute already claimed the heading source — relative listener only supplies tilt in that case.
    if (this.resolvedSource === 'absolute') {
      this.applyTilt(event.beta);
      return;
    }

    if (event.absolute === true) return; // let handleAbsolute (or the ios check above) own this

    if (event.alpha === null) return;
    if (this.resolvedSource === null) this.resolvedSource = 'relative';
    if (this.resolvedSource !== 'relative') return;

    if (this.relativeCalibration === null) {
      this.relativeCalibration = event.alpha;
    }
    const relativeHeading = (360 - (event.alpha - this.relativeCalibration) + 360) % 360;
    this.applyHeading(relativeHeading, 'relative');
    this.applyTilt(event.beta);
  };

  private applyHeading(rawHeading: number, mode: HeadingMode): void {
    this.headingMode = mode;
    this.heading = this.headingEma.update(rawHeading);
  }

  private applyTilt(beta: number | null): void {
    if (beta === null) return;
    const raw = clamp((beta - TILT_MIN_BETA) / (TILT_MAX_BETA - TILT_MIN_BETA), 0, 1);
    this.tiltValue = emaStep(this.tiltValue, raw, TILT_ALPHA);
  }

  /** Smoothed compass heading in degrees, 0-360. Meaning depends on getHeadingMode(). */
  getHeading(): number {
    return this.heading;
  }

  /** 'true-north' if backed by a real compass reading, 'relative' if calibrated against start orientation only. */
  getHeadingMode(): HeadingMode {
    return this.headingMode;
  }

  /** Smoothed 0-1 tilt value: 0 = phone near-flat (rhythmic role), 1 = phone upright (melodic role). */
  getTiltValue(): number {
    return this.tiltValue;
  }

  isActive(): boolean {
    return this.started && this.headingMode !== 'unavailable';
  }

  stop(): void {
    window.removeEventListener('deviceorientationabsolute', this.handleAbsolute, true);
    window.removeEventListener('deviceorientation', this.handleRelative, true);
    this.started = false;
  }
}
