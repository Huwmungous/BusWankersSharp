import React, { useCallback, useEffect, useRef, useState } from 'react';
import { correctedNow, scheduleAt, syncClock } from '../launch/clock';
import { buildLaunchLink, loadConfig, saveConfig } from '../launch/config';
import { formatLondon, formatLondonClock, londonWallToEpoch } from '../launch/londonTime';
import './LaunchSection.css';

// The "Launch" tab: arm this browser to jump to the ticket page at the sale
// time, on NTP-corrected time.
//
// A web page cannot start OTHER browsers (Chrome can't launch Firefox), so
// the way to have several browsers in the queue is to open this page in each
// of them and arm each one - every armed browser counts itself down on the
// true time (see launch/clock.js) and navigates itself, plus any spare
// windows it opened, to the ticket URL at the moment. Settings are per
// browser (localStorage, see launch/config.js) with a launch link to copy
// them from one browser to the next.
//
// Things that bite, and what's done about them:
//   - Popup blockers: a window opened by a timer is blocked, one opened by a
//     click is not. So spare windows are opened by a click NOW (as blank
//     holding pages we keep a handle to) and merely navigated at the moment.
//     One click, one window - browsers allow one popup per click.
//   - Background-tab throttling: Chrome slows a hidden tab's timers to once a
//     minute after five minutes. The scheduler runs a second ticker in a Web
//     Worker (not throttled that way), and the page asks for a screen wake
//     lock and nags the user to keep the window visible.
//   - Clock drift: re-synced every minute while armed, and once more shortly
//     before the moment; the scheduler reads the live offset on every tick.
//   - Navigating away: that's the whole point, but it happens only once
//     armed and only at the moment; a reload disarms (arming needs a click).

const RESYNC_EVERY_MS = 60000;
const FINAL_SYNC_BEFORE_MS = 12000;
const CLOCK_SAMPLES = 8;

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

const signedMs = (ms) => `${ms >= 0 ? '+' : '-'}${Math.abs(ms).toFixed(1)} ms`;

// The holding page written into each spare window so the user can see what
// it is and doesn't close it by mistake.
const holdingPageHtml = (title, when) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;background:#1b5e20;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:1.6em;margin:0 0 .4em}p{margin:.3em 0;font-size:1.1em}</style></head>
<body><div><h1>Bus Wankers spare window</h1><p>Armed - this window will jump to the ticket page at</p><p><strong>${when}</strong></p><p>Leave it open. Don't refresh it.</p></div></body></html>`;

