import { getDefaultVolume, setMasterVolume, getMasterAudioStream } from './audio/engine';
import {
  BANKS,
  MODE_NAMES,
  createLeafscape,
  updateLeafscape,
  getLeafscapeState,
  setBank,
  setMode,
  setTranspose,
  setTimbreBias,
  setSpace,
  setDensity,
  setTempo,
  pluckLeafscape,
} from './audio/leafscape';
import {
  startClip,
  stopClip,
  drawClipFrame,
  isClipRecording,
  isClipSupported,
  shareOrDownloadClip,
} from './ui/clipRecorder';
import { LeafSensor } from './sensors/leafSensor';
import { MicSensor } from './sensors/micSensor';
import { OrientationSensor } from './sensors/orientationSensor';
import { loadOpenCv } from './vision/opencvLoader';
import { Knob } from './ui/knob';
import { createBankSelect, type BankSelectHandle } from './ui/bankSelect';
import { addRipple, addTrailPoint } from './ui/overlay';
import { clamp, lerp } from './utils/math';
import { initDashboard, render, setSensorStatus, hideControls, getKnobGrid } from './ui/dashboard';
import { attachStartButton, type StartFlowResult } from './ui/permissions';
import { createPoet, type PoetryInput, type Structure } from './poetry/poet';
import { getPhase } from './env/daytime';
import { initPoemOverlay, showPoem, hidePoem } from './ui/poemOverlay';

// Photo background for the welcome screen (base-path aware; falls back to the CSS glows if
// the file isn't present). Image lives at public/soundGardenScape_1.png.
document
  .getElementById('start-overlay')
  ?.style.setProperty('--start-photo', `url(${import.meta.env.BASE_URL}soundGardenScape_1.png)`);

// "?" about / how-to panel on the welcome screen.
const aboutPanel = document.getElementById('about-panel');
document.getElementById('about-toggle')?.addEventListener('click', () => aboutPanel?.classList.toggle('hidden'));
document.getElementById('about-close')?.addEventListener('click', () => aboutPanel?.classList.add('hidden'));

const leaf = new LeafSensor();
// Mic + orientation are still acquired at start (the combined camera+mic getUserMedia keeps
// iOS output on the main speaker), but the sound is driven entirely by leaf shape now.
const mic = new MicSensor();
const orientation = new OrientationSensor();

const stage = document.getElementById('stage') as HTMLElement;
const videoEl = document.getElementById('camera-preview') as HTMLVideoElement;
const overlayCanvas = document.getElementById('leaf-overlay') as HTMLCanvasElement;
const switchCameraButton = document.getElementById('switch-camera-button') as HTMLButtonElement;
const randomizeButton = document.getElementById('randomize-button') as HTMLButtonElement;
const recordButton = document.getElementById('record-button') as HTMLButtonElement;
const downloadButton = document.getElementById('download-button') as HTMLButtonElement;
const poemButton = document.getElementById('poem-button') as HTMLButtonElement;

// Generative poem layer, gated by the "poem" pill. When on, a deliberate tap summons a coded line,
// and one also drifts in on its own during still moments — rare and unpredictable.
const poet = createPoet();
let poetryOn = false;
let poemCreativity = 0.6;
const poemStructure: Structure = 'haiku';

const POEM_ANIM_MS = 14000; // full reveal → ~10s hold → fade (must match the CSS poem-cycle duration)
const POEM_MIN_GAP_MS = 90000; // earliest a new *ambient* poem may drift in (1.5 min)
const POEM_MAX_GAP_MS = 240000; // latest (4 min) — the actual moment is random in between
let poemShownAt = -POEM_ANIM_MS;
let nextPoemAt = performance.now() + POEM_MIN_GAP_MS;

// The last recorded video clip, kept so "save" can re-share it.
let lastClip: Blob | null = null;

