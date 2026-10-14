import React, { useState, useEffect } from 'react';
import { getLog } from '../log';
import './InstallPrompt.css';

// Created when used, never at module load: the logger is only configured once
// AppInitializer has run (see log.js).
const installLog = (attributes) => getLog('InstallPrompt', attributes);

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
      installLog({ previouslyDismissed: dismissed }).info('Browser offered to install the app');
      // If user hasn't dismissed yet, show the banner
      if (!dismissed) setShow(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const install = async () => {
    if (!deferredPrompt) {
      installLog().warn('Install clicked but no install prompt is available');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // outcome is 'accepted' or 'dismissed'
    installLog({ outcome }).info('Install prompt answered');
    deferredPrompt = null;
    setShow(false);
  };

  const dismiss = () => {
    installLog().debug('Install banner dismissed');
    dismissed = true;
    try { localStorage.setItem('bw-install-dismissed', 'true'); } catch {}
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="install-prompt-banner" role="alert">
      <span>Install Bus Wankers as an app</span>
      <button onClick={install} className="install-btn-install">Install</button>
      <button onClick={dismiss} className="install-btn-dismiss" aria-label="Dismiss install prompt">&times;</button>
    </div>
  );
};

export default InstallPrompt;
