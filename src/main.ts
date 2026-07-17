import { getDefaultVolume, setMasterVolume, getMasterAudioStream, suspendAudio, resumeAudio } from './audio/engine';
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
  setPlayMode,
  dragStart,
  dragMove,
  dragEnd,
  GREEN_LO,
  GREEN_HI,
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
import { OrientationSensor } from './sensors/orientationSensor';
import { FidgetSensor } from './sensors/fidget';
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
import { initRandomButton, pulseRandomButton, setRandomButtonHidden } from './ui/randomButton';
import { initPinnedDrawer, togglePinnedDrawer } from './ui/pinnedDrawer';
import type { PresetConfig, Preset, Specimen } from './presets/preset';
import { savePreset, countPresets } from './presets/presetStore';
import { showToast } from './ui/toast';

// "?!" find-out-more panel on the welcome screen. The toggle hides itself while the panel is open
// (the panel is full-screen; the floating "?!" would otherwise sit on top of it).
const aboutPanel = document.getElementById('about-panel');
const aboutToggle = document.getElementById('about-toggle');
function setAboutOpen(open: boolean): void {
  aboutPanel?.classList.toggle('hidden', !open);
  aboutToggle?.classList.toggle('is-hidden', open);
}
aboutToggle?.addEventListener('click', () => setAboutOpen(aboutPanel?.classList.contains('hidden') ?? true));
document.getElementById('about-close')?.addEventListener('click', () => setAboutOpen(false));

const leaf = new LeafSensor();
// No microphone: the sound is driven entirely by leaf shape, and capturing the mic would flip the
// audio session into record mode and break Bluetooth output. Orientation drives the fidget button.
const orientation = new OrientationSensor();
const fidget = new FidgetSensor(); // boredom + motion → the random button pulses

const stage = document.getElementById('stage') as HTMLElement;
const videoEl = document.getElementById('camera-preview') as HTMLVideoElement;
// Never let Android/Chrome pop the camera feed into a floating picture-in-picture window.
videoEl.disablePictureInPicture = true;
const greenHintEl = document.getElementById('green-hint');
let greenHintShown = false;
const overlayCanvas = document.getElementById('leaf-overlay') as HTMLCanvasElement;
const switchCameraButton = document.getElementById('switch-camera-button') as HTMLButtonElement;
const pinsButton = document.getElementById('pins-button') as HTMLButtonElement;
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

// Load the Glipervelz-Origy dingbat for the poem's data-matrix cipher. FontFace API is base-aware
// (works under /leaf-garden-2/ on Pages) and sidesteps the space in the filename.
if (typeof FontFace !== 'undefined') {
  const glipervelz = new FontFace('Glipervelz', `url("${import.meta.env.BASE_URL}Glipervelz-Origy%20FULL.ttf")`);
  glipervelz
    .load()
    .then((f) => document.fonts.add(f))
    .catch((err) => console.warn('Glipervelz font unavailable:', err));
}

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

attachStartButton({ light: leaf, orientation, fidget, videoEl }, onExperienceReady, resumeApp);

const knobs: Record<string, Knob> = {};
let bankSelect: BankSelectHandle;
let pinnedCount = 0;

/** Reads the live controls into a Preset config (mirrors the knobs + active bank). */
function captureCurrentConfig(): PresetConfig {
  return {
    bankId: getLeafscapeState()?.bankId ?? BANKS[0].id,
    volume: knobs.volume?.getValue() ?? getDefaultVolume(),
    mode: knobs.mode?.getValue() ?? 0,
    pitch: knobs.pitch?.getValue() ?? 0,
    freq: knobs.freq?.getValue() ?? 0.5,
    space: knobs.space?.getValue() ?? 0.5,
    density: knobs.density?.getValue() ?? 0.6,
    tempo: knobs.tempo?.getValue() ?? 74,
    sens: knobs.sens?.getValue() ?? 0.6,
  };
}

/** Applies a Preset config to the live engine + knobs (bank first, then each dial fires its setter). */
function applyConfig(cfg: PresetConfig): void {
  bankSelect?.setValue(cfg.bankId);
  setBank(cfg.bankId);
  syncBankDependents();
  knobs.volume?.setValue(cfg.volume, true);
  knobs.mode?.setValue(cfg.mode, true);
  knobs.pitch?.setValue(cfg.pitch, true);
  knobs.freq?.setValue(cfg.freq, true);
  knobs.space?.setValue(cfg.space, true);
  knobs.density?.setValue(cfg.density, true);
  knobs.tempo?.setValue(cfg.tempo, true);
  knobs.sens?.setValue(cfg.sens, true);
}

