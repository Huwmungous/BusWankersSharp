import React, { useState } from 'react';
import { authService, LoggerService } from '@if/web-common';

// Created when used, not at module load - see apiLog in ../api/autofillApi.
const logoutLog = (context) => {
  const base = LoggerService.create('LogoutButton');
  return context ? base.withContext(context) : base;
};

// The "Log out" button at the far end of the tab bar (2026-09-29). It hands over
// to @if/web-common's AuthService, which redirects the browser to Keycloak's
// end-session endpoint; Keycloak then returns to /buswankers/signout/callback
// (src/main.jsx registers that as the post-logout redirect, and the Keycloak
// client must allow it), AppInitializer finishes the sign-out, and because the
// page is behind a sign-in the person lands straight back on the Keycloak login
// screen. Nothing else needs clearing: the tokens live in the auth library.
const LogoutButton = () => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onLogout = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    logoutLog().debug('Log out requested');
    try {
      await authService.signout();
    } catch (err) {
      // The redirect normally takes the page away before this is reached, so
      // getting here means the sign-out could not even start.
      logoutLog({ error: err && err.message }).warn('Log out failed');
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="nav-link nav-link-logout"
      onClick={onLogout}
      disabled={busy}
      title={failed ? 'Log out failed - click to try again' : 'Log out of Bus Wankers'}
    >
      {busy ? 'Logging out...' : failed ? 'Log out (retry)' : 'Log out'}
    </button>
  );
};

export default LogoutButton;
