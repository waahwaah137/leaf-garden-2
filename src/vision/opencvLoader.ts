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
 * Injects opencv.js and resolves once the runtime module (with `.Mat` etc.) is ready. Rejects
 * after a timeout so callers can fall back to the JS heuristic.
 *
 * Different opencv.js builds expose the global `cv` differently, so both shapes are handled:
 * - Classic builds (e.g. docs.opencv.org) assign a synchronous object immediately; `.Mat` etc.
 *   only appear after `cv.onRuntimeInitialized` fires.
 * - Newer emscripten "MODULARIZE" async builds (e.g. @techstark/opencv-js) assign `cv` to a
 *   *Promise* that resolves to the initialized module — `window.cv` is never the module itself
 *   until that promise settles. We normalize by reassigning `window.cv` to the resolved module
 *   so every other call site's `cv()` (which just reads `window.cv`) keeps working unchanged.
 */
export function loadOpenCv(timeoutMs = 25000): Promise<void> {
  if (ready) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('opencv.js runtime did not initialize in time'));
    }, timeoutMs);

    const settle = (resolvedCv?: Cv) => {
      if (settled) return;
      if (resolvedCv) w.cv = resolvedCv; // normalize: window.cv becomes the real module, not the promise
      if (w.cv && w.cv.Mat) {
        settled = true;
        clearTimeout(timer);
        ready = true;
        resolve();
      }
    };

    const poll = () => {
      if (settled) return;
      settle();
      if (!settled) setTimeout(poll, 60);
    };

    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/opencv.js`;
    script.async = true;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Failed to load opencv.js'));
    };
    script.onload = () => {
      const cvGlobal = w.cv;
      if (cvGlobal && typeof cvGlobal.then === 'function') {
        cvGlobal.then(
          (resolvedCv: Cv) => settle(resolvedCv),
          (err: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          },
        );
        return;
      }
      if (cvGlobal && typeof cvGlobal === 'object') {
        cvGlobal.onRuntimeInitialized = () => settle();
      }
      poll();
    };
    document.head.appendChild(script);
  });

  return loading;
}
