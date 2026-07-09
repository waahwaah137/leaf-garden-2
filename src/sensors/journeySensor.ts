// Privacy-first journey sensing: the walk is a *feeling of distance*, never a map.
//
// Geolocation path: watchPosition → Haversine delta from the previous fix → add to a running
// distance → the coordinates are immediately discarded (only the last fix is kept, solely to
// compute the next delta; no lat/lng history ever exists in memory or storage).
//
// Fallback: green spaces often have poor GPS and browser geolocation needs network assistance, so
// DeviceMotion (accelerometer energy) gives a coarse walking-vs-resting pulse and synthesizes a
// gentle walking pace while moving. Both paths emit "segments" (meters moved) that drive the
// abstract trail sigil and the travelling soundscape.
//
// start() must be called from a user-gesture handler: iOS 13+ requires
// DeviceMotionEvent.requestPermission() inside a gesture, and the geolocation prompt is friendlier
// there too. The whole layer is opt-in (nothing is requested until the user enables "journey").

type DeviceMotionEventConstructorWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const MAX_ACCURACY_M = 50; // ignore fixes worse than this
const MIN_DELTA_M = 3; // jitter floor — GPS wobble while standing still
const MAX_DELTA_M = 200; // teleport guard — cold-start jumps and tower handoffs
const MOVING_WINDOW_MS = 8000; // "moving" = a segment landed within this window

const MOTION_ENERGY_ALPHA = 0.08; // EMA on accel magnitude
const MOTION_ENERGY_ON = 1.1; // m/s² of sustained jostle that reads as walking
const MOTION_TICK_MS = 4000; // synth cadence while walking on the motion path
const MOTION_WALK_MPS = 1.2; // gentle assumed walking pace

export interface JourneyStatus {
  active: boolean;
  geo: boolean; // at least one usable GPS fix has arrived
  motion: boolean; // accelerometer is listening
}

/** Great-circle distance in meters. Exported for the sandbox self-check. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class JourneySensor {
  private watchId: number | null = null;
  // The ONLY positional state: the previous fix, kept just long enough to compute the next delta.
  private lastLat: number | null = null;
  private lastLon: number | null = null;

  private distanceM = 0;
  private active = false;
  private geoOk = false;
  private motionOk = false;
  private lastMovementAt = 0;

  private energy = 0; // accel-magnitude EMA (walking jostle)
  private lastMotionSynth = 0;

  private readonly segmentCbs = new Set<(meters: number) => void>();

  /** Registers a listener for movement segments (meters). Returns an unsubscribe. */
  onSegment(cb: (meters: number) => void): () => void {
    this.segmentCbs.add(cb);
    return () => this.segmentCbs.delete(cb);
  }

  /** Call from a user-gesture handler. Requests motion permission (iOS) and starts both paths. */
  async start(): Promise<JourneyStatus> {
    if (this.active) return this.status();
    this.active = true;

    // Motion path (also the iOS permission that must happen synchronously in the gesture).
    if (typeof DeviceMotionEvent !== 'undefined') {
      try {
        const DME = DeviceMotionEvent as DeviceMotionEventConstructorWithPermission;
        const granted = typeof DME.requestPermission === 'function' ? await DME.requestPermission() : 'granted';
        if (granted === 'granted') {
          window.addEventListener('devicemotion', this.handleMotion, true);
          this.motionOk = true;
        }
      } catch {
        /* motion unavailable — geo (or nothing) will carry the journey */
      }
    }

    // Geolocation path.
    if (navigator.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(this.handleFix, () => {
        /* denied/unavailable — the motion path keeps the journey alive */
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    }

    return this.status();
  }

  stop(): void {
    if (this.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    window.removeEventListener('devicemotion', this.handleMotion, true);
    this.active = false;
    this.geoOk = false;
    this.motionOk = false;
    this.lastLat = null;
    this.lastLon = null;
    // distanceM is deliberately kept — the walk's total survives toggling the sensor.
  }

  private handleFix = (pos: GeolocationPosition): void => {
    const { latitude, longitude, accuracy } = pos.coords;
    if (accuracy > MAX_ACCURACY_M) return;

    if (this.lastLat !== null && this.lastLon !== null) {
      const delta = haversineMeters(this.lastLat, this.lastLon, latitude, longitude);
      if (delta >= MIN_DELTA_M && delta <= MAX_DELTA_M) this.addSegment(delta);
    }
    // Overwrite (never accumulate) the fix — this is the coordinate-discarding contract.
    this.lastLat = latitude;
    this.lastLon = longitude;
    this.geoOk = true;
  };

  private handleMotion = (event: DeviceMotionEvent): void => {
    const a = event.acceleration;
    let mag: number | null = null;
    if (a && a.x !== null && a.y !== null && a.z !== null) {
      mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    } else {
      const g = event.accelerationIncludingGravity;
      if (g && g.x !== null && g.y !== null && g.z !== null) {
        mag = Math.abs(Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z) - 9.81);
      }
    }
    if (mag === null) return;
    this.energy += (mag - this.energy) * MOTION_ENERGY_ALPHA;

    // Only synthesize distance when GPS isn't delivering — geo is the source of truth when present.
    if (this.geoOk) return;
    const now = Date.now();
    if (this.energy > MOTION_ENERGY_ON && now - this.lastMotionSynth > MOTION_TICK_MS) {
      this.lastMotionSynth = now;
      this.addSegment((MOTION_WALK_MPS * MOTION_TICK_MS) / 1000);
    }
  };

  private addSegment(meters: number): void {
    this.distanceM += meters;
    this.lastMovementAt = Date.now();
    for (const cb of this.segmentCbs) cb(meters);
  }

  getDistanceM(): number {
    return this.distanceM;
  }

  /** Restores the running total (e.g. when resuming a drafted walk). */
  setDistanceM(meters: number): void {
    this.distanceM = Math.max(0, meters);
  }

  isMoving(): boolean {
    return Date.now() - this.lastMovementAt < MOVING_WINDOW_MS;
  }

  isActive(): boolean {
    return this.active;
  }

  /** True when neither geo nor motion is delivering — callers may fall back to time-based drift. */
  isSignalless(): boolean {
    return this.active && !this.geoOk && !this.motionOk;
  }

  status(): JourneyStatus {
    return { active: this.active, geo: this.geoOk, motion: this.motionOk };
  }
}
