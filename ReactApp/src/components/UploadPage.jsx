import React, { useState } from 'react';
import './UploadPage.css';

// Sibling path to the frontend's own base (PUBLIC_URL=/buswankers) - proxied by
// holly's nginx to the UploaderService backend running on queeg. See
// ops/nginx/buswankers-api.inc. Fixed from the domain root rather than built off
// PUBLIC_URL, since this API isn't served under /buswankers/ itself.
const API_BASE = '/buswankers-api/api/autofill';

async function readErrorMessage(response, fallback) {
  try {
    const body = await response.json();
    if (body && body.error) return body.error;
  } catch {
    // response wasn't JSON - fall back to the generic message
  }
  return fallback;
}

const UploadPage = () => {
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

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

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
    <div className="upload-page">
      <div className="container">
        <h1>Generate an Autofill File</h1>
        <h2>Upload a registration spreadsheet, pick a sale, get back the autofill file</h2>

        <form onSubmit={handleCheck}>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="file">Spreadsheet (.xlsx or .xls)</label>
            <input
              id="file"
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
          Every sheet in the workbook is treated as a sale, except "Starting Lineup" and
          "URL" - checking the spreadsheet lists whichever sheets this particular file
          actually has. Registrants are grouped by the letter in their "Group" column;
          a sheet with no letters yet falls back to groups of 6 from the top. The
          downloaded file still needs to be added to <code>ReactApp/public/</code> and
          redeployed before it's live on the Documentation page.
        </h4>
      </div>
    </div>
  );
};

export default UploadPage;