const LaunchSection = ({ year }) => {
  const [{ config: initialConfig, imported }] = useState(() => loadConfig());
  const [config, setConfig] = useState(initialConfig);
  const [sync, setSync] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | ready | error
  const [syncError, setSyncError] = useState('');
  const [armed, setArmed] = useState(false);
  const [fired, setFired] = useState(null); // { via, lateMs }
  const [notice, setNotice] = useState(imported ? 'Settings taken from the launch link and saved in this browser.' : '');
  const [spareCount, setSpareCount] = useState(0);
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  const syncRef = useRef(null);
  const sparesRef = useRef([]);
  const wakeLockRef = useRef(null);
  const cancelRef = useRef(null);

  const targetMs = londonWallToEpoch(config.saleAt);
  const urlOk = isHttpUrl(config.url);
  const nowMs = correctedNow(syncRef.current);
  const remainingMs = targetMs != null ? targetMs - config.leadMs - nowMs : null;
  const targetInFuture = remainingMs != null && remainingMs > 0;

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
      // Drop handles to spare windows the user has closed.
      const open = sparesRef.current.filter((w) => w && !w.closed);
      if (open.length !== sparesRef.current.length) {
        sparesRef.current = open;
        setSpareCount(open.length);
      }
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

  // ---- arming -------------------------------------------------------------

  const navigateEverything = useCallback((via, lateMs) => {
    const url = config.url;
    console.debug(`[launch] FIRING via ${via}, ${lateMs.toFixed(1)} ms after the moment -> ${url}`);
    setFired({ via, lateMs });
    for (const w of sparesRef.current) {
      try {
        if (w && !w.closed) w.location.href = url;
      } catch (err) {
        console.debug('[launch] spare window navigation failed:', err && err.message);
      }
    }
    releaseWakeLock();
    window.location.href = url;
  }, [config.url, releaseWakeLock]);

  useEffect(() => {
    if (!armed || targetMs == null) return undefined;

    const cancelSchedule = scheduleAt(
      targetMs,
      () => correctedNow(syncRef.current),
      navigateEverything,
      { leadMs: config.leadMs },
    );
    cancelRef.current = cancelSchedule;

    // Keep the offset fresh: every minute, and one last time just before.
    const resync = setInterval(() => {
      const left = targetMs - correctedNow(syncRef.current);
      if (left > FINAL_SYNC_BEFORE_MS + 5000) runSync();
    }, RESYNC_EVERY_MS);
    const finalDelay = targetMs - correctedNow(syncRef.current) - FINAL_SYNC_BEFORE_MS;
    const finalSync = finalDelay > 2000 ? setTimeout(runSync, finalDelay) : null;

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelSchedule();
      cancelRef.current = null;
      clearInterval(resync);
      if (finalSync) clearTimeout(finalSync);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [armed, targetMs, config.leadMs, navigateEverything, runSync]);

  const arm = () => {
    if (!urlOk) {
      setNotice('The ticket URL needs to be a full http(s) address.');
      return;
    }
    if (targetMs == null) {
      setNotice('Set the sale time first.');
      return;
    }
    if (!targetInFuture) {
      setNotice('That sale time has already passed.');
      return;
    }
    setFired(null);
    setNotice('');
    setArmed(true);
    acquireWakeLock();
    console.debug(`[launch] armed for ${formatLondon(targetMs)} (lead ${config.leadMs} ms), ${sparesRef.current.length} spare window(s)`);
  };

  const disarm = () => {
    setArmed(false);
    releaseWakeLock();
    setNotice('Disarmed. Spare windows are still open.');
    console.debug('[launch] disarmed');
  };

  const openSpare = () => {
    let w = null;
    try {
      w = window.open('', '_blank');
    } catch (err) {
      console.debug('[launch] window.open threw:', err && err.message);
    }
    if (!w) {
      setNotice('The browser blocked the spare window - allow pop-ups for this site and try again.');
      return;
    }
    try {
      const when = targetMs != null ? formatLondon(targetMs) : 'the sale time';
      w.document.open();
      w.document.write(holdingPageHtml(`Bus Wankers spare window - ${when}`, when));
      w.document.close();
    } catch (err) {
      console.debug('[launch] could not write holding page:', err && err.message);
    }
    sparesRef.current = [...sparesRef.current.filter((x) => x && !x.closed), w];
    setSpareCount(sparesRef.current.length);
    setNotice('');
    // Bring focus back so the next click lands here, not in the spare.
    try {
      window.focus();
    } catch {
      // some browsers refuse; harmless
    }
  };

  const closeSpares = () => {
    for (const w of sparesRef.current) {
      try {
        if (w && !w.closed) w.close();
      } catch {
        // ignore
      }
    }
    sparesRef.current = [];
    setSpareCount(0);
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

  return (
    <section className="launch" aria-label={title}>
      <div className="launch-inner">
        <h2 className="launch-title">{title}</h2>
        <p className="launch-blurb">
          Arm this browser and, at the sale time exactly, it jumps to the ticket page - on true (NTP) time,
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
              {targetMs != null && <span className="launch-field-hint">= {formatLondon(targetMs)}</span>}
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
              <span className="launch-field-hint">0 = exactly on the moment; a few hundred ms early covers page-load time.</span>
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
                  {targetInFuture ? 'until the jump' : 'the sale time has passed'}
                  {config.leadMs ? ` (${config.leadMs > 0 ? `${config.leadMs} ms early` : `${-config.leadMs} ms late`})` : ''}
                </div>
              </div>
            )}

            <div className="launch-spares">
              <button type="button" className="launch-btn launch-btn-secondary" onClick={openSpare} disabled={!urlOk}>
                Open a spare window
              </button>
              <span className="launch-field-hint">
                {spareCount === 0
                  ? 'Optional: extra windows in this browser that jump at the same moment. One click opens one.'
                  : `${spareCount} spare window${spareCount === 1 ? '' : 's'} open and will jump too.`}
              </span>
              {spareCount > 0 && !armed && (
                <button type="button" className="launch-btn launch-btn-link" onClick={closeSpares}>close them</button>
              )}
            </div>

            {!armed ? (
              <button type="button" className="launch-btn launch-btn-arm" onClick={arm} disabled={!urlOk || !targetInFuture}>
                Arm this browser
              </button>
            ) : (
              <button type="button" className="launch-btn launch-btn-disarm" onClick={disarm}>
                Disarm
              </button>
            )}

            {armed && !fired && (
              <div className="launch-armed-box">
                <p><strong>Armed.</strong> This window{spareCount > 0 ? ` and ${spareCount} spare${spareCount === 1 ? '' : 's'}` : ''} will jump to<br />
                  <code>{config.url}</code><br />at {formatLondon(targetMs - config.leadMs)}.</p>
                <ul>
                  <li>Keep this window <strong>on screen</strong> - not minimised, not behind another window.</li>
                  <li>Laptop on mains power; don&rsquo;t let it sleep (a screen wake lock has been requested{navigator.wakeLock ? '' : ', but this browser doesn’t support it'}).</li>
                  <li>Don&rsquo;t reload this tab - that disarms it.</li>
                </ul>
              </div>
            )}
            {fired && (
              <p className="launch-fired">
                Jumped via {fired.via}, {fired.lateMs.toFixed(0)} ms after the moment. If you&rsquo;re still reading this the ticket page hasn&rsquo;t loaded yet.
              </p>
            )}
          </div>
        </div>

        <details className="launch-how">
          <summary>How to use this on sale day</summary>
          <ol>
            <li>Fill in the settings above (once), then <em>Copy launch link</em>.</li>
            <li>Open each other browser on this computer, paste the link into its address bar and press Enter. Its settings fill in automatically. Do the same on every other computer, phone and tablet you have to hand.</li>
            <li>In each browser, check the clock card says it&rsquo;s synced with NTP, open any spare windows you want, then press <em>Arm this browser</em>.</li>
            <li>Arrange the windows so every armed one is visible, and leave them alone. At the moment they all jump to the ticket page.</li>
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
