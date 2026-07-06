// Records a *shareable video clip* — the live view (camera + leaf overlay) muxed with the mastered
// audio into a single file — and hands it to the native share sheet (WhatsApp etc.), falling back
// to a download. This exists because the OS screen recorder doesn't capture Web Audio (silent
// videos) and the old Tone.Recorder path was audio-only + unsaveable on phones.
//
// How: each frame we composite the <video> (object-fit: cover) and the overlay <canvas> onto a
// hidden capture canvas; `captureCanvas.captureStream()` gives the video track, the engine's
// MediaStreamDestination gives the audio track, and one MediaRecorder writes them together.

interface ClipState {
  recorder: MediaRecorder;
  chunks: Blob[];
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  overlay: HTMLCanvasElement;
  mirrored: boolean;
  mimeType: string;
}

let state: ClipState | null = null;

/** Picks the best supported clip MIME type (webm/vp9 → vp8 → default) for this browser. */
function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4', // Safari/iOS (records H.264/AAC); harmless to try last on Android
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function isClipRecording(): boolean {
  return state !== null;
}

export function isClipSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
}

/**
 * Starts recording. `overlay` is the already-drawn leaf overlay canvas (its size sets the clip's
 * portrait dimensions); the camera is composited underneath it with object-fit: cover. `audio` is
 * the mastered output stream from the engine. Returns false if unsupported or already recording.
 */
export function startClip(
  video: HTMLVideoElement,
  overlay: HTMLCanvasElement,
  audio: MediaStream | null,
  mirrored: boolean,
): boolean {
  if (state || !isClipSupported()) return false;

  // Match the on-screen overlay dimensions (even, for the encoder), capped so encoding stays cheap.
  const scale = Math.min(1, 720 / Math.max(1, overlay.width));
  const w = Math.max(2, Math.round((overlay.width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((overlay.height * scale) / 2) * 2);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const videoStream = canvas.captureStream(30);
  const tracks = [...videoStream.getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
  const mixed = new MediaStream(tracks);

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(mixed, { mimeType }) : new MediaRecorder(mixed);
  } catch (err) {
    console.warn('MediaRecorder init failed:', err);
    return false;
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(200); // gather chunks periodically so long clips don't buffer one giant blob

  state = { recorder, chunks, ctx, canvas, video, overlay, mirrored, mimeType: recorder.mimeType || mimeType };
  return true;
}

/**
 * Composites one frame (call from the RAF loop after the overlay has been drawn, so it's fresh).
 * Draws the camera with object-fit: cover, then the overlay on top — matching what's on screen.
 */
export function drawClipFrame(): void {
  if (!state) return;
  const { ctx, canvas, video, overlay, mirrored } = state;
  const cw = canvas.width;
  const ch = canvas.height;

  ctx.save();
  if (mirrored) {
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
  }
  // object-fit: cover for the camera.
  const vw = video.videoWidth || cw;
  const vh = video.videoHeight || ch;
  const s = Math.max(cw / vw, ch / vh);
  const dw = vw * s;
  const dh = vh * s;
  if (video.readyState >= 2) {
    ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = '#0b1410';
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.restore();

  // Overlay (leaf mask/edges/boxes/ripples/trail) is not mirrored — it's already in stage space.
  ctx.drawImage(overlay, 0, 0, cw, ch);
}

/** Stops recording and resolves with the finished video Blob. */
export function stopClip(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!state) {
      reject(new Error('not recording'));
      return;
    }
    const { recorder, chunks, mimeType } = state;
    recorder.onstop = () => {
      state = null;
      resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    };
    try {
      recorder.stop();
    } catch (err) {
      state = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** File extension for the recorded clip's MIME type. */
export function clipExtension(blob: Blob): string {
  return blob.type.includes('mp4') ? 'mp4' : 'webm';
}

/** Shares the clip via the native share sheet (WhatsApp etc.), falling back to a download. */
export async function shareOrDownloadClip(blob: Blob): Promise<void> {
  const file = new File([blob], `leaf-garden-${Date.now()}.${clipExtension(blob)}`, { type: blob.type });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  try {
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: 'A moment in the Leaf Garden' });
      return;
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return; // user dismissed the sheet — not an error
    console.warn('share failed, falling back to download:', err);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
