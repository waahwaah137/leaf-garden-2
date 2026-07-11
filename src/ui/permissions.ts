import { initEngine } from '../audio/engine';
import type { LeafSensor } from '../sensors/leafSensor';
import type { OrientationSensor } from '../sensors/orientationSensor';
import type { FidgetSensor } from '../sensors/fidget';
import { hideStartOverlay } from './dashboard';

export interface StartFlowDeps {
  /** The camera analyzer. Named `light` for historical reasons; it now measures leaf shape. */
  light: LeafSensor;
  orientation: OrientationSensor;
  fidget: FidgetSensor;
  videoEl: HTMLVideoElement;
}

export interface StartFlowResult {
  light: boolean;
  orientation: boolean;
}

export function attachStartButton(
  deps: StartFlowDeps,
  onReady: (result: StartFlowResult) => void,
  onResume?: () => void | Promise<void>,
): void {
  const button = document.getElementById('start-button') as HTMLButtonElement | null;
  if (!button) throw new Error('Missing #start-button');

  let started = false;

  button.addEventListener('click', async () => {
    // Re-entry from "Close LG": the experience already ran once, so just resume (still a user
    // gesture, which audio/motion re-activation needs) rather than re-running the whole start flow.
    if (started) {
      if (!onResume) return;
      button.disabled = true;
      await onResume();
      hideStartOverlay();
      button.disabled = false;
      return;
    }

    button.disabled = true;
    // A brief gratitude beat while the sensors spin up (styled smaller + all-caps on the cover).
    button.textContent = 'THANK YOU!';
    button.classList.add('is-thanking');

    const result = await runStartSequence(deps);
    started = true;

    hideStartOverlay();
    onReady(result);
  });
}

async function runStartSequence(deps: StartFlowDeps): Promise<StartFlowResult> {
  // IMPORTANT: every call below must be *invoked* synchronously, with no `await`
  // before it. iOS Safari only honors DeviceOrientationEvent.requestPermission()
  // (inside orientation.start()) when it's called directly within the click
  // handler's call stack — a prior `await` consumes the "user activation" and the
  // permission silently no-ops with no prompt at all. Each function below is
  // async and only awaits internally, so calling it here starts its synchronous
  // portion (including the actual browser permission API call) immediately.
  const enginePromise = initEngine();
  const orientationPromise = deps.orientation.start();
  const fidgetPromise = deps.fidget.start(); // motion permission must be requested inside the gesture
  const cameraPromise = requestCamera(deps);
  void fidgetPromise; // best-effort; the wheel just won't trigger without motion

  const [engineResult, orientationResult, lightResult] = await Promise.all([
    settle(enginePromise),
    settle(orientationPromise),
    settle(cameraPromise),
  ]);

  if (engineResult.status === 'rejected') console.error('Audio engine failed to start:', engineResult.reason);
  if (lightResult.status === 'rejected') console.warn('Camera unavailable:', lightResult.reason);
  if (orientationResult.status === 'rejected') console.warn('Orientation unavailable:', orientationResult.reason);

  return {
    light: lightResult.status === 'fulfilled',
    orientation: orientationResult.status === 'fulfilled',
  };
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  const [result] = await Promise.allSettled([promise]);
  return result;
}

/**
 * Requests the CAMERA ONLY (no microphone). We deliberately do not capture the mic: it isn't used to
 * make sound in this version, and capturing it flips the device's audio session into record /
 * play-and-record mode — which drops Bluetooth from A2DP (stereo media) to HFP/SCO (mono call) or the
 * earpiece, making the app inaudible on BT headphones after another app has played audio. Video-only
 * keeps the session in plain media playback, so it routes to Bluetooth like any music/video app.
 */
async function requestCamera(deps: StartFlowDeps): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 160 }, height: { ideal: 120 }, facingMode: { ideal: 'environment' } },
    audio: false,
  });
  await deps.light.attachStream(deps.videoEl, stream);
}
