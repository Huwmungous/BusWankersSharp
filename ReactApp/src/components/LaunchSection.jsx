import React, { useCallback, useEffect, useRef, useState } from 'react';
import { correctedNow, scheduleAt, syncClock } from '../launch/clock';
import { buildLaunchLink, loadConfig, saveConfig } from '../launch/config';
import { formatLondon, formatLondonClock, londonWallToEpoch } from '../launch/londonTime';
import './LaunchSection.css';

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
const holdingPageHtml = (when, url, rehearsal) => `<!doctype html><html><head><meta charset="utf-8"><title>Bus Wankers launch window - ${escapeHtml(when)}</title>
<style>body{font-family:Arial,sans-serif;background:${rehearsal ? '#6d4c00' : '#1b5e20'};color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:1.6em;margin:0 0 .4em}p{margin:.3em 0;font-size:1.1em}code{font-size:.9em;opacity:.85}</style></head>
<body><div><h1>Bus Wankers launch window${rehearsal ? ' (rehearsal)' : ''}</h1><p>This window will jump to</p><p><code>${escapeHtml(url)}</code></p><p>at <strong>${escapeHtml(when)}</strong></p><p>Leave it open. Don't refresh it.</p></div></body></html>`;

const LaunchSection = ({ year }) => {
  const [{ config: initialConfig, imported }] = useState(() => loadConfig());
  const [config, setConfig] = useState(initialConfig);
  const [sync, setSync] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | ready | error
  const [syncError, setSyncError] = useState('');
  const [armed, setArmed] = useState(false);
  const [rehearsalTarget, setRehearsalTarget] = useState(null); // epoch ms while rehearsing, else null
  const [fired, setFired] = useState(null); // { via, lateMs, how, rehearsal }
  const [notice, setNotice] = useState(imported ? 'Settings taken from the launch link and saved in this browser.' : '');
  const [launchWindowOpen, setLaunchWindowOpen] = useState(false);
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  const syncRef = useRef(null);
  const launchWindowRef = useRef(null);
  const wakeLockRef = useRef(null);

  const saleMs = londonWallToEpoch(config.saleAt);
  const rehearsing = rehearsalTarget != null;
  // What the countdown and the scheduler aim at: the rehearsal moment while
  // rehearsing, otherwise the real sale time.
  const targetMs = rehearsing ? rehearsalTarget : saleMs;
  const urlOk = isHttpUrl(config.url);
  const nowMs = correctedNow(syncRef.current);
  const remainingMs = targetMs != null ? targetMs - config.leadMs - nowMs : null;
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
      console.debug('[launch] clock synced', result);
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err.message || 'Clock sync failed.');
      console.debug('[launch] clock sync failed:', err && err.message);
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

  const acquireWakeLock = useCallback(async () => {
    if (!navigator.wakeLock || wakeLockRef.current) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null;
      });
      console.debug('[launch] screen wake lock acquired');
    } catch (err) {
      console.debug('[launch] wake lock refused:', err && err.message);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock) lock.release().catch(() => {});
  }, []);

  useEffect(() => {
    if (!armed) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [armed, acquireWakeLock]);

  // ---- the launch window --------------------------------------------------

  // Open (or reuse) the launch window and show the holding page in it. Must
  // be called from a click handler - that's what gets it past the popup
  // blocker. Returns false if the browser blocked it.
  const openLaunchWindow = (whenMs, rehearsal) => {
    let w = null;
    try {
      w = window.open('', LAUNCH_WINDOW_NAME);
    } catch (err) {
      console.debug('[launch] window.open threw:', err && err.message);
    }
    if (!w) {
      launchWindowRef.current = null;
      setLaunchWindowOpen(false);
      return false;
    }
    try {
      w.document.open();
      w.document.write(holdingPageHtml(formatLondon(whenMs), config.url, rehearsal));
      w.document.close();
    } catch (err) {
      // A stale window on another origin - still ours to navigate later.
      console.debug('[launch] could not write holding page:', err && err.message);
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
        console.debug('[launch] launch window navigation failed:', err && err.message);
      }
    }
    if (!done) {
      // The launch window was closed. Try a fresh one (a popup blocker may
      // refuse it outside a click), and as a last resort go there ourselves.
      let fresh = null;
      try {
        fresh = window.open(url, LAUNCH_WINDOW_NAME);
      } catch {
        fresh = null;
      }
      if (fresh) {
        launchWindowRef.current = fresh;
        how = 'a new window (the launch window had been closed)';
        done = true;
      }
    }
    console.debug(`[launch] FIRED via ${via}, ${lateMs.toFixed(1)} ms after the moment -> ${url} (${done ? how : 'this tab'})`);
    setFired({ via, lateMs, how: done ? how : 'this tab', rehearsal });
    setArmed(false);
    setRehearsalTarget(null);
    releaseWakeLock();
    if (!done) {
      window.location.href = url;
    }
  }, [config.url, rehearsalTarget, releaseWakeLock]);

  useEffect(() => {
    if (!armed || targetMs == null) return undefined;

    const cancelSchedule = scheduleAt(
      targetMs,
      () => correctedNow(syncRef.current),
      fireLaunch,
      { leadMs: config.leadMs },
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
  }, [armed, targetMs, config.leadMs, fireLaunch, runSync]);

  const armFor = (whenMs, rehearsal) => {
    const opened = openLaunchWindow(whenMs, rehearsal);
    setRehearsalTarget(rehearsal ? whenMs : null);
    setFired(null);
    setNotice(opened
      ? ''
      : 'The browser blocked the launch window - allow pop-ups for this site and arm again. Until then, this tab itself will jump at the moment.');
    setArmed(true);
    acquireWakeLock();
    console.debug(`[launch] ${rehearsal ? 'REHEARSAL ' : ''}armed for ${formatLondon(whenMs)} (lead ${config.leadMs} ms), launch window ${opened ? 'open' : 'BLOCKED'}`);
  };

  const arm = () => {
    if (!urlOk) {
      setNotice('The ticket URL needs to be a full http(s) address.');
      return;
    }
    if (saleMs == null) {
      setNotice('Set the sale time first.');
      return;
    }
    if (!saleInFuture) {
      setNotice('That sale time has already passed.');
      return;
    }
    armFor(saleMs, false);
  };

  // Same as arming, but for REHEARSAL_SECONDS from now rather than the sale
  // time - the saved settings are untouched, so a rehearsal can't leave a
  // wrong date behind.
  const rehearse = () => {
    if (!urlOk) {
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
    console.debug('[launch] disarmed');
  };

  const copyLink = async () => {
    const link = buildLaunchLink(config);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice('Copy failed - select the link below and copy it by hand.');
    }
  };

  // ---- render -------------------------------------------------------------

  const title = `Glastonbury ${year} sale-day launcher`;
  const clockSource = sync
    ? (sync.source === 'ntp' ? `NTP via ${sync.server}` : 'the server’s own clock (NTP unavailable!)')
    : '';
  const usingLocalClock = syncStatus === 'error' || (sync && sync.source !== 'ntp');
  const jumpAt = targetMs != null ? targetMs - config.leadMs : null;

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
                  {config.leadMs ? ` (${config.leadMs > 0 ? `${config.leadMs} ms early` : `${-config.leadMs} ms late`})` : ''}
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
                <span className="launch-field-hint">Rehearsal ignores the sale time and does the same thing {REHEARSAL_SECONDS} seconds from now - try it once in each browser.</span>
              </>
            ) : (
              <button type="button" className="launch-btn launch-btn-disarm" onClick={disarm}>
                {rehearsing ? 'Cancel rehearsal' : 'Disarm'}
              </button>
            )}

            {armed && (
              <div className={`launch-armed-box${rehearsing ? ' launch-armed-box-rehearsal' : ''}`}>
                <p><strong>{rehearsing ? 'Rehearsal armed.' : 'Armed.'}</strong> The launch window will go to<br />
                  <code>{config.url}</code><br />at {formatLondonClock(jumpAt)} ({formatLondon(jumpAt)}).</p>
                {!launchWindowOpen && (
                  <p className="launch-error">
                    <strong>The launch window is closed.</strong> Disarm and arm again to open a new one - otherwise this tab itself will jump at the moment.
                  </p>
                )}
                <ul>
                  <li>Keep this window and the launch window <strong>on screen</strong> - not minimised, not behind another window.</li>
                  <li>Laptop on mains power; don&rsquo;t let it sleep (a screen wake lock has been requested{navigator.wakeLock ? '' : ', but this browser doesn’t support it'}).</li>
                  <li>Don&rsquo;t reload this tab - that disarms it.</li>
                </ul>
              </div>
            )}
            {fired && (
              <p className="launch-fired">
                {fired.rehearsal ? 'Rehearsal jumped' : 'Jumped'} via {fired.via} into {fired.how}, {fired.lateMs.toFixed(0)} ms after the moment.
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
            <li>In each browser, check the clock card says it&rsquo;s synced with NTP, then press <em>Rehearse</em> once and watch the launch window jump - the ticket page will say the sale isn&rsquo;t open yet, and that&rsquo;s fine. Close that window, then press <em>Arm this browser</em>.</li>
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
