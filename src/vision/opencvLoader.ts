// Loads the vendored opencv.js (WASM) lazily and reports when the runtime is ready.
// Kept out of the bundle graph (loaded via a <script> tag from /vendor) because opencv.js
// is a large self-contained Emscripten module, not an ES module.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cv = any;

let ready = false;
let loading: Promise<void> | null = null;

export function isCvReady(): boolean {
  return ready;
}

export function cv(): Cv {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).cv;
}

/**
 * Injects opencv.js and resolves once `cv.Mat` exists (i.e. the WASM runtime finished
 * initializing). Rejects after a timeout so callers can fall back to the JS heuristic.
 */
export function loadOpenCv(timeoutMs = 25000): Promise<void> {
  if (ready) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const start = Date.now();

    const settleWhenReady = () => {
      if (w.cv && w.cv.Mat) {
        ready = true;
        resolve();
        return true;
      }
      return false;
    };

    const poll = () => {
      if (settleWhenReady()) return;
      if (Date.now() - start > timeoutMs) {
        reject(new Error('opencv.js runtime did not initialize in time'));
        return;
      }
      setTimeout(poll, 60);
    };

    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/opencv.js`;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load opencv.js'));
    script.onload = () => {
      // The docs build exposes a global `cv`; Mat is only defined after runtime init.
      if (w.cv && typeof w.cv === 'object') {
        w.cv.onRuntimeInitialized = () => settleWhenReady();
      }
      poll();
    };
    document.head.appendChild(script);
  });

  return loading;
}