// Start loading OpenCV immediately so contour tracking is ready by the time the user aims
// at a plant. If it fails/times out, the sensor silently uses its edge heuristic.
loadOpenCv().catch((err) => console.warn('OpenCV unavailable, using heuristic:', err));

initDashboard();
initPoemOverlay();

switchCameraButton.addEventListener('click', async () => {
  switchCameraButton.disabled = true;
  try {
    await leaf.switchCamera(videoEl);
    videoEl.classList.toggle('mirrored', leaf.getFacingMode() === 'user');
  } catch (err) {
    console.warn('Could not switch camera:', err);
  } finally {
    switchCameraButton.disabled = false;
  }
});

attachStartButton({ light: leaf, mic, orientation, videoEl }, onExperienceReady);

const knobs: Record<string, Knob> = {};
let bankSelect: BankSelectHandle;

function onExperienceReady(result: StartFlowResult): void {
  setSensorStatus(result);
  switchCameraButton.disabled = !result.light;
  videoEl.classList.toggle('mirrored', leaf.getFacingMode() === 'user');

  createLeafscape();
  bankSelect = createBankSelect({
    currentId: getLeafscapeState()?.bankId ?? BANKS[0].id,
    onSelect: (id) => {
      setBank(id);
      syncBankDependents();
    },
  });
  stage.appendChild(bankSelect.el);
  buildControls();
  wireActions();
  attachTapToPlay();
  goImmersive();

  requestAnimationFrame(tick);
}

// --- Tap-to-play: taps bias the audio toward the tapped leaf and ripple on screen ----------
const focus = { x: 0.5, y: 0.5, strength: 0, shape: 0, color: 0, hue: 120 };
const FOCUS_DECAY_MS = 2500;
const FOCUS_WEIGHT = 0.85; // how far a deliberate tap pushes shape/color toward the tapped leaf
let dragging = false; // true while a finger is held down and moving (sustains the tone; blocks focus decay)

const DRAG_THRESHOLD_PX = 12; // movement beyond this (before release) promotes a tap into a drag

/** Maps a pointer event to a normalized (mx, ny) in the stage, respecting the front-camera flip. */
function pointerToStage(e: PointerEvent): { mx: number; ny: number } {
  const rect = stage.getBoundingClientRect();
  const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1);
  // Front camera is CSS-mirrored, so flip x to match the boxes/overlay under the finger.
  const mx = leaf.getFacingMode() === 'user' ? 1 - nx : nx;
  return { mx, ny };
}

/** The shape/color/hue at a normalized point: the nearest leaf's own values if close, else global. */
function sampleAt(mx: number, ny: number): { shape: number; color: number; hue: number } {
  const boxes = leaf.getLeafBoxes();
  let nearest: { shapeSignal: number; colorSignal: number; hueDeg: number } | null = null;
  let bestD = Infinity;
  for (const b of boxes) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const d = (cx - mx) ** 2 + (cy - ny) ** 2;
    if (d < bestD) {
      bestD = d;
      nearest = b;
    }
  }
  const near = nearest && bestD < 0.05 ? nearest : null;
  return {
    shape: near ? near.shapeSignal : leaf.getShapeSignal(),
    color: near ? near.colorSignal : leaf.getColorSignal(),
    hue: near ? near.hueDeg : leaf.getHueDeg(),
  };
}

/**
 * Points the focus at a sampled location and returns what was found. `focus.strength` is set to 1;
 * whether it then holds (drag) or decays (tap) is governed by the `dragging` flag in tick().
 */
function focusAt(mx: number, ny: number): { shape: number; color: number; hue: number } {
  const s = sampleAt(mx, ny);
  focus.x = mx;
  focus.y = ny;
  focus.strength = 1;
  focus.shape = s.shape;
  focus.color = s.color;
  focus.hue = s.hue;
  return s;
}

/** The active bank's group → the poem's "voice". Falls back to Organic. */
function currentBankGroup(): PoetryInput['group'] {
  const id = getLeafscapeState()?.bankId;
  return BANKS.find((b) => b.id === id)?.group ?? 'Organic';
}

