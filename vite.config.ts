import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `base` is relative-safe for GitHub Pages project sites: the deploy workflow sets
// BASE_PATH=/<repo>/ so asset + service-worker paths resolve under the subpath. Locally it
// defaults to '/'.
const base = process.env.BASE_PATH || '/';

// HTTPS (even self-signed) is required for camera/mic on any origin other than localhost —
// used only by the local dev server for on-device testing. GitHub Pages serves real HTTPS.
export default defineConfig({
  base,
  plugins: [
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      // Auto-generate app icons (incl. maskable) from the source leaf mark.
      pwaAssets: { image: 'public/leaf.svg', overrideManifestIcons: true },
      manifest: {
        name: 'Leaf Garden — sound from plants',
        short_name: 'Leaf Garden',
        description: 'Point your camera at plants; leaf shapes become a live soundscape.',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#91008d',
        background_color: '#0b1410',
        start_url: '.',
      },
      workbox: {
        // opencv.js is ~9.5MB; raise the cache size limit so it precaches for offline use.
        maximumFileSizeToCacheInBytes: 14 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,jpg,jpeg,ico}'],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  server: {
    host: true,
  },
});
