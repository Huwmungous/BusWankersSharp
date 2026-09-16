import React, { useState } from 'react';
import { downloadStoredFile, downloadUrlFor } from '../api/autofillApi';
import { DEFAULT_YEAR } from '../festival';
import './DocumentationSection.css';

const pub = process.env.PUBLIC_URL;

// One entry per autofill file the dropdown can offer. Keyed by the same sale
// name the spreadsheet-upload backend uses for its sheets/GroupSizes (see
// UploaderService/appsettings.json), and each `filename` MUST match what
// UploadServiceController.DownloadNameFor produces for that sheet - that's how
// the dropdown decides whether a sale is populated or "(empty)". Coach and
// General keep the specific dates/cost text that's actually known; the others
// get generic text until Hugh gives us real detail for them.
//
// `heading` is a function of the festival year (which comes from the
// ingested roster sheet, see BusWankersPage) so the page never hardcodes it;
// the dates and costs are deliberately NOT - they're specific and need
// editing by hand each year.
const SALE_INFO = {
  Coach: {
    label: 'Coach Tickets',
    shortLabel: 'Coach + Ticket Package Sale',
    heading: (year) => `This is the ${year} Glastonbury Coach Ticket Autofill File`,
    filename: 'coach_autofill.csv',
    dates: [
      'Registration deadline: 5:00pm BST, Friday 25th September 2026',
      'Coach + ticket package sale: 6:00pm BST, Thursday 1st October 2026',
    ],
    cost: null,
  },
  General: {
    label: 'General Sale',
    shortLabel: 'General Sale',
    heading: (year) => `This is the ${year} Glastonbury General Sale Autofill File`,
    filename: 'general_autofill.csv',
    dates: [
      'Registration deadline: 5:00pm BST, Friday 25th September 2026',
      'General sale (standard tickets): 9:00am BST, Sunday 4th October 2026',
    ],
    cost: [
      "General Admission tickets (valid Wed 23rd – Sun 27th June 2027): £408 (including a £5 booking fee per ticket) plus postage and packing",
      "Deposit is £100 per person — for a 6-person group that's £600 you need in your account on ticket buying day",
    ],
  },
  'Resale - Coach': {
    label: 'Resale - Coach',
    shortLabel: 'Coach Resale',
    heading: (year) => `This is the ${year} Glastonbury Coach Resale Autofill File`,
    filename: 'coach_resale_autofill.csv',
    dates: ['Dates to be confirmed — check with your group organiser before use.'],
    cost: null,
  },
  'Resale - General': {
    label: 'Resale - General',
    shortLabel: 'General Resale',
    heading: (year) => `This is the ${year} Glastonbury General Resale Autofill File`,
    filename: 'general_resale_autofill.csv',
    dates: ['Dates to be confirmed — check with your group organiser before use.'],
    cost: null,
  },
  Demo: {
    label: 'Demo',
    shortLabel: 'Demo Sale',
    heading: (year) => `This is the ${year} Glastonbury Demo Autofill File`,
    filename: 'demo_autofill.csv',
    dates: ['For testing/demonstration only — not a real sale.'],
    cost: null,
  },
};

const formatWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};

