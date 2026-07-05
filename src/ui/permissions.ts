import { initEngine } from '../audio/engine';
import type { LeafSensor } from '../sensors/leafSensor';
import type { MicSensor } from '../sensors/micSensor';
import type { OrientationSensor } from '../sensors/orientationSensor';
import { hideStartOverlay } from './dashboard';

export interface StartFlowDeps {
  /** The camera analyzer. Named `light` for historical reasons; it now measures leaf shape. */
  light: LeafSensor;
  mic: MicSensor;
  orientation: OrientationSensor;
  videoEl: HTMLVideoElement;
}

export interface StartFlowResult {
  light: boolean;
  mic: boolean;
  orientation: boolean;
}

export function attachStartButton(deps: StartFlowDeps, onReady: (result: StartFlowResult) => void): void {
  const button = document.getElementById('start-button') as HTMLButtonElement | null;
  if (!button) throw new Error('Missing #start-button');

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Starting…';

    const result = await runStartSequence(deps);

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
  const mediaPromise = requestCameraAndMic(deps);

  const [engineResult, orientationResult, { lightResult, micResult }] = await Promise.all([
    settle(enginePromise),
    settle(orientationPromise),
    mediaPromise,
  ]);

  if (engineResult.status === 'rejected') console.error('Audio engine failed to start:', engineResult.reason);
  if (lightResult.status === 'rejected') console.warn('Camera unavailable:', lightResult.reason);
  if (micResult.status === 'rejected') console.warn('Microphone unavailable:', micResult.reason);
  if (orientationResult.status === 'rejected') console.warn('Orientation unavailable:', orientationResult.reason);

  return {
    light: lightResult.status === 'fulfilled',
    mic: micResult.status === 'fulfilled',
    orientation: orientationResult.status === 'fulfilled',
  };
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  const [result] = await Promise.allSettled([promise]);
  return result;
}

interface MediaResults {
  lightResult: PromiseSettledResult<void>;
  micResult: PromiseSettledResult<void>;
}

/**
 * Requests camera + mic together in a single getUserMedia call, the way a real
 * video-call app would, rather than as two independent audio-only/video-only
 * calls. iOS Safari's audio-session routing (main speaker vs. the quiet earpiece)
 * appears to key off this: two separate requests can leave iOS treating the mic
 * capture as an audio-only "phone call" and route all output to the earpiece,
 * even for music playback. Falls back to independent per-sensor requests if the
 * combined call fails for any reason (e.g. no camera on this device).
 */
async function requestCameraAndMic(deps: StartFlowDeps): Promise<MediaResults> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 160 }, height: { ideal: 120 }, facingMode: { ideal: 'environment' } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    const [lightResult, micResult] = await Promise.allSettled([
      videoTrack
        ? deps.light.attachStream(deps.videoEl, new MediaStream([videoTrack]))
        : Promise.reject(new Error('No video track in combined camera+mic stream')),
      audioTrack
        ? Promise.resolve(deps.mic.attachStream(new MediaStream([audioTrack])))
        : Promise.reject(new Error('No audio track in combined camera+mic stream')),
    ]);

    return { lightResult, micResult };
  } catch (error) {
    console.warn('Combined camera+mic request failed, falling back to separate requests:', error);
    const [lightResult, micResult] = await Promise.allSettled([deps.light.start(deps.videoEl), deps.mic.start()]);
    return { lightResult, micResult };
  }
}
