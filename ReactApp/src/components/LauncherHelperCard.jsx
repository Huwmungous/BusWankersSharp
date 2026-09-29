import React, { useEffect, useState } from 'react';
import { useIsStandalone } from '../displayMode';
import {
  ANDROID_BROWSERS,
  androidIntentUrl,
  buildHelperCommand,
  detectPlatform,
  downloadsFor,
  helperDownloadUrl,
  looksLikeDownload,
} from '../launch/helperCommand';
import './LaunchSection.css';

// The part of the Launcher tab that opens REAL browsers.
//
// The Arm button above sends a window of THIS browser to the ticket page, which is
// all a web page can do - and inside the installed app it is not even a browser,
// just another window of the app. A page cannot start Chrome, Firefox or Edge. So
// for a computer this card hands over a small helper program to run (see
// LauncherHelper/ in the repo): it keeps NTP time itself and, at the sale time,
// opens the ticket page in every browser installed on that computer.
//
// Android is different: a page there can open another browser app, but only from a
// tap - Chrome refuses it from a timer - so those are buttons to press at the moment.
// iPhones and iPads allow neither.
//
// Nothing here polls. The one network call is a single check, when the card first
// shows, that the helper downloads really exist on this server.

const detectFromBrowser = () => {
  try {
    return detectPlatform(window.navigator.userAgent);
  } catch {
    return 'other';
  }
};

// A read-only command with a Copy button. A failed copy says so in the card - no toast.
const CopyBox = ({ label, value, hint }) => {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      console.debug('[launch] helper command copied', { label });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setFailed(true);
      console.debug('[launch] helper command copy failed:', err && err.message);
    }
  };

  return (
    <div className="launch-copybox">
      <div className="launch-copybox-label">{label}</div>
      <div className="launch-link-row">
        <input
          className="launch-link"
          type="text"
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          aria-label={label}
        />
        <button type="button" className="launch-btn launch-btn-secondary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {hint && <span className="launch-field-hint">{hint}</span>}
      {failed && <span className="launch-field-error">Copy failed - select the command and copy it by hand.</span>}
    </div>
  );
};

