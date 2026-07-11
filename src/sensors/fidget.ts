// The boredom-and-fidget trigger. The fidget wheel doesn't have a button — it emerges when you've
// gone still (no touches for a beat = "behaving bored") and then physically fidget the phone. This
// watches DeviceMotion (gyroscope rotationRate, falling back to linear acceleration) for that wiggle,
// and tracks how long since you last touched the screen.
//
// start() must be called from within the Start gesture: iOS 13+ requires
// DeviceMotionEvent.requestPermission() inside a user gesture (Android needs no permission).

type DeviceMotionEventConstructorWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const ENERGY_ALPHA = 0.16; // EMA on the motion magnitude
const BORED_MS = 4500; // no touch for this long = bored (a precondition for opening)
const FIDGET_ON = 55; // motion energy (≈ deg/s of rotation) that reads as a deliberate fidget

export class FidgetSensor {
  private energy = 0;
  private lastInteractionAt = performance.now();
  private started = false;
  private hasMotion = false;

  /** Request motion (iOS) + start listening. Best-effort — no motion just means the wheel won't open. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (typeof DeviceMotionEvent === 'undefined') return;
    try {
      const DME = DeviceMotionEvent as DeviceMotionEventConstructorWithPermission;
      const granted = typeof DME.requestPermission === 'function' ? await DME.requestPermission() : 'granted';
      if (granted === 'granted') {
        window.addEventListener('devicemotion', this.handleMotion, true);
        this.hasMotion = true;
      }
    } catch {
      /* motion unavailable — wheel simply won't trigger */
    }
  }

  /** Stop listening for motion (e.g. when the app is backgrounded). start() can be called again. */
  stop(): void {
    if (!this.started) return;
    window.removeEventListener('devicemotion', this.handleMotion, true);
    this.started = false;
    this.hasMotion = false;
    this.energy = 0;
  }

  private handleMotion = (e: DeviceMotionEvent): void => {
    let mag = 0;
    const r = e.rotationRate;
    if (r && (r.alpha !== null || r.beta !== null || r.gamma !== null)) {
      const a = r.alpha ?? 0;
      const b = r.beta ?? 0;
      const g = r.gamma ?? 0;
      mag = Math.sqrt(a * a + b * b + g * g); // deg/s
    } else {
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
        // No gyro: use linear-accel magnitude, scaled into the same rough range as deg/s.
        mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z) * 18;
      }
    }
    this.energy += (mag - this.energy) * ENERGY_ALPHA;
  };

  /** Call on any deliberate screen touch — resets the boredom clock. */
  noticeInteraction(): void {
    this.lastInteractionAt = performance.now();
  }

  isBored(now: number = performance.now()): boolean {
    return now - this.lastInteractionAt > BORED_MS;
  }

  isFidgeting(): boolean {
    return this.energy > FIDGET_ON;
  }

  /** Bored (idle a while) AND fidgeting (enough motion) — the moment the wheel should emerge. */
  wantsToOpen(now: number = performance.now()): boolean {
    return this.hasMotion && this.isBored(now) && this.isFidgeting();
  }

  hasMotionSupport(): boolean {
    return this.hasMotion;
  }

  getEnergy(): number {
    return this.energy;
  }
}
