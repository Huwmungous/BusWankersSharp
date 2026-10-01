import React, { useCallback, useEffect, useRef, useState } from 'react';
import { correctedNow, scheduleAt, syncClock } from '../launch/clock';
import { buildLaunchLink, loadConfig, saveConfig } from '../launch/config';
import { formatLondon, formatLondonClock, londonWallToEpoch } from '../launch/londonTime';
import { getLog, asError } from '../log';
import './LaunchSection.css';

// Created when used, never at module load (see ../log.js). Declared above the
// component and every handler that calls it. Timing note: the one log on the
// fire path (in fireLaunch) comes AFTER the launch window has been navigated.
const launchLog = (attributes) => getLog('LaunchSection', attributes);

// The "Launcher" tab: arm this browser to open the ticket page, in a window of
// its own, at the sale time - on NTP-corrected time.
//
// A web page cannot start OTHER browsers (Chrome can't launch Firefox), so
// the way to have several browsers in the queue is to open this page in each
// of them and arm each one - every armed browser counts itself down on the
// true time (see launch/clock.js) and, at the moment, sends its launch
// window to the ticket URL. This tab stays put, showing what happened.
// Settings are per browser (localStorage, see launch/config.js) with a
// launch link to copy them from one browser to the next.
//
// Things that bite, and what's done about them:
//   - Popup blockers: a window opened by a timer is blocked, one opened by a
//     click is not. So the launch window is opened BY the Arm click (as a
//     blank holding page we keep a handle to) and merely navigated at the
//     moment. If the user closes it before then, the moment falls back to
//     window.open (may be blocked) and finally to this tab jumping itself.
//   - Background-tab throttling: Chrome slows a hidden tab's timers to once a
//     minute after five minutes. The scheduler runs a second ticker in a Web
//     Worker (not throttled that way), and the page asks for a screen wake
//     lock and nags the user to keep the window visible.
//   - Clock drift: re-synced every minute while armed, and once more shortly
//     before the moment; the scheduler reads the live offset on every tick.
//   - No beforeunload guard: one was tried, and Chrome's "Leave site?" prompt
//     stalled the self-navigation fallback in rehearsal. Nothing here may
//     put a dialog between the moment and the ticket page.

const RESYNC_EVERY_MS = 60000;
const FINAL_SYNC_BEFORE_MS = 12000;
const CLOCK_SAMPLES = 8;
// "Rehearse" arms for this far ahead instead of the real sale time, so the
// whole jump can be tried without touching the saved settings.
const REHEARSAL_SECONDS = 30;
// Named target for the launch window, so re-arming reuses it rather than
// leaving a trail of holding pages.
const LAUNCH_WINDOW_NAME = 'buswankers-launch';
// Tag on the postMessage the holding page sends back about its own wake lock,
// so the listener can ignore any other message.
const LAUNCH_WINDOW_MESSAGE_SOURCE = 'buswankers-launch-window';

const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const pad2 = (n) => String(n).padStart(2, '0');

const formatCountdown = (ms) => {
  const past = ms < 0;
  let rest = Math.abs(ms);
  const days = Math.floor(rest / 86400000);
  rest -= days * 86400000;
  const hours = Math.floor(rest / 3600000);
  rest -= hours * 3600000;
  const mins = Math.floor(rest / 60000);
  rest -= mins * 60000;
  const secs = Math.floor(rest / 1000);
  const millis = Math.floor(rest - secs * 1000);
  const core = `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}.${String(millis).padStart(3, '0')}`;
  const withDays = days > 0 ? `${days}d ${core}` : core;
  return past ? `-${withDays}` : withDays;
};

// "61 days", "3 hours", "12 minutes" - a coarse distance shown next to the
// sale time so a wrong month or year is obvious at a glance.
const describeDistance = (ms) => {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(ms / 86400000);
  return `${days} day${days === 1 ? '' : 's'}`;
};