/** Generates + shows a poem for a tapped leaf, in the current bank's voice and time-of-day. */
function speakPoem(s: { shape: number; color: number; hue: number }): void {
  const spatial = leaf.getSpatial();
  const input: PoetryInput = {
    hueDeg: s.hue,
    shape: s.shape,
    colorSignal: s.color,
    presence: leaf.getPlantPresence(),
    leafCount: spatial.count,
    group: currentBankGroup(),
    phase: getPhase(),
    // Deterministic per-reading: the same leaf speaks the same line; different foliage differs.
    seed: Math.floor(s.hue * 131 + s.shape * 997 + s.color * 577 + spatial.count * 31),
  };
  poemShownAt = performance.now();
  poet
    .generate(input, { structure: poemStructure, creativity: poemCreativity })
    .then((lines) => showPoem(lines, s.shape))
    .catch((err) => console.warn('poem generation failed:', err));
}

const poemVisible = (now: number): boolean => now - poemShownAt < POEM_ANIM_MS;

function scheduleNextPoem(now: number): void {
  nextPoemAt = now + POEM_MIN_GAP_MS + Math.random() * (POEM_MAX_GAP_MS - POEM_MIN_GAP_MS);
}

/** A deliberate tap summons a poem when the layer is on — unless one is already lingering. */
function poemOnTap(s: { shape: number; color: number; hue: number }): void {
  if (!poetryOn || poemVisible(performance.now())) return;
  speakPoem(s);
  scheduleNextPoem(performance.now()); // a tapped poem also pushes the ambient timer out
}

/**
 * Rare, unpredictable ambient surfacing (only when the layer is on): at the scheduled moment, if a
 * plant is in frame, a poem drifts in; then the next moment is randomised minutes out.
 */
function maybeAmbientPoem(now: number, hue: number, shape: number, color: number, presence: number): void {
  if (!poetryOn || now < nextPoemAt || poemVisible(now)) return;
  if (presence < 0.05) {
    nextPoemAt = now + 4000; // no plant yet — check back shortly
    return;
  }
  speakPoem({ hue, shape, color });
  scheduleNextPoem(now);
}

/**
 * Pointer handling for the stage: a quick tap fires a discrete pluck + ripple (as before); a
 * press-and-drag traces a glowing trail and sustains a tone that tracks the leaf under the finger,
 * fading out on release. The gesture chooses itself — no mode switch.
 */
function attachTapToPlay(): void {
  let activePointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let movedToDrag = false;

  const isChrome = (target: HTMLElement) =>
    target.closest('#controls') ||
    target.closest('#bank-select') ||
    target.closest('.hud') ||
    target.closest('#controls-toggle');

  stage.addEventListener('pointerdown', (e) => {
    // Ignore taps on UI chrome — those aren't "playing the leaves".
    if (isChrome(e.target as HTMLElement)) return;
    activePointer = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    movedToDrag = false;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    if (!movedToDrag) {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist < DRAG_THRESHOLD_PX) return;
      movedToDrag = true;
      dragging = true; // sustain: tick() stops decaying focus while this is true
    }
    const { mx, ny } = pointerToStage(e);
    const s = focusAt(mx, ny);
    addTrailPoint(mx, ny, s.hue);
  });

  const endGesture = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (movedToDrag) {
      // Drag: release the sustain so the tone fades out via the normal focus decay in tick().
      dragging = false;
    } else {
      // Tap: discrete pluck + ripple at the touch point.
      const { mx, ny } = pointerToStage(e);
      const s = focusAt(mx, ny);
      addRipple(mx, ny, s.hue);
      pluckLeafscape(s.shape);
      poemOnTap(s);
    }
    movedToDrag = false;
  };

  stage.addEventListener('pointerup', endGesture);
  stage.addEventListener('pointercancel', endGesture);
}

function pct(v: number): string {
  return `${Math.round(v * 100)}`;
}