// storedFiles: Map of filename -> { filename, size, lastModified } from the
// backend's store (see BusWankersPage). A sale whose filename isn't in it has
// nothing ingested yet - the dropdown says so, and the download button is
// disabled for it. While the store is still loading (or unreachable) nothing
// is known, so every sale is treated as empty rather than guessing.
const DocumentationSection = ({ year = DEFAULT_YEAR, storedFiles = new Map(), storeStatus = 'loading', storeError = '' }) => {
  const [saleType, setSaleType] = useState('Coach');
  const [downloadStatus, setDownloadStatus] = useState('idle'); // idle | working | error
  const [downloadError, setDownloadError] = useState('');

  const info = SALE_INFO[saleType];
  const stored = storedFiles.get(info.filename);
  const isEmpty = !stored || stored.size === 0;
  const remoteImportUrl = `https://longmanrd.net/buswankers/${info.filename}`;

  const handleDownload = async () => {
    if (isEmpty) return;
    setDownloadStatus('working');
    setDownloadError('');
    try {
      await downloadStoredFile(info.filename);
      setDownloadStatus('idle');
    } catch (err) {
      setDownloadStatus('error');
      setDownloadError(err.message || 'Download failed.');
    }
  };

  return (
    <section className="doc-section" aria-label="Autofill file documentation">
      <div className="container">
        <div className="form-group sale-picker">
          <label htmlFor="saleType">Which autofill file do you want?</label>
          <div className="sale-picker-row">
            <select
              id="saleType"
              className="form-input"
              value={saleType}
              onChange={(e) => { setSaleType(e.target.value); setDownloadStatus('idle'); setDownloadError(''); }}
            >
              {Object.entries(SALE_INFO).map(([key, tab]) => {
                const f = storedFiles.get(tab.filename);
                const empty = !f || f.size === 0;
                return (
                  <option key={key} value={key}>
                    {tab.label}{empty ? ' (empty)' : ''}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              className="download-button"
              onClick={handleDownload}
              disabled={isEmpty || downloadStatus === 'working'}
              title={isEmpty ? 'Nothing has been ingested for this sale yet' : `Download ${info.filename}`}
            >
              {downloadStatus === 'working' ? 'Downloading…' : 'Download'}
            </button>
          </div>
          <p className="sale-picker-note">
            {storeStatus === 'loading' && 'Checking which autofill files are available…'}
            {storeStatus === 'error' && `Couldn't check the autofill files: ${storeError}`}
            {storeStatus === 'ready' && isEmpty && 'No autofill file has been ingested for this sale yet - upload a spreadsheet on the Update Files tab.'}
            {storeStatus === 'ready' && !isEmpty && `${info.filename} - last updated ${formatWhen(stored.lastModified)}`}
          </p>
          {downloadStatus === 'error' && <p className="sale-picker-note sale-picker-error">{downloadError}</p>}
        </div>

        <h1>{info.heading(year)}</h1>
        <h2>Use this file to populate your Autofill Options</h2>

        <div className="key-dates">
          <h3>Key Dates for the {year} {info.shortLabel}</h3>
          <ul>
            {info.dates.map((d) => <li key={d}>{d}</li>)}
          </ul>
          {info.cost && (
            <ul className="cost-info">
              {info.cost.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
        </div>

        <div className="image-container">
          <img src={`${pub}/Hippies_1.png`} alt="ImportExport" className="image-with-shadow" />
        </div>

        <h4>In AutoFill Options you will see a band of tabs across the top. You should be on the Sync tab to start.</h4>

        <div className="image-container">
          <img src={`${pub}/sync.png`} alt="Sync" className="image-with-shadow" />
        </div>

        <br />

        <h4>You can enter the following "{remoteImportUrl}" into the Remote Import box and click Import.</h4>

        <h4>OR</h4>

        <h4>
          You can click{' '}
          {isEmpty ? (
            <span className="link-disabled" title="Nothing has been ingested for this sale yet">this link</span>
          ) : (
            <a href={downloadUrlFor(info.filename)} download={info.filename}>this link</a>
          )}
          {' '}to download the {info.label.toLowerCase()} autofill file and save it, you then click on the Import button under Import/Export, and browse to where you've saved the file
          {isEmpty && ' (not available until a spreadsheet has been ingested for this sale)'}
        </h4>

        <br />

        <h4>
          After you've completed either of the above you then need to click on the "Forms Field" tab, scroll to the bottom and click save.
          <br /><br />
          You will see a green dialogue box pop up at the top of the page telling you the import was successful (or not)
        </h4>

        <br />

        <div className="image-container">
          <img src={`${pub}/formfield.png`} alt="Form Fields" className="image-with-shadow" />
        </div>

        <br />

        <h4>If the import was successful you should see registrations and postcodes appearing in the 'value' column.</h4>

        <h4>
          You Can Test Your AutoFill on a mockup of the Glasto Registration Form{' '}
          on the <a href="#test-form">Test Form tab</a>.
        </h4>

        <h4>Becca Productions Inc.</h4>

        <div className="video-container">
          <video controls width="640" height="360">
            <source src={`${pub}/DannyVid.mp4`} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </section>
  );
};

export default DocumentationSection;