const signedMs = (ms) => `${ms >= 0 ? '+' : '-'}${Math.abs(ms).toFixed(1)} ms`;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// The holding page shown in the launch window until the moment, so it's
// obvious what the window is and nobody closes it by mistake.
//
// It also holds the screen wake lock. The launch window opens in front of the
// Launcher tab (often as a tab of its own), which hides the Launcher and makes
// the browser drop ITS lock - so this page, the visible one, asks for its own
// and reports the outcome back to the opener with postMessage (for the log and
// the status line). It retries when it becomes visible or focused again. The
// script is plain ES5 inside a template literal: no backticks or dollar-braces
// in it, and parentOrigin is JSON-encoded with '<' escaped.
const holdingPageHtml = (when, url, rehearsal, parentOrigin) => `<!doctype html><html><head><meta charset="utf-8"><title>Bus Wankers launch window - ${escapeHtml(when)}</title>
<style>body{font-family:Arial,sans-serif;background:${rehearsal ? '#6d4c00' : '#1b5e20'};color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:1.6em;margin:0 0 .4em}p{margin:.3em 0;font-size:1.1em}code{font-size:.9em;opacity:.85}
.nb{margin-top:1.2em;font-size:.95em;max-width:34em;background:rgba(255,255,255,.15);padding:.6em .9em;border-radius:6px}
.wl{margin-top:1em;font-size:.9em;opacity:.9}</style></head>
<body><div><h1>Bus Wankers launch window${rehearsal ? ' (rehearsal)' : ''}</h1><p>This window will jump to</p><p><code>${escapeHtml(url)}</code></p><p>at <strong>${escapeHtml(when)}</strong></p><p>Leave it open. Don't refresh it.</p>
<p class="wl" id="wl">Screen wake lock: asking&hellip;</p>
<p class="nb"><strong>NB:</strong> Rehearse this at least once in case the website asks you to accept cookies - accept them then, so there's nothing to click through on the day.</p></div>
<script>
(function () {
  var parentOrigin = ${JSON.stringify(parentOrigin).replace(/</g, '\\u003c')};
  var lock = null;
  var pending = false;
  var label = document.getElementById('wl');
  function show(text) { if (label) label.textContent = 'Screen wake lock: ' + text; }
  function tell(state, errorName) {
    try {
      if (window.opener) {
        window.opener.postMessage({
          source: '${LAUNCH_WINDOW_MESSAGE_SOURCE}',
          state: state,
          errorName: errorName || null,
          visibility: document.visibilityState
        }, parentOrigin);
      }
    } catch (e) { /* the opener is gone; nothing to tell */ }
  }
  function acquire() {
    if (!navigator.wakeLock) { show('not supported by this browser'); tell('unsupported'); return; }
    if (lock || pending) return;
    pending = true;
    navigator.wakeLock.request('screen').then(function (granted) {
      pending = false;
      lock = granted;
      show('on');
      tell('held');
      granted.addEventListener('release', function () {
        if (lock === granted) {
          lock = null;
          show('off - will retry when this window is visible');
          tell('released');
        }
      });
    }, function (err) {
      pending = false;
      show('refused (' + (err && err.name ? err.name : 'error') + ') - will retry');
      tell('refused', err && err.name);
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') acquire();
  });
  window.addEventListener('focus', acquire);
  acquire();
})();
<\/script></body></html>`;

