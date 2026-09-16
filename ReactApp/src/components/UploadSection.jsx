import React, { useState } from 'react';
import { API_BASE, readErrorMessage, saveBlob } from '../api/autofillApi';
import './UploadSection.css';

// One-off "generate and download" - reads one sheet from a spreadsheet and hands
// the resulting file straight back, WITHOUT touching the live autofill files.
// To update those (what the dropdown at the top of the page offers, and what
// the Remote Import URL serves), use the upload bar at the top instead.
const UploadSection = () => {
  const [password, setPassword] = useState('');
  const [file, setFile] = useState(null);

  // Every sheet in the uploaded workbook is a sale (except Starting Lineup/URL),
  // so the list of sales isn't known until the file's been checked against the
  // backend - there's no fixed dropdown to show up front.
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');

  const [checkStatus, setCheckStatus] = useState('idle'); // idle | checking | error
  const [checkMessage, setCheckMessage] = useState('');

  const [genStatus, setGenStatus] = useState('idle'); // idle | working | error | done
  const [genMessage, setGenMessage] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null);
    // A new file means the previous file's sale list no longer applies.
    setSheets([]);
    setSelectedSheet('');
    setCheckStatus('idle');
    setCheckMessage('');
    setGenStatus('idle');
    setGenMessage('');
  };

  const handleCheck = async (e) => {
    e.preventDefault();
    if (!file) {
      setCheckStatus('error');
      setCheckMessage('Choose a spreadsheet (.xlsx or .xls) first.');
      return;
    }

    setCheckStatus('checking');
    setCheckMessage('');
    setSheets([]);
    setSelectedSheet('');

    const form = new FormData();
    form.append('file', file);
    form.append('password', password);

    try {
      const response = await fetch(`${API_BASE}/sheets`, { method: 'POST', body: form });

      if (!response.ok) {
        setCheckStatus('error');
        setCheckMessage(await readErrorMessage(response, `Request failed (${response.status}).`));
        return;
      }

      const body = await response.json();
      setSheets(body.sheets || []);
      setSelectedSheet((body.sheets && body.sheets[0]) || '');
      setCheckStatus('idle');
    } catch (err) {
      setCheckStatus('error');
      setCheckMessage(`Could not reach the upload service: ${err.message}`);
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!file || !selectedSheet) return;

    setGenStatus('working');
    setGenMessage('');

    const form = new FormData();
    form.append('file', file);
    form.append('sheetName', selectedSheet);
    form.append('password', password);

    try {
      const response = await fetch(`${API_BASE}/generate`, { method: 'POST', body: form });

      if (!response.ok) {
        setGenStatus('error');
        setGenMessage(await readErrorMessage(response, `Request failed (${response.status}).`));
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match ? match[1] : `${selectedSheet}_autofill.csv`;
      const groupCount = response.headers.get('X-Group-Count');

      saveBlob(blob, filename);

      setGenStatus('done');
      setGenMessage(
        `Downloaded ${filename}` + (groupCount ? ` (${groupCount} group${groupCount === '1' ? '' : 's'}).` : '.')
      );
    } catch (err) {
      setGenStatus('error');
      setGenMessage(`Could not reach the upload service: ${err.message}`);
    }
  };

  return (
    <section className="upload-section" id="upload-section" aria-label="Generate an autofill file from a spreadsheet">
      <div className="container">
        <h2>Generate a One-off Autofill File</h2>
        <h3>Upload a registration spreadsheet, pick a sale, get back the autofill file - without changing the live files</h3>

        <form onSubmit={handleCheck}>
          <div className="form-group">
            <label htmlFor="upload-password">Password</label>
            <input
              id="upload-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="upload-file">Spreadsheet (.xlsx or .xls)</label>
            <input
              id="upload-file"
              type="file"
              className="form-input"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              required
            />
          </div>

          <button type="submit" className="submit-button" disabled={checkStatus === 'checking'}>
            {checkStatus === 'checking' ? 'Checking…' : 'Check Spreadsheet'}
          </button>
        </form>

        {checkStatus === 'error' && <p className="upload-status upload-error">{checkMessage}</p>}

        {sheets.length > 0 && (
          <form onSubmit={handleGenerate} className="sale-form">
            <div className="form-group">
              <label htmlFor="sheetName">Sale</label>
              <select
                id="sheetName"
                className="form-input"
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
              >
                {sheets.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <button type="submit" className="submit-button" disabled={genStatus === 'working'}>
              {genStatus === 'working' ? 'Generating…' : 'Generate & Download'}
            </button>
          </form>
        )}

        {genStatus === 'error' && <p className="upload-status upload-error">{genMessage}</p>}
        {genStatus === 'done' && <p className="upload-status upload-success">{genMessage}</p>}

        <h4 className="upload-note">
          Every sheet whose first row has "Group", "Reg Number" and "Postcode" headings is
          treated as a sale (the master roster and the URL tab don't, so they're skipped) -
          checking the spreadsheet lists whichever sheets this particular file actually
          has. Registrants are grouped by the letter in their "Group" column;
          a sheet with no letters yet falls back to groups of 6 from the top. The
          downloaded file is yours to keep - it does <em>not</em> replace the live
          autofill file for that sale. To do that, use the upload bar at the{' '}
          <a href="#ingest-bar">top of the page</a>, which ingests every sale sheet
          in the workbook at once.
        </h4>
      </div>
    </section>
  );
};

export default UploadSection;
