import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served by holly's nginx under /buswankers/ (see ops/nginx). This
// used to be CRA's package.json "homepage"; Vite calls it `base`. Keep the
// trailing slash - it is what makes relative asset URLs resolve under the
// sub-path, and src/main.jsx derives the OIDC redirect URIs from it.
const BASE = '/buswankers/';

// Declared before it is used in the returned config below (no temporal-dead-zone
// surprises if this file is ever reshuffled).
const PUBLIC_URL = BASE.replace(/\/$/, '');

export default defineConfig({
  plugins: [react()],

  base: BASE,

  // Several components still build asset URLs from CRA's process.env.PUBLIC_URL
  // (`${process.env.PUBLIC_URL}/nav-logo.png`). Vite has no such variable, so
  // it is defined here as the base without its trailing slash - the same value
  // CRA gave them ('/buswankers') - rather than editing every component.
  define: {
    'process.env.PUBLIC_URL': JSON.stringify(PUBLIC_URL),
  },

  // deploy-buswankers-frontend.sh rsyncs build/ (CRA's output directory), so
  // Vite is told to keep writing there instead of its default dist/.
  build: {
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: false,
  },

  resolve: {
    // @if/web-common-react is linked from the Infoforum checkout; make sure it
    // and this app share one copy of React.
    dedupe: ['react', 'react-dom'],
  },

  server: {
    port: 3000,
    proxy: {
      // The estate's config service and this app's own API, so a local
      // `npm run dev` can sign in and call the real backend same-origin.
      '/config': {
        target: 'https://longmanrd.net',
        changeOrigin: true,
        secure: true,
      },
      '/buswankers-api': {
        target: 'https://longmanrd.net',
        changeOrigin: true,
        secure: true,
      },
    },
  },

  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
  },
});
