import React, { useRef, useState } from 'react';
import { ingestWorkbook } from '../api/autofillApi';
import './IngestBar.css';

// The upload button at the very top of the page. Pick a registration
// workbook, give the shared password, and every sale sheet in it is ingested
// into the live autofill files in one go - the dropdown just below refreshes
// itself off the result via onIngested. This is the "publish" path; the
// generate-and-download form at the bottom of the page is the "just give me
// the file" path and leaves the live files alone.
const IngestBar = ({ onIngested }) => {
  const [password, setPassword] = useState('');
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');
  const [results, setResults] = useState([]);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null);
    setStatus('idle');
    setMessage('');
    setResults([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setStatus('error');
      setMessage('Choose a spreadsheet (.xlsx or .xls) first.');
      return;
    }

    setStatus('working');
    setMessage('');
    setResults([]);

    try {
      const outcome = await ingestWorkbook(file, password);
      const okCount = outcome.filter((r) => r.status === 'ok').length;
      const emptyCount = outcome.filter((r) => r.status === 'empty').length;
      const failCount = outcome.filter((r) => r.status === 'failed').length;

      const parts = [];
      if (okCount) parts.push(`ingested ${okCount} sale${okCount === 1 ? '' : 's'}`);
      if (emptyCount) parts.push(`${emptyCount} empty (left as ${emptyCount === 1 ? 'it was' : 'they were'})`);
      if (failCount) parts.push(`${failCount} failed - see below`);

      setResults(outcome);
      setStatus(failCount === 0 ? 'done' : 'error');
      setMessage(`${file.name}: ${parts.join(', ')}.`);

      // A fresh pick is a fresh run - clear the chosen file so the same
      // workbook can't be re-sent by accident with a stale selection.
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (onIngested) onIngested(outcome);
    } catch (err) {
      setStatus('error');
      setMessage(err.message || 'Could not reach the upload service.');
      // "No sheet could be ingested" comes with the per-sheet reasons - show them.
      if (Array.isArray(err.results) && err.results.length > 0) setResults(err.results);
    }
  };

  const resultClass = (r) =>
    r.status === 'ok' ? 'ingest-result-ok' : r.status === 'empty' ? 'ingest-result-empty' : 'ingest-result-fail';

  const resultDetail = (r) => {
    if (r.status === 'ok') return ` (${r.groups} group${r.groups === 1 ? '' : 's'})`;
    if (r.status === 'empty') return ' - empty sheet, nothing to ingest; existing file (if any) left alone';
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
          <input
            id="ingest-password"
            type="password"
            className="ingest-input ingest-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            required
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
              <li key={r.sheet} className={resultClass(r)}>
                <strong>{r.sheet}</strong> → <code>{r.filename}</code>
                {resultDetail(r)}
              </li>
            ))}
          </ul>
        )}
      </form>
    </section>
  );
};

export default IngestBar;