/** Pins the currently-sounding config (the locked specimen, incl. any live tweaks) + confirms. */
async function pinSpecimen(s: Specimen): Promise<void> {
  const preset: Preset = {
    id: String(Date.now()),
    config: captureCurrentConfig(), // pin exactly what's playing
    name: s.name,
    hueDeg: s.hueDeg,
    createdAt: Date.now(),
  };
  try {
    await savePreset(preset);
    pinnedCount += 1;
    showToast(`pinned ✓ · ${pinnedCount}`);
  } catch (err) {
    console.warn('could not pin preset:', err);
  }
}

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
  attachPlayModePill();

  // The small random button (roll → apply live; the pin below keeps the current sound).
  initRandomButton(stage, {
    bankIds: BANKS.map((b) => b.id),
    onApply: (s) => applyConfig(s.config),
    onPin: (s) => void pinSpecimen(s),
  });
  // The pins list inside the controls drawer (tap a row to replay).
  const pinsPanel = document.getElementById('pins-panel');
  if (pinsPanel) initPinnedDrawer(pinsPanel, (cfg) => applyConfig(cfg));

  // Hide the floating random button while the controls drawer is open (they'd overlap).
  const controlsEl = document.getElementById('controls');
  if (controlsEl) {
    const sync = () => setRandomButtonHidden(!controlsEl.classList.contains('hidden'));
    new MutationObserver(sync).observe(controlsEl, { attributes: true, attributeFilter: ['class'] });
    sync();
  }
  countPresets()
    .then((n) => (pinnedCount = n))
    .catch(() => {});

  experienceStarted = true;
  running = true;
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

/**
 * The shape/color/hue at a normalized point: the nearest leaf's own values if close, else global.
 * `onLeaf` reports whether the point actually landed on a tracked leaf (drives the "leaf accent").
 */
function sampleAt(mx: number, ny: number): { shape: number; color: number; hue: number; onLeaf: boolean } {
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
    onLeaf: !!near,
  };
}

/**
 * Points the focus at a sampled location and returns what was found. `focus.strength` is set to 1;
 * whether it then holds (drag) or decays (tap) is governed by the `dragging` flag in tick().
 */
function focusAt(mx: number, ny: number): { shape: number; color: number; hue: number; onLeaf: boolean } {
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
    .then((lines) => showPoem(lines))
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
  // For the drag-speed estimate (last sampled point + time, normalized stage units).
  let lastMx = 0;
  let lastMy = 0;
  let lastMoveT = 0;

  const isChrome = (target: HTMLElement) =>
    target.closest('#controls') ||
    target.closest('#bank-select') ||
    target.closest('.hud') ||
    target.closest('.play-mode-wrap') ||
    target.closest('#close-app') ||
    target.closest('#pause-overlay') ||
    target.closest('#controls-toggle') ||
    target.closest('.fidget-wheel');

  stage.addEventListener('pointerdown', (e) => {
    fidget.noticeInteraction(); // any touch resets the boredom clock
    // Ignore taps on UI chrome (and the fidget wheel) — those aren't "playing the leaves".
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
    const { mx, ny } = pointerToStage(e);
    const s = focusAt(mx, ny); // sample the leaf under the finger (Hu shape + HSL hue/colour)
    const vision = { shape: s.shape, hue: s.hue, color: s.color };
    const t = e.timeStamp || performance.now();
    if (!movedToDrag) {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist < DRAG_THRESHOLD_PX) return;
      movedToDrag = true;
      dragging = true; // sustain: tick() stops decaying focus while this is true
      lastMx = mx;
      lastMy = ny;
      lastMoveT = t;
      dragStart(mx, ny, vision); // begin this mode's drag texture
    } else {
      // Normalized drag speed (stage-units/sec ÷ 3), so a full-screen swipe ≈ 1.
      const dt = Math.max(1, t - lastMoveT);
      const speed = clamp((Math.hypot(mx - lastMx, ny - lastMy) / dt) * (1000 / 3), 0, 1);
      lastMx = mx;
      lastMy = ny;
      lastMoveT = t;
      dragMove(mx, ny, vision, speed); // Brush grains / Wind breath / Bow step
    }
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
      // Drag: end this mode's texture, then let the ambient bed fade via focus decay in tick().
      dragEnd();
      dragging = false;
    } else {
      // Tap: discrete pluck + ripple at the touch point. Pitch/timbre follow where you touched;
      // touching a tracked leaf adds a brighter accent.
      const { mx, ny } = pointerToStage(e);
      const s = focusAt(mx, ny);
      addRipple(mx, ny, s.hue);
      pluckLeafscape(s.shape, mx, ny, s.onLeaf);
      poemOnTap(s);
    }
    movedToDrag = false;
  };

  stage.addEventListener('pointerup', endGesture);
  stage.addEventListener('pointercancel', endGesture);
}

