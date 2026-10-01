// main.jsx
// Entry point. The whole app sits inside AppInitializer from @if/web-common-react
// (the same wrapper IFLogViewer uses): it fetches this app's sign-in settings
// from the estate's config service, then - on first load, before anything else
// renders - sends anyone who isn't signed in to Keycloak. Only once they come
// back with a token does <App /> mount. The token is attached to every fetch()
// the page makes (see the interceptor AppInitializer installs), which is what
// UploaderService's [Authorize]d routes check.
//
// Everything a module-level constant depends on is declared above it - nothing
// here reads a `const` before its declaration.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppInitializer } from '@if/web-common-react';
import App from './App';
import { AuthLoading, AuthRedirecting, AuthError } from './auth/AuthStatus';
import { getLog, asError, installGlobalErrorLogging } from './log';

// Before anything renders, so an error thrown during start-up is logged too.
installGlobalErrorLogging();

// The estate's name for this application - what ConfigWebService keys the
// sign-in settings (Keycloak realm, client, authority) on, and the same value as
// "IF:AppDomain" in UploaderService's appsettings.json.
const APP_DOMAIN = 'BusWankers';

// '/buswankers' - vite.config.js's `base` without the trailing slash.
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

// Same-origin on longmanrd.net (holly's nginx), like the log viewer. Overridable
// for a local run with VITE_IF_CONFIG_SERVICE_URL.
const CONFIG_SERVICE_URL = import.meta.env.VITE_IF_CONFIG_SERVICE_URL || '/config';

const appUrl = (path) => `${window.location.origin}${BASE_PATH}/${path}`;

// A module-level constant, so AppInitializer sees the same object on every
// render rather than a fresh one that would re-run its initialisation effect.
const DYNAMIC_CONFIG = {
  configServiceUrl: CONFIG_SERVICE_URL,
  appDomain: APP_DOMAIN,
  // The Keycloak client must list these three as valid redirect URIs.
  redirectUri: appUrl('signin/callback'),
  postLogoutRedirectUri: appUrl('signout/callback'),
  silentRedirectUri: appUrl('silent-callback'),
  basePath: BASE_PATH,
};

const LOADING = <AuthLoading />;
const REDIRECTING = <AuthRedirecting />;
const renderError = (message) => <AuthError message={message} />;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AppInitializer
      appType="user"
      dynamicConfig={DYNAMIC_CONFIG}
      loadingComponent={LOADING}
      redirectingComponent={REDIRECTING}
      errorComponent={renderError}
    >
      <App />
    </AppInitializer>
  </React.StrictMode>,
);

// Register the service worker so browsers can install this as a PWA.
// On Chrome/Edge it shows "Add to Home Screen" on mobile, "Install" in the
// address bar on desktop - turning the app into a standalone windowed app with
// no browser chrome (status bar, tabs, etc).  Safari on iOS shows "Add to
// Home Screen" via the Share sheet.  No extra installer needed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}service-worker.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => getLog('ServiceWorker', { scope: reg.scope }).info('Service worker registered for PWA install'))
      .catch((err) => getLog('ServiceWorker', { swUrl }).error('Service worker registration failed', asError(err)));
  });
}
