import React, { useState, useEffect } from 'react';
import './InstallPrompt.css';

// State that tracks whether a PWA is installable:
// - deferredPrompt: the prompt object given by the 'beforeinstallprompt' event
// - dismissed: whether the user already dismissed it (we remember via localStorage)
let deferredPrompt = null;
let dismissed = false;

try { dismissed = localStorage.getItem('bw-install-dismissed') === 'true'; } catch {}

const InstallPrompt = () => {
  const [show, setShow] = useState(false);

  // Listen for the beforeinstallprompt event (Chrome/Edge/Android)
  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      deferredPrompt = e;
      // If user hasn't dismissed yet, show the banner
      if (!dismissed) setShow(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // outcome is 'accepted' or 'dismissed'
    deferredPrompt = null;
    setShow(false);
  };

  const dismiss = () => {
    dismissed = true;
    try { localStorage.setItem('bw-install-dismissed', 'true'); } catch {}
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="install-prompt-banner" role="alert">
      <span>Install Bus Wankers as an app — works offline!</span>
      <button onClick={install} className="install-btn-install">Install</button>
      <button onClick={dismiss} className="install-btn-dismiss" aria-label="Dismiss install prompt">&times;</button>
    </div>
  );
};

export default InstallPrompt;