function buildControls(): void {
  const grid = getKnobGrid();
  const state = getLeafscapeState();

  const add = (key: string, k: Knob) => {
    knobs[key] = k;
    grid.appendChild(k.el);
  };

  // Volume takes the first slot (the bank selector moved to the top-right dropdown).
  add(
    'volume',
    new Knob({
      label: 'volume', min: 0, max: 1, value: getDefaultVolume(), default: getDefaultVolume(), color: 'var(--teal)',
      format: pct, onChange: (v) => setMasterVolume(v),
    }),
  );
  add(
    'mode',
    new Knob({
      label: 'mode', min: 0, max: MODE_NAMES.length - 1, step: 1, value: 0, color: 'var(--pink)',
      format: (v) => MODE_NAMES[Math.round(v)],
      onChange: (v) => setMode(MODE_NAMES[Math.round(v)]),
    }),
  );
  add(
    'pitch',
    new Knob({
      label: 'pitch', min: -12, max: 12, step: 1, value: 0, default: 0, color: 'var(--pink)',
      format: (v) => (v > 0 ? `+${v}` : `${v}`),
      onChange: (v) => setTranspose(v),
    }),
  );
  add(
    'freq',
    new Knob({
      label: 'freq', min: 0, max: 1, value: 0.5, default: 0.5, color: 'var(--pink)',
      format: pct, onChange: (v) => setTimbreBias(v),
    }),
  );
  add(
    'space',
    new Knob({
      label: 'space', min: 0, max: 1, value: 0.5, default: 0.5, color: 'var(--teal)',
      format: pct, onChange: (v) => setSpace(v),
    }),
  );
  add(
    'density',
    new Knob({
      label: 'density', min: 0, max: 1, value: 0.6, default: 0.6, color: 'var(--teal)',
      format: pct, onChange: (v) => setDensity(v),
    }),
  );
  add(
    'tempo',
    new Knob({
      label: 'tempo', min: 50, max: 140, step: 1, value: Math.round(state?.bpm ?? 74), color: 'var(--teal)',
      format: (v) => `${Math.round(v)}`,
      onChange: (v) => setTempo(v),
    }),
  );
  add(
    'sens',
    new Knob({
      label: 'sens', min: 0, max: 1, value: 0.6, default: 0.6, color: 'var(--pink)',
      format: pct, onChange: (v) => leaf.setSensitivity(v),
    }),
  );
  add(
    'muse',
    new Knob({
      label: 'muse', min: 0, max: 1, value: poemCreativity, default: poemCreativity, color: 'var(--pink)',
      format: pct, onChange: (v) => { poemCreativity = v; },
    }),
  );

  // Apply initial values that the engine doesn't already default to.
  leaf.setSensitivity(0.6);
  setMasterVolume(getDefaultVolume());
}

/** Keep the mode + tempo dials in sync when a bank switch changes them under the hood. */
function syncBankDependents(): void {
  const state = getLeafscapeState();
  if (!state) return;
  const modeIdx = MODE_NAMES.indexOf(state.mode);
  if (modeIdx >= 0) knobs.mode?.setValue(modeIdx, false);
  knobs.tempo?.setValue(Math.round(state.bpm), false);
}

