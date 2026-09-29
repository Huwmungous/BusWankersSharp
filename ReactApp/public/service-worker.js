// Service Worker for PWA installability — caches all the static assets so the
// app works offline (or on spotty festival grounds) and lets browsers present an
// "Install" prompt that puts Bus Wankers on the home screen / desktop.
//
// CRA's built-in workbox integration handles precaching of the build output;
// this file just wires it up via importScripts so the browser picks it up.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Workbox is injected by react-scripts during 'npm run build'.
    // It precaches all the build assets (JS, CSS, images) and serves them from
    // cache on first load so subsequent visits are instant.
    importScripts(`${process.env.PUBLIC_URL}/service-worker.js`);
  });
}
