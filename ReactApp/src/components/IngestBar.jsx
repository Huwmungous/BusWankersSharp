import React, { useRef, useState } from 'react';
import { getLog, asError } from '../log';
import { ingestWorkbook } from '../api/autofillApi';
import './IngestBar.css';

// Created when used, not at module load - see ../log.js.
const barLog = (attributes) => getLog('IngestBar', attributes);

// The roster outcome of an ingest rendered as one more row in the per-sheet
// list, so the person uploading sees it alongside the sales it was read with.
// Module-level (not inside the component) so it's initialised before any
// handler that calls it - no temporal-dead-zone risk.
const rosterAsResult = (ro) => ({
  sheet: ro.sheet || 'Glasto nnnn (roster)',
  filename: 'running_order.json',
  status: ro.status,
  groups: 0,
  people: ro.people,
  cleared: ro.cleared,
  error: ro.error,
  isRoster: true,
});

// The upload button at the very top of the page. Pick a registration
// workbook and every sale sheet in it is ingested into the live autofill files
// in one go (an emptied sale sheet removes its file), and the roster sheet
// becomes the running order - the other tabs refresh themselves off the result
// via onIngested. There is no password field any more (2026-09-29): the whole
// page sits behind a Keycloak sign-in, and the API checks the access token that
// sign-in produced. (The old one-off generate-and-download form was dropped
// from the page on 2026-09-16; the backend's /sheets and /generate routes still
// exist if it's ever wanted.)
const IngestBar = ({ onIngested }) => {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');
  const [results, setResults] = useState([]);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const chosen = e.target.files[0] || null;
    barLog({ fileName: chosen && chosen.name, fileBytes: chosen && chosen.size }).debug('Spreadsheet chosen');
    setFile(chosen);
    setStatus('idle');
    setMessage('');
    setResults([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      barLog().debug('Submit with no spreadsheet chosen');
      setStatus('error');
      setMessage('Choose a spreadsheet (.xlsx or .xls) first.');
      return;
    }

    barLog({ fileName: file.name, fileBytes: file.size }).info('Upload and ingest submitted');
    setStatus('working');
    setMessage('');
    setResults([]);

    try {
      const { results: outcome, runningOrder } = await ingestWorkbook(file);
      const okCount = outcome.filter((r) => r.status === 'ok').length;
      const clearedCount = outcome.filter((r) => r.status === 'empty' && r.cleared).length;
      const emptyCount = outcome.filter((r) => r.status === 'empty' && !r.cleared).length;
      const failCount = outcome.filter((r) => r.status === 'failed').length;
      const rosterFailed = runningOrder && runningOrder.status === 'failed';

      const parts = [];
      if (okCount) parts.push(`ingested ${okCount} sale${okCount === 1 ? '' : 's'}`);
      if (clearedCount) parts.push(`cleared ${clearedCount} emptied sale${clearedCount === 1 ? '' : 's'}`);
      if (emptyCount) parts.push(`${emptyCount} empty (nothing to clear)`);
      if (failCount) parts.push(`${failCount} failed - see below`);
      if (runningOrder) {
        if (runningOrder.status === 'ok') parts.push(`running order for ${runningOrder.year} (${runningOrder.people} people)`);
        else if (runningOrder.status === 'empty') parts.push(runningOrder.cleared ? 'running order cleared' : 'roster sheet empty');
        else if (runningOrder.status === 'failed') parts.push('running order failed - see below');
      }

      barLog({ okCount, clearedCount, emptyCount, failCount, rosterStatus: runningOrder ? runningOrder.status : 'none' })
        .info('Ingest finished');

      setResults(runningOrder ? [...outcome, rosterAsResult(runningOrder)] : outcome);
      setStatus(failCount === 0 && !rosterFailed ? 'done' : 'error');
      setMessage(`${file.name}: ${parts.join(', ')}.`);

      // A fresh pick is a fresh run - clear the chosen file so the same
      // workbook can't be re-sent by accident with a stale selection.
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (onIngested) onIngested(outcome);
    } catch (err) {
      barLog({ reason: err && err.message, sheetResults: Array.isArray(err && err.results) ? err.results.length : 0 })
        .warn('Ingest failed', asError(err));
      setStatus('error');
      setMessage(err.message || 'Could not reach the upload service.');
      // "No sheet could be ingested" comes with the per-sheet reasons - show them.
      if (Array.isArray(err.results) && err.results.length > 0) setResults(err.results);
    }
  };

  // Lead Booker warnings (2026-09-18, see SheetRegistrationReader.ReadGroups
  // on the backend): non-fatal issues on an otherwise-successful sheet - a
  // group with nobody marked red, more than one person marked, or (for a
  // .xls upload) colour couldn't be read at all. Shown in amber, distinct
  // from both a clean success and an actual failure, so they're noticeable
  // without looking like something broke.
  const resultClass = (r) =>
    r.status === 'ok' ? (r.warnings && r.warnings.length > 0 ? 'ingest-result-warn' : 'ingest-result-ok')
      : r.status === 'empty' || r.status === 'skipped' ? 'ingest-result-empty'
        : 'ingest-result-fail';

  const resultDetail = (r) => {
    if (r.isRoster) {
      if (r.status === 'ok') return ` (${r.people} ${r.people === 1 ? 'person' : 'people'}, in surname order)`;
      if (r.status === 'empty') return r.cleared ? ' - roster sheet is empty; the stored running order has been removed' : ' - roster sheet is empty; nothing was stored to clear';
      return ` - ${r.error}`;
    }
    if (r.status === 'ok') return ` (${r.groups} group${r.groups === 1 ? '' : 's'})`;
    if (r.status === 'empty') return r.cleared ? ' - empty sheet; the existing file has been removed' : ' - empty sheet; nothing was stored to clear';
    return ` - ${r.error}`;
  };


  return (
    <section className="ingest-bar" id="ingest-bar" aria-label="Upload a spreadsheet to update the autofill files">
      <form className="ingest-form" onSubmit={handleSubmit}>
        <label className="ingest-label" htmlFor="ingest-file">
          Update the autofill files from a registration spreadsheet
        </label>

        <div className="ingest-controls">
          <input
            id="ingest-file"
            ref={fileInputRef}
            type="file"
            className="ingest-input"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            disabled={status === 'working'}
          />
          <button type="submit" className="ingest-button" disabled={status === 'working' || !file}>
            {status === 'working' ? 'Uploading…' : 'Upload & Ingest'}
          </button>
        </div>

        {message && (
          <p className={`ingest-status ${status === 'error' ? 'ingest-error' : 'ingest-success'}`}>{message}</p>
        )}

        {results.length > 0 && (
          <ul className="ingest-results">
            {results.map((r) => (
              <li key={r.isRoster ? `roster:${r.sheet}` : r.sheet} className={resultClass(r)}>
                <strong>{r.sheet}</strong> → <code>{r.filename}</code>
                {resultDetail(r)}
                {Array.isArray(r.warnings) && r.warnings.length > 0 && (
                  <ul className="ingest-result-warnings">
                    {r.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}

          </ul>
        )}
      </form>
    </section>
  );
};

export default IngestBar;
