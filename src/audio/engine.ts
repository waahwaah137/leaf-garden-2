import * as Tone from 'tone';
import { clamp } from '../utils/math';

const BASE_BPM = 74;
const DEFAULT_VOLUME = 1.0;
const VOLUME_RAMP_SECONDS = 0.05;
const MAKEUP_GAIN_DB = 11; // overall loudness boost; the limiter below catches peaks

export let masterBus: Tone.Gain;

// The fully-mastered output as a MediaStream (post limiter). Created for the iOS speaker-routing
// workaround below, and reused as the audio track when recording a shareable video clip.
let outputStream: MediaStream | null = null;

let started = false;

/** Must be called from within a user-gesture handler (the Start button click). */
export async function initEngine(): Promise<void> {
  if (started) return;

  // Declare this as *media playback* (not communication) so the OS routes it to Bluetooth A2DP and
  // the loudspeaker, not the earpiece. Experimental (iOS Safari 16.4+); harmless where unsupported.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audioSession = (navigator as any).audioSession;
    if (audioSession) audioSession.type = 'playback';
  } catch {
    /* not supported — the video-only capture already keeps us in playback mode */
  }

  await Tone.start();

  masterBus = new Tone.Gain(DEFAULT_VOLUME);
  const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.2 });
  // Makeup gain lifts the overall level (the mix was too quiet), followed by a fast
  // brickwall limiter so the extra gain never clips the output.
  const makeup = new Tone.Gain(Tone.dbToGain(MAKEUP_GAIN_DB));
  const limiter = new Tone.Compressor({ threshold: -1.5, ratio: 20, attack: 0.002, release: 0.1 });
  masterBus.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(limiter);

  // Primary audible output: the default AudioContext destination. This is ordinary media Web Audio,
  // so — with no microphone captured — the OS routes it to Bluetooth A2DP and the loudspeaker just
  // like any music/video app. (We used to route through a hidden <audio srcObject> element to dodge
  // an iOS earpiece quirk that mic capture caused; that quirk is gone with the mic, and on Android a
  // MediaStream played through <audio> is treated as call/communication audio — which never grabs
  // the Bluetooth media route, so BT speakers like a JBL got no sound. Plain destination fixes both.)
  limiter.connect(Tone.getDestination());

  // Separately, tap the mastered output into a MediaStream purely so a shareable video clip can mux
  // the audio (getMasterAudioStream). This stream is NOT played back — the clip recorder consumes its
  // audio track directly.
  const rawContext = Tone.getContext().rawContext as AudioContext;
  const streamDestination = rawContext.createMediaStreamDestination();
  limiter.connect(streamDestination);
  outputStream = streamDestination.stream;

  Tone.Transport.bpm.value = BASE_BPM;
  Tone.Transport.start();

  started = true;
}

export function isEngineStarted(): boolean {
  return started;
}

export function getCommandedBpm(): number {
  return BASE_BPM;
}

/** Manual master volume control (0-1), driven by the dashboard slider. */
export function setMasterVolume(normalized: number): void {
  if (!masterBus) return;
  masterBus.gain.rampTo(clamp(normalized, 0, 1), VOLUME_RAMP_SECONDS);
}

export function getDefaultVolume(): number {
  return DEFAULT_VOLUME;
}

/** The mastered audio output as a MediaStream, for muxing into a recorded video clip. */
export function getMasterAudioStream(): MediaStream | null {
  return outputStream;
}