const LauncherHelperCard = ({ config }) => {
  const standalone = useIsStandalone();
  const [platform] = useState(detectFromBrowser);
  // file name -> true (there), false (missing), absent (not checked yet / couldn't tell).
  const [availability, setAvailability] = useState({});

  const desktop = platform === 'windows' || platform === 'mac' || platform === 'linux';
  const phone = platform === 'android' || platform === 'ios';
  const downloads = downloadsFor(platform);

  useEffect(() => {
    if (phone) return undefined;
    let cancelled = false;

    Promise.all(downloadsFor(platform).map(async (d) => {
      try {
        const response = await fetch(helperDownloadUrl(d.file), { method: 'HEAD' });
        const there = looksLikeDownload(response);
        console.debug('[launch] helper download check', { file: d.file, status: response.status, there });
        return [d.file, there];
      } catch (err) {
        // Couldn't tell (offline, say) - leave the link usable rather than hiding it.
        console.debug('[launch] helper download check failed:', d.file, err && err.message);
        return [d.file, null];
      }
    })).then((entries) => {
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [platform, phone]);

  const missing = downloads.length > 0 && downloads.every((d) => availability[d.file] === false);
  const command = desktop ? buildHelperCommand(config, platform) : null;
  const rehearsal = desktop ? buildHelperCommand(config, platform, { rehearse: true }) : null;

  // Logged when something about it changes - not on every render, which the parent
  // forces several times a second while the countdown ticks.
  useEffect(() => {
    console.debug('[launch] helper card', { platform, standalone, desktop, missing });
  }, [platform, standalone, desktop, missing]);

  return (
    <div className="launch-card launch-helper">
      <h3 className="launch-card-title">4. Open real browsers</h3>

      {standalone && (
        <p className="launch-notice">
          <strong>You&rsquo;re using the installed app.</strong> Its launch window opens inside the app itself &ndash; not in Chrome,
          Firefox or Edge &ndash; and a web page has no way to start those. {desktop
            ? 'The helper below does: it opens the ticket page in every browser on this computer.'
            : 'On a computer, download the helper from this page there.'}
        </p>
      )}

      {desktop && (
        <>
          <p className="launch-blurb">
            A small program you run on this computer. At the sale time &ndash; on true (NTP) time &ndash; it opens the ticket
            page in <strong>every browser installed here</strong> (Chrome, Edge, Firefox, Brave, Opera, Vivaldi
            {platform === 'mac' ? ', Safari' : ''}), each a separate place in the queue. It starts them about 45 seconds early
            so the real jump is a quick hand-off, and gives each a small random delay so they don&rsquo;t all arrive together.
          </p>

          <ol className="launch-helper-steps">
            <li>
              <strong>Download</strong> the helper for {platform === 'mac' ? 'your Mac' : 'this computer'} and unzip it.
              <div className="launch-helper-buttons">
                {downloads.map((d) => (
                  <a
                    key={d.id}
                    className="launch-btn"
                    href={helperDownloadUrl(d.file)}
                    download
                    onClick={() => console.debug('[launch] helper download clicked', { file: d.file })}
                  >
                    Download for {d.label}
                  </a>
                ))}
              </div>
              {platform === 'mac' && (
                <span className="launch-field-hint">
                  Not sure which? Apple menu &rarr; About This Mac: a &ldquo;Chip&rdquo; line (M1, M2&hellip;) means Apple silicon;
                  &ldquo;Processor&rdquo; means Intel.
                </span>
              )}
              {missing && (
                <span className="launch-field-error">
                  The helper hasn&rsquo;t been published on this server yet &ndash; tell Hugh.
                </span>
              )}
              <details className="launch-helper-others">
                <summary>Another kind of computer?</summary>
                <div className="launch-helper-buttons">
                  {downloadsFor('other').filter((d) => !downloads.includes(d)).map((d) => (
                    <a key={d.id} className="launch-btn launch-btn-secondary" href={helperDownloadUrl(d.file)} download>
                      {d.label}
                    </a>
                  ))}
                </div>
              </details>
            </li>

            <li>
              <strong>Open a terminal in that folder</strong>{' '}
              {platform === 'windows'
                ? '(in File Explorer click the address bar, type cmd and press Enter).'
                : '(and, first time only, make it runnable - the README in the zip has the two commands).'}
            </li>

            <li>
              <strong>Rehearse once</strong> and accept any cookie banner the ticket site shows in each browser:
              {rehearsal && (
                <CopyBox label="Rehearsal command" value={rehearsal} hint="Opens the ticket page in every browser 30 seconds from now." />
              )}
            </li>

            <li>
              <strong>On the day</strong>, start it well before the sale and leave its window open:
              {command ? (
                <CopyBox
                  label="Sale-day command"
                  value={command}
                  hint="Built from your settings above (URL, sale time, jump early, stagger)."
                />
              ) : (
                <span className="launch-field-hint">Set the sale time in the settings above and the command appears here.</span>
              )}
            </li>
          </ol>
        </>
      )}

      {platform === 'android' && (
        <>
          <p className="launch-blurb">
            Android won&rsquo;t let a page open another app on a timer &ndash; only when you tap. So at the sale time, tap
            each browser below in turn. Each opens the ticket page in that app (the ones you haven&rsquo;t installed simply
            open it in the browser you&rsquo;re using now).
          </p>
          <div className="launch-helper-buttons">
            {ANDROID_BROWSERS.map((b) => {
              const href = androidIntentUrl(config.url, b.packageName);
              return href ? (
                <a
                  key={b.id}
                  className="launch-btn launch-btn-secondary"
                  href={href}
                  onClick={() => console.debug('[launch] android browser tapped', { browser: b.id })}
                >
                  Open in {b.label}
                </a>
              ) : null;
            })}
          </div>
          <p className="launch-nb">
            <strong>NB:</strong> Try these during the rehearsal too &ndash; Android asks once whether it may open each app.
            For fully timed launching on the day, use a computer.
          </p>
        </>
      )}

      {platform === 'ios' && (
        <p className="launch-blurb">
          iPhones and iPads don&rsquo;t let a page start another browser. Open this page in each browser you have
          (Safari, Chrome, Firefox&hellip;) and arm it there. For timed launching in several browsers, use a computer.
        </p>
      )}

      {platform === 'other' && (
        <p className="launch-blurb">
          This device isn&rsquo;t one the helper runs on (Windows, Mac and Linux computers are). Open this page in each browser you
          have and arm it there.
        </p>
      )}
    </div>
  );
};

// Memoised: the Launcher tab re-renders every 50-250 ms for its clock and countdown,
// and this card only depends on the settings, which change when someone edits them.
export default React.memo(LauncherHelperCard);
