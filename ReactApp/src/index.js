import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker so browsers can install this as a PWA.
// On Chrome/Edge it shows "Add to Home Screen" on mobile, "Install" in the
// address bar on desktop — turning the app into a standalone windowed app with
// no browser chrome (status bar, tabs, etc).  Safari on iOS shows "Add to
// Home Screen" via the Share sheet.  No extra installer needed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // CRA's workbox injection writes this at build time.
    const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => console.log('Service Worker registered for PWA install', reg.scope))
      .catch((err) => console.error('Service Worker registration failed:', err));
  });
}
