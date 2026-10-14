import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimRegistration,
  clearRegistrations,
  fetchNextRegistration,
  openRegistrations,
} from '../api/registrationsApi';
import { copyWhenReady } from '../clipboard';
import { getLog, asError } from '../log';
import './RegistrationsSection.css';

// Created when used, never at module load (see ../log.js). Declared above the
// component and every callback that calls it, so it is initialised first.
const sectionLog = (attributes) => getLog('RegistrationsSection', attributes);

// Shown (exactly this wording) once every registration in the pool has been
// allocated. Exported for the tests.
export const ALL_ALLOCATED_MESSAGE = 'All Registrations have been allocated';

export const NOT_LOADED_MESSAGE = 'No registrations have been loaded yet.';

// Registrations remain, but every one of them is being held by somebody else
// who has the tab open; their holds lapse if they wander off.
export const HELD_BY_OTHERS_MESSAGE =
  'The registrations that are left are being held by other people just now. Try again in a few minutes.';

const FIELDS = {
  reg: { label: 'Registration number', pick: (entry) => entry.regNumber },
  post: { label: 'Postcode', pick: (entry) => entry.postCode },
};

const NO_STATE = { loaded: false, total: 0, remaining: 0, allAllocated: false, heldByOthers: false, entry: null };

// One value with its Copy button. The value is plain selectable text, so if
// the browser refuses the clipboard the person can still copy it by hand.
const FieldRow = ({ id, label, value, copied, disabled, onCopy }) => (
  <div className="registrations-field">
    <span className="registrations-field-label" id={`registrations-${id}-label`}>{label}</span>
    <code className="registrations-field-value" aria-labelledby={`registrations-${id}-label`}>{value}</code>
    <button
      type="button"
      className={`registrations-copy${copied ? ' registrations-copy-copied' : ''}`}
      onClick={onCopy}
      disabled={disabled}
      aria-label={`Copy the ${label.toLowerCase()}`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  </div>
);

// The Registrations tab. Shows one (registration number, postcode) pair from
// the compiled spreadsheet at a time, each with a Copy button.
//
// Opening the tab HOLDS the first available pair for this browser, so nobody
// else is shown it meanwhile (the hold lapses if the person wanders off).
// Copying either value TAKES the pair for good - it is never offered to anyone
// else. Next lets go of the held pair and holds the next one, taking nothing.
// When none is left it says "All Registrations have been allocated".
//
// The server is the only judge of who holds what, so Copy asks it first and
// only copies if it says yes - if the pair has gone to someone else, nothing
// is copied and the next available pair is shown instead. No polling: the
// page only talks to the server when the person does something.
//
// `active` is whether this tab is the one showing. Every tab body stays
// mounted (just hidden), so without it the pair would be held for everyone the
// moment the page loaded, whichever tab they were on: nothing is requested
// until the tab is actually opened. reloadKey changes when an uploader loads a
// new spreadsheet, so the tab re-reads rather than showing the old pool.
const RegistrationsSection = ({ active = true, reloadKey = 0, canClearAll = false }) => {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState(NO_STATE);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'info' | 'error', text }
  const [copiedField, setCopiedField] = useState(null); // 'reg' | 'post' | null
  const copiedTimer = useRef(null);
  // A ref, not state: it only steers whether a re-open shows "Loading…" (it
  // doesn't once there is something on screen) and must be readable in load
  // without making it re-create.
  const hasLoadedRef = useRef(false);

  // Declared before the callbacks that call it, so it is initialised first.
  const showCopied = useCallback((field) => {
    setCopiedField(field);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedField(null), 2000);
  }, []);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // Opens the tab on the server: holds (or keeps holding) a pair for this browser.
  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setStatus('loading');
    setNotice(null);
    setCopiedField(null);
    try {
      const state = await openRegistrations();
      sectionLog({ total: state.total, remaining: state.remaining, hasEntry: !!state.entry }).debug('Registrations tab opened');
      hasLoadedRef.current = true;
      setView(state);
      setStatus('ready');
      setLoadError('');
    } catch (err) {
      sectionLog({ reason: err && err.message }).error('Registrations tab could not load', asError(err));
      setStatus('error');
      setLoadError((err && err.message) || 'Could not reach the upload service.');
    }
  }, []);

  // Opened (and re-opened each time the person comes back to it, which keeps
  // their hold alive or finds them a new pair if it lapsed) only while showing.
  useEffect(() => {
    if (active) load();
  }, [active, load, reloadKey]);

  const onNext = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setCopiedField(null);
    try {
      const state = await fetchNextRegistration(view.entry ? view.entry.regNumber : null);
      sectionLog({ remaining: state.remaining, hasEntry: !!state.entry }).debug('Moved on to the next registration');
      setView(state);
    } catch (err) {
      sectionLog({ reason: err && err.message }).warn('Next registration failed', asError(err));
      setNotice({ kind: 'error', text: (err && err.message) || 'Could not reach the upload service.' });
    } finally {
      setBusy(false);
    }
  }, [busy, view.entry]);

  const onCopy = useCallback(async (field) => {
    const entry = view.entry;
    if (!entry || busy) return;

    setBusy(true);
    setNotice(null);

    // Ask the server first, but keep the clipboard write inside this click
    // (see copyWhenReady): the claim's answer decides what, if anything, is copied.
    let claim = null;
    const textPromise = claimRegistration(entry.regNumber).then((result) => {
      claim = result;
      return result.claimed ? FIELDS[field].pick(entry) : null;
    });

    try {
      const { copied } = await copyWhenReady(textPromise);
      sectionLog({ field, claimed: claim.claimed, reason: claim.reason, copied }).info('Copy pressed');
      setView(claim.state);

      if (!claim.claimed) {
        setCopiedField(null);
        setNotice({
          kind: 'info',
          text: claim.state.entry
            ? 'That registration is no longer available to you, so nothing was copied. Here is the next one.'
            : 'That registration is no longer available to you, so nothing was copied.',
        });
      } else if (copied) {
        showCopied(field);
      } else {
        setCopiedField(null);
        setNotice({
          kind: 'error',
          text: 'This registration is now reserved for you, but your browser would not let us copy it. Select the value and copy it by hand.',
        });
      }
    } catch (err) {
      sectionLog({ field, reason: err && err.message }).warn('Copy failed', asError(err));
      setNotice({ kind: 'error', text: (err && err.message) || 'Could not reach the upload service.' });
    } finally {
      setBusy(false);
    }
  }, [busy, view.entry, showCopied]);

  // Clear all (only offered to CampDad, and refused by the server for anyone
  // else): asks twice - the first press only asks "are you sure?" - then makes
  // every registration available again and re-opens the tab for a fresh pair.
  const onClearAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setConfirmingClear(false);
    setNotice(null);
    try {
      const { cleared } = await clearRegistrations();
      sectionLog({ cleared }).info('All registrations cleared');
      await load();
      setNotice({
        kind: 'info',
        text: `Cleared: ${cleared} taken ${cleared === 1 ? 'registration was' : 'registrations were'} released. Every registration is available again.`,
      });
    } catch (err) {
      sectionLog({ reason: err && err.message }).warn('Clear all failed', asError(err));
      setNotice({ kind: 'error', text: (err && err.message) || 'Could not reach the upload service.' });
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  const { entry } = view;

  return (
    <section className="registrations-section" aria-label="Registrations">
      <div className="container">
        <h1>Registrations</h1>
        <p className="registrations-intro">
          Each registration number and postcode below is for one person only. The pair shown is being held for
          you while you are here. Pressing <strong>Copy</strong> on either one takes it for good, and nobody
          else will ever be given it. <strong>Next</strong> lets go of this pair, without taking it, and holds
          another for you.
        </p>

        {status === 'loading' && <p className="registrations-note">Loading…</p>}

        {status === 'error' && (
          <div className="registrations-note registrations-error" role="alert">
            <p>{loadError}</p>
            <button type="button" className="registrations-next" onClick={load}>Try again</button>
          </div>
        )}

        {status === 'ready' && !view.loaded && (
          <p className="registrations-note">{NOT_LOADED_MESSAGE}</p>
        )}

        {status === 'ready' && view.loaded && (
          <>
            {view.allAllocated && (
              <p className="registrations-done" role="status">{ALL_ALLOCATED_MESSAGE}</p>
            )}

            {view.heldByOthers && (
              <p className="registrations-note" role="status">{HELD_BY_OTHERS_MESSAGE}</p>
            )}

            {entry && (
              <div className="registrations-card">
                <div className="registrations-card-head">
                  {entry.mine
                    ? <span className="registrations-badge registrations-badge-mine">Reserved for you</span>
                    : <span className="registrations-badge">Held for you - copying either value keeps it for good</span>}
                </div>
                {Object.entries(FIELDS).map(([id, field]) => (
                  <FieldRow
                    key={id}
                    id={id}
                    label={field.label}
                    value={field.pick(entry)}
                    copied={copiedField === id}
                    disabled={busy}
                    onCopy={() => onCopy(id)}
                  />
                ))}
              </div>
            )}

            <div className="registrations-actions">
              <button
                type="button"
                className="registrations-next"
                onClick={onNext}
                disabled={busy || view.remaining === 0}
              >
                Next
              </button>
              <span className="registrations-count">
                {view.remaining} of {view.total} still available
              </span>
            </div>
          </>
        )}

        {canClearAll && status === 'ready' && view.loaded && (
          <div className="registrations-clear">
            {!confirmingClear ? (
              <button
                type="button"
                className="registrations-clear-button"
                onClick={() => setConfirmingClear(true)}
                disabled={busy}
              >
                Clear all
              </button>
            ) : (
              <div role="alert" className="registrations-clear-confirm">
                <span>Make every registration available again, including the ones already taken?</span>
                <button type="button" className="registrations-clear-button" onClick={onClearAll} disabled={busy}>
                  Yes, clear all
                </button>
                <button type="button" className="registrations-next" onClick={() => setConfirmingClear(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {notice && (
          <p
            className={`registrations-notice registrations-notice-${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}
      </div>
    </section>
  );
};

export default RegistrationsSection;