/** Wires the [1][2][3] pill: tapping a segment switches the touch→sound mapping live. */
function attachPlayModePill(): void {
  const pill = document.getElementById('play-mode');
  if (!pill) return;
  const segs = Array.from(pill.querySelectorAll<HTMLButtonElement>('.play-mode-seg'));
  for (const seg of segs) {
    seg.addEventListener('click', () => {
      const mode = Number(seg.dataset.mode) as 1 | 2 | 3;
      setPlayMode(mode);
      for (const s of segs) {
        const active = s === seg;
        s.classList.toggle('is-active', active);
        s.setAttribute('aria-pressed', String(active));
      }
    });
  }
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

  pinsButton.addEventListener('click', () => {
    const open = togglePinnedDrawer();
    pinsButton.setAttribute('aria-pressed', String(open));
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

function releaseWakeLock(): void {
  try {
    wakeLock?.release?.();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

async function goImmersive(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* iOS Safari: PWA standalone provides fullscreen instead */
  }
  requestWakeLock();
}

// --- App lifecycle: shut every sensor + audio the moment we're not in the foreground --------------
// Privacy first: the camera, motion sensors, and audio must never keep running in the background.
// `running` gates the RAF loop; `pausedByBackground` means "we auto-suspended — offer tap-to-resume".
let running = false;
let experienceStarted = false;
let pausedByBackground = false;

function showPauseOverlay(): void {
  document.getElementById('pause-overlay')?.classList.remove('hidden');
}
function hidePauseOverlay(): void {
  document.getElementById('pause-overlay')?.classList.add('hidden');
}

/** Hard-stop: release the camera, suspend audio, halt the loop, drop motion/orientation + wake lock. */
async function suspendApp(): Promise<void> {
  if (!running) return;
  running = false;
  try {
    dragEnd();
  } catch {
    /* ignore */
  }
  leaf.stop(); // releases the camera tracks — the capture light goes off
  orientation.stop();
  fidget.stop();
  releaseWakeLock();
  await suspendAudio();
}

/**
 * Bring everything back. Must be called from a user gesture (the resume pill or Enter): iOS requires
 * audio-resume + motion/orientation re-grant + camera to *begin* within the gesture, so every
 * gesture-sensitive call is fired synchronously (no awaits gating them), mirroring the start flow.
 */
function resumeApp(): void {
  if (!experienceStarted || running) return;
  pausedByBackground = false;
  hidePauseOverlay();
  running = true;
  lastNow = 0;
  void resumeAudio();
  void orientation.start();
  void fidget.start();
  void leaf.start(videoEl).then(() => {
    // re-acquire the camera (permission persists, no prompt)
    videoEl.classList.toggle('mirrored', leaf.getFacingMode() === 'user');
  });
  requestAnimationFrame(tick);
  void goImmersive();
}

/** "Close LG": stop everything and return to the Enter cover (a PWA can't truly quit itself). */
async function closeApp(): Promise<void> {
  await suspendApp();
  pausedByBackground = false;
  hidePauseOverlay();
  try {
    await document.exitFullscreen?.();
  } catch {
    /* ignore */
  }
  const startBtn = document.getElementById('start-button') as HTMLButtonElement | null;
  if (startBtn) {
    startBtn.textContent = 'Enter';
    startBtn.classList.remove('is-thanking');
    startBtn.disabled = false;
  }
  document.getElementById('start-overlay')?.classList.remove('hidden');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (running) {
      pausedByBackground = true;
      void suspendApp();
    }
  } else if (pausedByBackground) {
    showPauseOverlay(); // returned to the foreground while suspended — wait for a deliberate resume
  }
});
window.addEventListener('pagehide', () => {
  if (running) {
    pausedByBackground = true;
    void suspendApp();
  }
});

document.getElementById('close-app')?.addEventListener('click', () => void closeApp());
document.getElementById('resume-button')?.addEventListener('click', () => void resumeApp());

let lastNow = 0;
let lastPulseAt = 0; // throttles the random-button "fidget" pulse

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

    // "find some green": show when there's too little green to make sound; hide once green returns.
    // The GREEN_LO..GREEN_HI gap gives hysteresis so it doesn't flicker at the boundary.
    if (!greenHintShown && plantPresence < GREEN_LO) {
      greenHintShown = true;
      greenHintEl?.classList.remove('hidden');
    } else if (greenHintShown && plantPresence > GREEN_HI) {
      greenHintShown = false;
      greenHintEl?.classList.add('hidden');
    }

    // Ambient poem: drifts in on its own when interaction has gone still and a plant is in frame.
    maybeAmbientPoem(now, globalHue, globalShape, globalColor, plantPresence);

    // Boredom antidote: gone still + a fidget of the phone → the random button pulses to invite you.
    if (fidget.wantsToOpen(now) && now - lastPulseAt > 2500) {
      lastPulseAt = now;
      pulseRandomButton();
    }

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
    if (running) requestAnimationFrame(tick); // stops cleanly when the app is suspended/closed
  }
}

// Hide controls initially (start overlay covers everything until Start).
hideControls();