function wireActions(): void {
  poemButton.addEventListener('click', () => {
    poetryOn = !poetryOn;
    poemButton.setAttribute('aria-pressed', String(poetryOn));
    if (poetryOn) {
      nextPoemAt = performance.now() + 5000; // turning it on: a poem drifts in soon if you hold still
    } else {
      hidePoem();
    }
  });

  randomizeButton.addEventListener('click', () => {
    const bank = BANKS[Math.floor(Math.random() * BANKS.length)];
    bankSelect.setValue(bank.id);
    setBank(bank.id);
    syncBankDependents();
    knobs.pitch?.setValue(Math.round((Math.random() - 0.5) * 14));
    knobs.freq?.setValue(0.3 + Math.random() * 0.6);
    knobs.space?.setValue(0.3 + Math.random() * 0.6);
    knobs.density?.setValue(0.3 + Math.random() * 0.6);
  });

  // Record a shareable *video* clip (camera + overlay + sound), not just audio. On stop we hold
  // the blob so "save" can hand it to the share sheet.
  if (!isClipSupported()) recordButton.disabled = true;
  recordButton.addEventListener('click', async () => {
    if (isClipRecording()) {
      recordButton.classList.remove('recording');
      recordButton.textContent = 'rec';
      recordButton.disabled = true; // brief: finalizing the file
      try {
        lastClip = await stopClip();
        downloadButton.disabled = false;
        // Offer to share immediately — that's the moment the user wants it.
        await shareOrDownloadClip(lastClip);
      } catch (err) {
        console.warn('could not finish clip:', err);
      } finally {
        recordButton.disabled = false;
      }
    } else {
      const mirrored = leaf.getFacingMode() === 'user';
      const started = startClip(videoEl, overlayCanvas, getMasterAudioStream(), mirrored);
      if (!started) {
        console.warn('clip recording could not start');
        return;
      }
      recordButton.classList.add('recording');
      recordButton.textContent = 'stop';
    }
  });

  // Re-share / download the last recorded clip.
  downloadButton.addEventListener('click', () => {
    if (lastClip) void shareOrDownloadClip(lastClip);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wakeLock: any = null;

async function requestWakeLock(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wakeLock = await (navigator as any).wakeLock?.request('screen');
  } catch {
    /* best-effort; not supported everywhere */
  }
}

async function goImmersive(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* iOS Safari: PWA standalone provides fullscreen instead */
  }
  requestWakeLock();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
});

let lastNow = 0;

function tick(now: number): void {
  // The whole frame is wrapped so a stray throw (e.g. an OpenCV binding blowing up) can never
  // permanently kill the loop: the RAF reschedule lives in `finally` and always runs.
  try {
    leaf.update(now);

    const dt = lastNow ? now - lastNow : 16;
    lastNow = now;
    // While a drag is in progress the focus is *held* (sustained tone); only decay when released.
    if (!dragging && focus.strength > 0) {
      focus.strength = Math.max(0, focus.strength - dt / FOCUS_DECAY_MS);
    }

    const globalShape = leaf.getShapeSignal();
    const globalColor = leaf.getColorSignal();
    const globalHue = leaf.getHueDeg();
    const plantPresence = leaf.getPlantPresence();
    const spatial = leaf.getSpatial();

    // Ambient poem: drifts in on its own when interaction has gone still and a plant is in frame.
    maybeAmbientPoem(now, globalHue, globalShape, globalColor, plantPresence);

    // Blend both shape and color toward the tapped/dragged leaf while focus is active; relax as it decays.
    const w = focus.strength * FOCUS_WEIGHT;
    const effShape = lerp(globalShape, focus.shape, w);
    const effColor = lerp(globalColor, focus.color, w);
    const effSpatial = { ...spatial, avgX: lerp(spatial.avgX, focus.x, focus.strength) };
    updateLeafscape(effShape, effColor, plantPresence, effSpatial, focus.strength);

    render(
      {
        shapeSignal: effShape,
        colorSignal: effColor,
        hueDeg: globalHue,
        plantPresence,
        bankName: getLeafscapeState()?.bankName ?? '',
        usingCv: leaf.isUsingCv(),
        focus: { x: focus.x, y: focus.y, strength: focus.strength, hue: focus.hue },
      },
      leaf,
    );

    // If recording a clip, composite this fresh frame (camera + overlay) into the capture canvas.
    if (isClipRecording()) drawClipFrame();
  } catch (err) {
    console.warn('tick() frame error (loop kept alive):', err);
  } finally {
    requestAnimationFrame(tick);
  }
}

// Hide controls initially (start overlay covers everything until Start).
hideControls();
