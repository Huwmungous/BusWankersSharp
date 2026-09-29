import React from 'react';
import './AuthStatus.css';

// The three screens AppInitializer shows around sign-in, in the app's own
// styling (the shared library's defaults assume Tailwind, which this app
// doesn't use). All are plain function declarations with no module-level state,
// so there is nothing here that can be touched before it is initialised.

// Configuration and the sign-in state are being worked out.
export function AuthLoading() {
  return (
    <div className="auth-status" role="status" aria-live="polite">
      <div className="auth-status-card">
        <div className="auth-status-spinner" aria-hidden="true" />
        <p className="auth-status-text">Loading Bus Wankers…</p>
      </div>
    </div>
  );
}

// Not signed in yet: the browser is about to be sent to the Keycloak login page.
export function AuthRedirecting() {
  return (
    <div className="auth-status" role="status" aria-live="polite">
      <div className="auth-status-card">
        <div className="auth-status-spinner" aria-hidden="true" />
        <p className="auth-status-text">Taking you to the sign-in page…</p>
      </div>
    </div>
  );
}

// Configuration or sign-in failed. The message is the library's own (it never
// contains a token); offer a plain reload since the usual causes - the config
// service being briefly unreachable, an expired login session - clear that way.
export function AuthError({ message }) {
  return (
    <div className="auth-status" role="alert">
      <div className="auth-status-card auth-status-card-error">
        <h1 className="auth-status-title">Couldn't sign you in</h1>
        <p className="auth-status-text">{message}</p>
        <button
          type="button"
          className="auth-status-button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
