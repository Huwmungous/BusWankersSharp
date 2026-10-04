import React, { useRef, useState } from 'react';
import { loadRegistrationPool } from '../api/registrationsApi';
import { getLog, asError } from '../log';
import './IngestBar.css';

// Created when used, not at module load - see ../log.js.
const loaderLog = (attributes) => getLog('RegistrationPoolLoader', attributes);

// The summary line for a finished load. Module-level, so it is initialised
// before any handler that calls it. Exported for the tests.
export const describeLoad = (summary) => {
  const parts = [`${summary.total} registrations in the pool`];
  if (summary.added) parts.push(`${summary.added} new`);
  if (summary.stillAllocated) parts.push(`${summary.stillAllocated} already allocated (kept)`);
  if (summary.droppedAllocated) parts.push(`${summary.droppedAllocated} allocated but no longer in the sheet`);
  if (summary.duplicateRows) parts.push(`${summary.duplicateRows} duplicate row${summary.duplicateRows === 1 ? '' : 's'} ignored`);
  if (summary.skippedRows) parts.push(`${summary.skippedRows} row${summary.skippedRows === 1 ? '' : 's'} skipped (no usable reg number or postcode)`);
  return `${parts.join(', ')}.`;
};

// The Update Files tab's second upload: the compiled workbook whose "Unique
// Reg Numbers" sheet feeds the Registrations tab. Reloading is safe - every
// registration already handed out stays handed out. Reuses the upload bar's
// styling. onLoaded lets the Registrations tab re-read the pool.
const RegistrationPoolLoader = ({ onLoaded }) => {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const chosen = e.target.files[0] || null;
    loaderLog({ fileName: chosen && chosen.name, fileBytes: chosen && chosen.size }).debug('Compiled spreadsheet chosen');
    setFile(chosen);
    setStatus('idle');
    setMessage('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setStatus('error');
      setMessage('Choose the compiled spreadsheet (.xlsx or .xls) first.');
      return;
    }

    loaderLog({ fileName: file.name, fileBytes: file.size }).info('Registration pool load submitted');
    setStatus('working');
    setMessage('');

    try {
      const summary = await loadRegistrationPool(file);
      setStatus('done');
      setMessage(`${file.name}: ${describeLoad(summary)}`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (onLoaded) onLoaded(summary);
    } catch (err) {
      loaderLog({ reason: err && err.message }).warn('Registration pool load failed', asError(err));
      setStatus('error');
      setMessage((err && err.message) || 'Could not reach the upload service.');
    }
  };

  return (
    <section className="ingest-bar" aria-label="Load the registrations for the Registrations tab">
      <form className="ingest-form" onSubmit={handleSubmit}>
        <label className="ingest-label" htmlFor="registration-pool-file">
          Load the Registrations tab from the compiled spreadsheet (its &ldquo;Unique Reg Numbers&rdquo; sheet)
        </label>

        <div className="ingest-controls">
          <input
            id="registration-pool-file"
            ref={fileInputRef}
            type="file"
            className="ingest-input"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            disabled={status === 'working'}
          />
          <button type="submit" className="ingest-button" disabled={status === 'working' || !file}>
            {status === 'working' ? 'Loading…' : 'Load registrations'}
          </button>
        </div>

        {message && (
          <p className={`ingest-status ${status === 'error' ? 'ingest-error' : 'ingest-success'}`}>{message}</p>
        )}
      </form>
    </section>
  );
};

export default RegistrationPoolLoader;