const LaunchSection = ({ year }) => {
  const [{ config: initialConfig, imported }] = useState(() => loadConfig());
  const [config, setConfig] = useState(initialConfig);
  const [sync, setSync] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | ready | error
  const [syncError, setSyncError] = useState('');
  const [armed, setArmed] = useState(false);
  const [rehearsalTarget, setRehearsalTarget] = useState(null); // epoch ms while rehearsing, else null
  const [fired, setFired] = useState(null); // { via, lateMs, how, rehearsal, staggerMs }
  // This browser's random stagger for the current arm, drawn from
  // [0, config.staggerMs] when arming (see launch/config.js).
  const [staggerDraw, setStaggerDraw] = useState(0);
  const [notice, setNotice] = useState(imported ? 'Settings taken from the launch link and saved in this browser.' : '');
  const [launchWindowOpen, setLaunchWindowOpen] = useState(false);
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);
  // idle | held | refused | released | unsupported. 'refused' means the browser
  // said no (battery saver, hidden window...); 'released' means we held it and the
  // browser took it back (tab hidden). Both are retried while armed.
  const [wakeLockState, setWakeLockState] = useState(
    () => (typeof navigator !== 'undefined' && navigator.wakeLock ? 'idle' : 'unsupported'),
  );
  // What the launch window's holding page last reported about ITS wake lock:
  // unknown | held | refused | released | unsupported. 'unknown' until it speaks
  // (it never will if the page's script was blocked).
  const [launchWindowLock, setLaunchWindowLock] = useState('unknown');

  const syncRef = useRef(null);
  const launchWindowRef = useRef(null);
  const wakeLockRef = useRef(null);
  // True while a request is in flight, so two triggers (arm click plus a
  // visibilitychange, say) can't both pass the guard and leak a second lock.
  const wakeLockPendingRef = useRef(false);
  // True from arming until disarm/fire/unmount. Checked after the request
  // resolves so a lock granted after a disarm is released, not kept.
  const wakeLockWantedRef = useRef(false);

  const saleMs = londonWallToEpoch(config.saleAt);
  const rehearsing = rehearsalTarget != null;
  // What the countdown and the scheduler aim at: the rehearsal moment while
  // rehearsing, otherwise the real sale time.
  const targetMs = rehearsing ? rehearsalTarget : saleMs;
  const urlOk = isHttpUrl(config.url);
  const nowMs = correctedNow(syncRef.current);
  // Lead minus this arm's stagger: the jump is leadMs early, then staggerDraw
  // late, so several browsers on one line don't land in the same instant.
  const effectiveLeadMs = config.leadMs - (armed ? staggerDraw : 0);
  const remainingMs = targetMs != null ? targetMs - effectiveLeadMs - nowMs : null;
  const targetInFuture = remainingMs != null && remainingMs > 0;
  const saleInFuture = saleMs != null && saleMs - config.leadMs - nowMs > 0;

  // ---- settings ---------------------------------------------------------

  const updateConfig = (patch) => {
    setConfig((prev) => saveConfig({ ...prev, ...patch }));
  };

  // ---- clock sync -------------------------------------------------------

  const runSync = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const result = await syncClock(CLOCK_SAMPLES);
      syncRef.current = result;
      setSync(result);
      setSyncStatus('ready');
      setSyncError('');
      launchLog({ offsetMs: result.offsetMs, rttMs: result.rttMs, samples: result.samples, spreadMs: result.spreadMs })
        .debug('Clock synced');
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err.message || 'Clock sync failed.');
      launchLog().warn('Clock sync failed', asError(err));
    }
  }, []);

  useEffect(() => {
    runSync();
  }, [runSync]);

  // ---- live readout -----------------------------------------------------

  useEffect(() => {
    const every = armed ? 50 : 250;
    const id = setInterval(() => {
      const w = launchWindowRef.current;
      const open = !!(w && !w.closed);
      setLaunchWindowOpen((was) => (was === open ? was : open));
      setTick((t) => t + 1);
    }, every);
    return () => clearInterval(id);
  }, [armed]);

  // ---- wake lock ----------------------------------------------------------

  // The request must be made while this page is visible and focused, and it is
  // best made straight from the Arm click. 'reason' says what triggered it so
  // the log can tell a refusal at arm time from one on a retry.
  const acquireWakeLock = useCallback(async (reason) => {
    if (!navigator.wakeLock) {
      setWakeLockState('unsupported');
      return;
    }
    // Already held, or a request is in flight: nothing to do. Deliberately not
    // logged - the retry triggers (focus, clicks) would make it noisy.
    if (wakeLockRef.current || wakeLockPendingRef.current) return;
    wakeLockPendingRef.current = true;
    launchLog({ reason, visibility: document.visibilityState, focused: document.hasFocus() })
      .debug('Screen wake lock requested');
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!wakeLockWantedRef.current) {
        // Disarmed (or fired, or unmounted) while the request was in flight.
        launchLog({ reason }).debug('Screen wake lock granted after it was no longer wanted - releasing');
        lock.release().catch(() => {});
        return;
      }
      wakeLockRef.current = lock;
      lock.addEventListener('release', () => {
        // Compare with THIS lock: a stale release event must not clear a newer one.
        if (wakeLockRef.current === lock) {
          wakeLockRef.current = null;
          if (wakeLockWantedRef.current) setWakeLockState('released');
          launchLog({ visibility: document.visibilityState }).info('Screen wake lock released by the browser');
        }
      });
      setWakeLockState('held');
      launchLog({ reason }).debug('Screen wake lock acquired');
    } catch (err) {
      setWakeLockState('refused');
      launchLog({
        reason,
        errorName: err && err.name,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      }).warn('Screen wake lock refused', asError(err));
    } finally {
      wakeLockPendingRef.current = false;
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockWantedRef.current = false;
    wakeLockRef.current = null;
    setWakeLockState((was) => (was === 'unsupported' ? was : 'idle'));
    setLaunchWindowLock('unknown');
    if (lock) {
      lock.release().catch(() => {});
      launchLog().debug('Screen wake lock released by us');
    }
  }, []);

  // While armed, try again whenever the page comes back to the foreground or
  // the user touches it - those are the moments a refused or released lock can
  // succeed. acquireWakeLock is a no-op while a lock is held or in flight.
  useEffect(() => {
    if (!armed) return undefined;
    const retryOn = (reason) => () => {
      if (document.visibilityState === 'visible') acquireWakeLock(reason);
    };
    const onVisible = retryOn('visibilitychange');
    const onFocus = retryOn('focus');
    const onPointer = retryOn('pointerdown');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [armed, acquireWakeLock]);

  // Never leave a lock behind if this section goes away while armed.
  useEffect(() => () => releaseWakeLock(), [releaseWakeLock]);

  // The launch window's holding page holds a wake lock of its own (see
  // holdingPageHtml) and tells us how it is getting on. Only messages from our
  // own origin, from the current launch window, carrying our tag are heard.
  useEffect(() => {
    const onMessage = (event) => {
      const data = event.data;
      if (event.origin !== window.location.origin) return;
      if (!data || data.source !== LAUNCH_WINDOW_MESSAGE_SOURCE) return;
      if (!launchWindowRef.current || event.source !== launchWindowRef.current) return;
      const state = String(data.state);
      setLaunchWindowLock(state);
      const log = launchLog({ state, errorName: data.errorName, visibility: data.visibility });
      if (state === 'held') log.debug('Launch window screen wake lock acquired');
      else if (state === 'released') log.info('Launch window screen wake lock released by the browser');
      else if (state === 'refused') log.warn('Launch window screen wake lock refused');
      else log.warn('Launch window screen wake lock unavailable');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);


  // ---- the launch window --------------------------------------------------

  // Open (or reuse) the launch window and show the holding page in it. Must
  // be called from a click handler - that's what gets it past the popup
  // blocker. Returns false if the browser blocked it.
  const openLaunchWindow = (whenMs, rehearsal) => {
    let w = null;
    try {
      w = window.open('', LAUNCH_WINDOW_NAME);
    } catch (err) {
      launchLog().error('window.open threw while opening the launch window', asError(err));
    }
    if (!w) {
      launchLog().warn('Launch window blocked by the browser (pop-up blocker?)');
      launchWindowRef.current = null;
      setLaunchWindowOpen(false);
      return false;
    }
    try {
      w.document.open();
      w.document.write(holdingPageHtml(formatLondon(whenMs), config.url, rehearsal, window.location.origin));
      w.document.close();
    } catch (err) {
      // A stale window on another origin - still ours to navigate later.
      launchLog().warn('Could not write the holding page into the launch window', asError(err));
    }
    launchWindowRef.current = w;
    setLaunchWindowOpen(true);
    // Bring focus back so the user is looking at the countdown, not a blank.
    try {
      window.focus();
    } catch {
      // some browsers refuse; harmless
    }
    return true;
  };

  const closeLaunchWindow = () => {
    const w = launchWindowRef.current;
    launchWindowRef.current = null;
    setLaunchWindowOpen(false);
    try {
      if (w && !w.closed) w.close();
    } catch {
      // ignore
    }
  };

  // ---- arming -------------------------------------------------------------

  const fireLaunch = useCallback((via, lateMs) => {
    const url = config.url;
    const rehearsal = rehearsalTarget != null;
    let how = 'launch window';
    const w = launchWindowRef.current;
    let done = false;
    // Problems on the fire path are remembered here and logged afterwards, once
    // the launch window has been navigated (or a fresh one opened) - nothing is
    // logged between the moment and that jump. Only the last-resort fallback,
    // this tab navigating itself, follows the log line, as it did the old one.
    let navigationError = null;
    let openError = null;
    if (w && !w.closed) {
      try {
        w.location.href = url;
        done = true;
        try {
          w.focus();
        } catch {
          // focus is best-effort
        }
      } catch (err) {
        navigationError = err;
      }
    }
    if (!done) {
      // The launch window was closed. Try a fresh one (a popup blocker may
      // refuse it outside a click), and as a last resort go there ourselves.
      let fresh = null;
      try {
        fresh = window.open(url, LAUNCH_WINDOW_NAME);
      } catch (err) {
        openError = err;
        fresh = null;
      }
      if (fresh) {
        launchWindowRef.current = fresh;
        how = 'a new window (the launch window had been closed)';
        done = true;
      }
    }
    if (navigationError) launchLog().error('Launch window navigation failed', asError(navigationError));
    if (openError) launchLog().error('Opening a fresh launch window failed', asError(openError));
    launchLog({
      via,
      lateMs: lateMs.toFixed(1),
      leadMs: config.leadMs,
      staggerMs: staggerDraw,
      rehearsal,
      how: done ? how : 'this tab',
    }).info('Launch FIRED');
    setFired({ via, lateMs, how: done ? how : 'this tab', rehearsal, staggerMs: staggerDraw });
    setArmed(false);
    setRehearsalTarget(null);
    releaseWakeLock();
    if (!done) {
      window.location.href = url;
    }
  }, [config.url, config.leadMs, staggerDraw, rehearsalTarget, releaseWakeLock]);

  useEffect(() => {
    if (!armed || targetMs == null) return undefined;

    const cancelSchedule = scheduleAt(
      targetMs,
      () => correctedNow(syncRef.current),
      fireLaunch,
      { leadMs: effectiveLeadMs },
    );

    // Keep the offset fresh: every minute, and one last time just before.
    const resync = setInterval(() => {
      const left = targetMs - correctedNow(syncRef.current);
      if (left > FINAL_SYNC_BEFORE_MS + 5000) runSync();
    }, RESYNC_EVERY_MS);
    const finalDelay = targetMs - correctedNow(syncRef.current) - FINAL_SYNC_BEFORE_MS;
    const finalSync = finalDelay > 2000 ? setTimeout(runSync, finalDelay) : null;

    return () => {
      cancelSchedule();
      clearInterval(resync);
      if (finalSync) clearTimeout(finalSync);
    };
  }, [armed, targetMs, effectiveLeadMs, fireLaunch, runSync]);

  const armFor = (whenMs, rehearsal) => {
    // Ask for this tab's wake lock first, straight from the click. Opening the
    // launch window usually hides this tab (it often opens as a tab in front),
    // and the browser then drops the lock - that is why the launch window's
    // holding page asks for one of its own. This one still covers the case where
    // the launch window is a separate window sitting beside this one.
    wakeLockWantedRef.current = true;
    setLaunchWindowLock('unknown');
    acquireWakeLock('arm');
    const opened = openLaunchWindow(whenMs, rehearsal);
    const draw = config.staggerMs > 0 ? Math.round(Math.random() * config.staggerMs) : 0;
    setStaggerDraw(draw);
    setRehearsalTarget(rehearsal ? whenMs : null);
    setFired(null);
    setNotice(opened
      ? ''
      : 'The browser blocked the launch window - allow pop-ups for this site and arm again. Until then, this tab itself will jump at the moment.');
    setArmed(true);
    launchLog({
      rehearsal,
      armedFor: formatLondon(whenMs),
      leadMs: config.leadMs,
      staggerDrawMs: draw,
      staggerMaxMs: config.staggerMs,
      launchWindow: opened ? 'open' : 'blocked',
    }).info('Launch armed');
  };

  const arm = () => {
    launchLog({ saleAt: config.saleAt, urlOk }).debug('Arm requested');
    if (!urlOk) {
      launchLog().warn('Arm refused - the ticket URL is not a full http(s) address');
      setNotice('The ticket URL needs to be a full http(s) address.');
      return;
    }
    if (saleMs == null) {
      launchLog().warn('Arm refused - no sale time set');
      setNotice('Set the sale time first.');
      return;
    }
    if (!saleInFuture) {
      launchLog({ saleAt: config.saleAt }).warn('Arm refused - the sale time has already passed');
      setNotice('That sale time has already passed.');
      return;
    }
    armFor(saleMs, false);
  };

  // Same as arming, but for REHEARSAL_SECONDS from now rather than the sale
  // time - the saved settings are untouched, so a rehearsal can't leave a
  // wrong date behind.
  const rehearse = () => {
    launchLog({ urlOk }).debug('Rehearsal requested');
    if (!urlOk) {
      launchLog().warn('Rehearsal refused - the ticket URL is not a full http(s) address');
      setNotice('The ticket URL needs to be a full http(s) address.');
      return;
    }
    armFor(correctedNow(syncRef.current) + REHEARSAL_SECONDS * 1000 + config.leadMs, true);
  };

  const disarm = () => {
    setArmed(false);
    setRehearsalTarget(null);
    releaseWakeLock();
    closeLaunchWindow();
    setNotice('Disarmed.');
    launchLog({ rehearsal: rehearsalTarget != null }).info('Launch disarmed');
  };

  const copyLink = async () => {
    const link = buildLaunchLink(config);
    try {
      await navigator.clipboard.writeText(link);
      launchLog().debug('Launch link copied to the clipboard');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      launchLog().warn('Copying the launch link failed', asError(err));
      setNotice('Copy failed - select the link below and copy it by hand.');
    }
  };

  // ---- render -------------------------------------------------------------

  const title = `Glastonbury ${year} sale-day launcher`;
  // A lock held by the launch window counts only while that window is still open.
  const wakeLockHeld = wakeLockState === 'held' || (launchWindowLock === 'held' && launchWindowOpen);
  const clockSource = sync
    ? (sync.source === 'ntp' ? `NTP via ${sync.server}` : 'the server’s own clock (NTP unavailable!)')
    : '';
  const usingLocalClock = syncStatus === 'error' || (sync && sync.source !== 'ntp');
  const jumpAt = targetMs != null ? targetMs - effectiveLeadMs : null;
  const timingNote = () => {
    const parts = [];
    if (config.leadMs) parts.push(config.leadMs > 0 ? `${config.leadMs} ms early` : `${-config.leadMs} ms late`);
    if (armed && staggerDraw) parts.push(`+${staggerDraw} ms stagger`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  };

  return (
    <section className="launch" aria-label={title}>
      <div className="launch-inner">
        <h2 className="launch-title">{title}</h2>
        <p className="launch-blurb">
          Arm this browser and, at the sale time exactly, it opens the ticket page in a window of its own - on true (NTP) time,
          not whatever this computer&rsquo;s clock thinks. Open this page in <strong>every browser you have</strong>
          {' '}(Chrome, Firefox, Edge, Opera, Safari&hellip;) and arm each one: each is a separate entrant in the queue.
        </p>

        {notice && <p className="launch-notice">{notice}</p>}

        <div className="launch-grid">
          <fieldset className="launch-card" disabled={armed}>
            <legend>1. Settings <span className="launch-muted">(saved in this browser)</span></legend>
            <label className="launch-field">
              <span>Ticket page URL</span>
              <input
                type="url"
                value={config.url}
                onChange={(e) => updateConfig({ url: e.target.value })}
                placeholder="https://glastonbury.seetickets.com/"
                spellCheck={false}
              />
              {!urlOk && <span className="launch-field-error">Needs to be a full http(s) address.</span>}
            </label>
            <label className="launch-field">
              <span>Sale time (UK time, Europe/London)</span>
              <input
                type="datetime-local"
                value={config.saleAt}
                step="60"
                onChange={(e) => updateConfig({ saleAt: e.target.value })}
              />
              {saleMs != null && (
                <span className="launch-field-hint">
                  = {formatLondon(saleMs)}{saleInFuture ? ` (${describeDistance(saleMs - nowMs)} away)` : ' - already passed'}
                </span>
              )}
            </label>
            <label className="launch-field launch-field-inline">
              <span>Jump early by (ms)</span>
              <input
                type="number"
                min="-60000"
                max="60000"
                step="50"
                value={config.leadMs}
                onChange={(e) => updateConfig({ leadMs: e.target.value })}
              />
              <span className="launch-field-hint">200 is the default: the jump takes a page-load, so leaving a touch early lands on the moment. 0 = exactly on it.</span>
            </label>
            <label className="launch-field launch-field-inline">
              <span>Random stagger up to (ms)</span>
              <input
                type="number"
                min="0"
                max="10000"
                step="50"
                value={config.staggerMs}
                onChange={(e) => updateConfig({ staggerMs: e.target.value })}
              />
              <span className="launch-field-hint">
                Each browser you arm picks its own random delay up to this, so several browsers on one connection don&rsquo;t all hit the site in the same instant. 0 = off.
              </span>
            </label>
            <div className="launch-link-row">
              <button type="button" className="launch-btn" onClick={copyLink} disabled={!urlOk}>
                {copied ? 'Copied!' : 'Copy launch link'}
              </button>
              <span className="launch-field-hint">
                Paste it into each of your other browsers - it opens this tab with these settings already filled in.
              </span>
            </div>
            <input className="launch-link" type="text" readOnly value={urlOk ? buildLaunchLink(config) : ''} onFocus={(e) => e.target.select()} />
          </fieldset>

          <div className="launch-card">
            <h3 className="launch-card-title">2. Clock</h3>
            <div className={`launch-clock${usingLocalClock ? ' launch-clock-warn' : ''}`}>
              <div className="launch-clock-now">{formatLondonClock(nowMs)}</div>
              <div className="launch-clock-caption">true UK time now</div>
            </div>
            {syncStatus === 'syncing' && <p className="launch-muted">Syncing with the time service&hellip;</p>}
            {syncStatus === 'error' && (
              <p className="launch-error">
                Couldn&rsquo;t sync: {syncError} Using this computer&rsquo;s clock, which may be seconds out.
              </p>
            )}
            {sync && (
              <p className="launch-sync-detail">
                This computer&rsquo;s clock is <strong>{signedMs(-sync.offsetMs)}</strong> from true time
                ({clockSource}; round trip {sync.rttMs.toFixed(0)} ms, {sync.samples} samples, spread {sync.spreadMs.toFixed(1)} ms).
                {sync.source !== 'ntp' && ' The time service could not reach an NTP server - tell Hugh.'}
              </p>
            )}
            <button type="button" className="launch-btn launch-btn-secondary" onClick={runSync} disabled={syncStatus === 'syncing'}>
              Re-sync now
            </button>
          </div>

          <div className="launch-card launch-card-arm">
            <h3 className="launch-card-title">3. Arm</h3>
            {targetMs == null ? (
              <p className="launch-muted">Set the sale time to see the countdown.</p>
            ) : (
              <div className={`launch-countdown${armed ? ' launch-countdown-armed' : ''}${!targetInFuture ? ' launch-countdown-past' : ''}`}>
                <div className="launch-countdown-value">{formatCountdown(remainingMs)}</div>
                <div className="launch-clock-caption">
                  {rehearsing ? 'until the REHEARSAL jump' : (targetInFuture ? 'until the jump' : 'the sale time has passed')}
                  {timingNote()}
                </div>
              </div>
            )}

            {!armed ? (
              <>
                <button type="button" className="launch-btn launch-btn-arm" onClick={arm} disabled={!urlOk || !saleInFuture}>
                  Arm this browser
                </button>
                <span className="launch-field-hint">
                  Arming opens the launch window straight away (blank, green); at the moment it goes to the ticket page. This tab stays here.
                </span>
                <button type="button" className="launch-btn launch-btn-secondary launch-btn-rehearse" onClick={rehearse} disabled={!urlOk}>
                  Rehearse: jump in {REHEARSAL_SECONDS} s
                </button>
                <span className="launch-field-hint">Rehearsal ignores the sale time and does the same thing {REHEARSAL_SECONDS} seconds from now.</span>
                <p className="launch-nb">
                  <strong>NB:</strong> Rehearse this at least once in every browser you&rsquo;ll use, in case the website asks you to accept cookies -
                  accept them during the rehearsal so there&rsquo;s nothing to click through on the day.
                </p>
              </>
            ) : (
              <button type="button" className="launch-btn launch-btn-disarm" onClick={disarm}>
                {rehearsing ? 'Cancel rehearsal' : 'Disarm'}
              </button>
            )}

            {armed && (
              <div className={`launch-armed-box${rehearsing ? ' launch-armed-box-rehearsal' : ''}`}>
                <p><strong>{rehearsing ? 'Rehearsal armed.' : 'Armed.'}</strong> The launch window will go to<br />
                  <code>{config.url}</code><br />at {formatLondonClock(jumpAt)} ({formatLondon(jumpAt)}){timingNote()}.</p>
                {!launchWindowOpen && (
                  <p className="launch-error">
                    <strong>The launch window is closed.</strong> Disarm and arm again to open a new one - otherwise this tab itself will jump at the moment.
                  </p>
                )}
                <ul>
                  <li>Keep this window and the launch window <strong>on screen</strong> - not minimised, not behind another window.</li>
                  <li>Laptop on mains power; don&rsquo;t let it sleep.</li>
                  {wakeLockHeld && (
                    <li>
                      Screen wake lock is on (held by {wakeLockState === 'held' ? 'this tab' : 'the launch window'}),
                      so the screen should stay awake.
                    </li>
                  )}
                  {!wakeLockHeld && wakeLockState === 'unsupported' && (
                    <li className="launch-error">
                      <strong>This browser has no screen wake lock.</strong> Change the power settings so the screen
                      doesn&rsquo;t sleep, or keep touching it.
                    </li>
                  )}
                  {!wakeLockHeld && (wakeLockState === 'refused' || wakeLockState === 'released') && (
                    <li className="launch-error">
                      <strong>The screen wake lock is not active.</strong> The browser refused it or took it back - often
                      battery saver or low-power mode, or the tab being hidden. Whichever of this tab and the launch
                      window is in front will try again each time it is visible or you tap it. Until it says it is on,
                      change the power settings so the screen doesn&rsquo;t sleep.
                    </li>
                  )}
                  {!wakeLockHeld && wakeLockState === 'idle' && <li>Asking for a screen wake lock&hellip;</li>}
                  <li>Don&rsquo;t reload this tab - that disarms it.</li>
                </ul>
              </div>
            )}
            {fired && (
              <p className="launch-fired">
                {fired.rehearsal ? 'Rehearsal jumped' : 'Jumped'} via {fired.via} into {fired.how}, {fired.lateMs.toFixed(0)} ms after its moment
                {fired.staggerMs ? ` (this browser's stagger was +${fired.staggerMs} ms)` : ''}.
                {fired.rehearsal && ' Now arm for the real thing when you’re ready.'}
              </p>
            )}
          </div>
        </div>

        <details className="launch-how">
          <summary>How to use this on sale day</summary>
          <ol>
            <li>Fill in the settings above (once), then <em>Copy launch link</em>.</li>
            <li>Open each other browser on this computer, paste the link into its address bar and press Enter. Its settings fill in automatically. Do the same on every other computer, phone and tablet you have to hand.</li>
            <li>In each browser, check the clock card says it&rsquo;s synced with NTP, then press <em>Rehearse</em> once and watch the launch window jump - the ticket page will say the sale isn&rsquo;t open yet, and that&rsquo;s fine. If it asks you to accept cookies, accept them now so it won&rsquo;t ask on the day. Close that window, then press <em>Arm this browser</em>.</li>
            <li>Arrange things so every armed browser and its launch window are visible, and leave them alone. At the moment every launch window goes to the ticket page.</li>
            <li>Then it&rsquo;s the usual drill: in whichever browser gets through, use its <em>Fill Group</em> bookmark (Documentation tab) to fill the form.</li>
          </ol>
          <p className="launch-muted">
            Why not one button that launches every browser? A web page can&rsquo;t start other programs - Chrome can&rsquo;t open Firefox.
            Arming the page in each browser is the no-install way to get the same result; each browser is its own queue place.
          </p>
        </details>
      </div>
    </section>
  );
};

export default LaunchSection;
