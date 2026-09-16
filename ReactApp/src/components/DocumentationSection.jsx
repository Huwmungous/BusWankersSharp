import React, { useEffect, useState } from 'react';
import GroupFillPanel from './GroupFillPanel';
import { downloadStoredFile, downloadUrlFor, fetchAutofillGroups } from '../api/autofillApi';
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
    heading: (year) => `${year} Glastonbury Coach Ticket Sale`,
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
    heading: (year) => `${year} Glastonbury General Sale`,
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
    heading: (year) => `${year} Glastonbury Coach Resale`,
    filename: 'coach_resale_autofill.csv',
    dates: ['Dates to be confirmed — check with your group organiser before use.'],
    cost: null,
  },
  'Resale - General': {
    label: 'Resale - General',
    shortLabel: 'General Resale',
    heading: (year) => `${year} Glastonbury General Resale`,
    filename: 'general_resale_autofill.csv',
    dates: ['Dates to be confirmed — check with your group organiser before use.'],
    cost: null,
  },
  Demo: {
    label: 'Demo',
    shortLabel: 'Demo Sale',
    heading: (year) => `${year} Glastonbury Demo Sale`,
    filename: 'demo_autofill.csv',
    dates: ['For testing/demonstration only — not a real sale.'],
    cost: null,
  },
};

const formatWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};

// The Documentation tab (the landing tab). Pick a sale, find your group,
// drag its "Fill Group X" bookmark to the bookmarks bar, try it on the Test
// Form, and on the day click it on the See Tickets registration page.
//
// The bookmarklet replaced the AutoFill Options / Lightning Autofill
// extension as the recommended route on 2026-09-16: the extension's free
// plan is capped at 10 fills a day, which is a real risk on sale morning. The
// extension instructions are kept (collapsed) for anyone who prefers it -
// the same autofill file drives both.
//
// storedFiles: Map of filename -> { filename, size, lastModified } from the
// backend's store (see BusWankersPage). A sale whose filename isn't in it has
// nothing ingested yet - the dropdown says so, the groups panel explains, and
// the download button is disabled. While the store is still loading (or
// unreachable) nothing is known, so every sale is treated as empty rather
// than guessing.
const DocumentationSection = ({ year = DEFAULT_YEAR, storedFiles = new Map(), storeStatus = 'loading', storeError = '' }) => {
  const [saleType, setSaleType] = useState('Coach');
  const [downloadStatus, setDownloadStatus] = useState('idle'); // idle | working | error
  const [downloadError, setDownloadError] = useState('');
  const [groups, setGroups] = useState(null);
  const [groupsStatus, setGroupsStatus] = useState('loading'); // loading | ready | error
  const [groupsError, setGroupsError] = useState('');

  const info = SALE_INFO[saleType];
  const stored = storedFiles.get(info.filename);
  const isEmpty = !stored || stored.size === 0;
  const remoteImportUrl = `https://longmanrd.net/buswankers/${info.filename}`;

  // (Re)load the groups whenever the chosen sale changes or the store is
  // refreshed (an ingest just happened). A sale with no file is "ready, no
  // groups" rather than an error.
  useEffect(() => {
    let cancelled = false;
    if (storeStatus !== 'ready') {
      setGroupsStatus(storeStatus === 'error' ? 'error' : 'loading');
      setGroupsError(storeStatus === 'error' ? storeError : '');
      return undefined;
    }
    if (isEmpty) {
      setGroups(null);
      setGroupsStatus('ready');
      setGroupsError('');
      return undefined;
    }
    setGroupsStatus('loading');
    fetchAutofillGroups(info.filename).then(
      (g) => {
        if (cancelled) return;
        setGroups(g);
        setGroupsStatus('ready');
        setGroupsError('');
      },
      (err) => {
        if (cancelled) return;
        setGroupsStatus('error');
        setGroupsError(err.message || 'Could not reach the upload service.');
      },
    );
    return () => { cancelled = true; };
  }, [info.filename, isEmpty, storeStatus, storeError, stored]);

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

  // "Try it on the Test Form" has just filled the (hidden) Test Form tab -
  // switch to it so the person can see the result.
  const showTestForm = () => {
    window.location.hash = 'test-form';
    window.scrollTo(0, 0);
  };

  return (
    <section className="doc-section" aria-label="How to fill in the registration form">
      <div className="container">
        <h1>{info.heading(year)}</h1>
        <h2>Fill in the registration form without typing a thing</h2>

        <div className="form-group sale-picker">
          <label htmlFor="saleType">Which sale?</label>
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
          </div>
          <p className="sale-picker-note">
            {storeStatus === 'loading' && 'Checking which sales are loaded…'}
            {storeStatus === 'error' && `Couldn't check the sales: ${storeError}`}
            {storeStatus === 'ready' && isEmpty && 'Nothing has been loaded for this sale yet - the organiser needs to upload the spreadsheet on the Update Files tab.'}
            {storeStatus === 'ready' && !isEmpty && `Groups last updated ${formatWhen(stored.lastModified)}`}
          </p>
        </div>

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

        <div className="doc-steps">
          <h3>Step 1 - find your group and grab its bookmark</h3>
          <p>
            Each group below has a green <strong>Glasto {year} - Fill Group …</strong> bookmark. <strong>Drag it up onto your
            browser&rsquo;s bookmarks bar</strong> (or right-click it and choose &ldquo;Bookmark link&rdquo; / &ldquo;Add to
            favourites&rdquo;). Can&rsquo;t see a bookmarks bar? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>
            (<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on a Mac) to show it. The bookmark carries your group&rsquo;s
            registration numbers and postcodes inside it, so on the day it needs nothing from this site.
          </p>

          <GroupFillPanel
            groups={groups}
            status={groupsStatus}
            error={groupsError}
            year={year}
            saleLabel={info.label}
            onTried={showTestForm}
          />

          <h3>Step 2 - try it out</h3>
          <p>
            Click <strong>Try it on the Test Form</strong> next to your group, or go to the <a href="#test-form">Test Form tab</a> and
            click your new bookmark there - it&rsquo;s a copy of the real registration page. Your group&rsquo;s details should
            appear in the boxes and a green bar should confirm how many people were filled in. Click <strong>Proceed</strong> on
            the test form to see exactly what it holds. Do this well before the sale, not on the morning.
          </p>

          <h3>Step 3 - on the day</h3>
          <ol>
            <li>Be on <code>glastonbury.seetickets.com</code> <em>before</em> the sale opens and wait in the queue. Don&rsquo;t refresh,
              and don&rsquo;t open extra tabs or devices - the festival says that can get you blocked.</li>
            <li>When the registration page appears (the one asking for &ldquo;Registration Number&rdquo; and &ldquo;Postcode&rdquo; for each
              person), click your <strong>Glasto {year} - Fill Group …</strong> bookmark once.</li>
            <li>Check the boxes look right - the green bar tells you how many people were filled - then click <strong>Proceed</strong>.
              You have 10 minutes on that page, so there&rsquo;s no rush, but there&rsquo;s nothing to type either.</li>
          </ol>
          <p className="doc-fallback">
            No bookmarks bar (on a phone, say)? Open <strong>Show details / copy &amp; paste</strong> under your group: every
            registration number and postcode has a Copy button, so you can paste rather than type.
          </p>
        </div>

        <details className="doc-alt">
          <summary>Prefer the AutoFill Options / Lightning Autofill browser extension? (read this first)</summary>
          <div className="doc-alt-body">
            <p className="doc-warning">
              <strong>Warning:</strong> the extension&rsquo;s free plan is limited to <strong>10 fills per day</strong>, and every page
              load that triggers it counts. Test the day before, not on the morning, and don&rsquo;t reload the registration
              page. If you hit the limit during the sale the extension will not fill anything - use your bookmark or the
              copy &amp; paste details instead.
            </p>

            <p className="sale-picker-note">
              <button
                type="button"
                className="download-button download-inline"
                onClick={handleDownload}
                disabled={isEmpty || downloadStatus === 'working'}
                title={isEmpty ? 'Nothing has been ingested for this sale yet' : `Download ${info.filename}`}
              >
                {downloadStatus === 'working' ? 'Downloading…' : `Download ${info.filename}`}
              </button>
              {downloadStatus === 'error' && <span className="sale-picker-error"> {downloadError}</span>}
            </p>

            <h4>Use this file to populate your Autofill Options</h4>

            <div className="image-container">
              <img src={`${pub}/Hippies_1.png`} alt="ImportExport" className="image-with-shadow" />
            </div>

            <h4>In AutoFill Options you will see a band of tabs across the top. You should be on the Sync tab to start.</h4>

            <div className="image-container">
              <img src={`${pub}/sync.png`} alt="Sync" className="image-with-shadow" />
            </div>

            <h4>You can enter the following &ldquo;{remoteImportUrl}&rdquo; into the Remote Import box and click Import.</h4>

            <h4>OR</h4>

            <h4>
              You can click{' '}
              {isEmpty ? (
                <span className="link-disabled" title="Nothing has been ingested for this sale yet">this link</span>
              ) : (
                <a href={downloadUrlFor(info.filename)} download={info.filename}>this link</a>
              )}
              {' '}to download the {info.label.toLowerCase()} autofill file and save it, you then click on the Import button under Import/Export, and browse to where you&rsquo;ve saved the file
              {isEmpty && ' (not available until a spreadsheet has been ingested for this sale)'}
            </h4>

            <h4>
              After you&rsquo;ve completed either of the above you then need to click on the &ldquo;Forms Field&rdquo; tab, scroll to the bottom and click save.
              <br /><br />
              You will see a green dialogue box pop up at the top of the page telling you the import was successful (or not)
            </h4>

            <div className="image-container">
              <img src={`${pub}/formfield.png`} alt="Form Fields" className="image-with-shadow" />
            </div>

            <h4>If the import was successful you should see registrations and postcodes appearing in the &lsquo;value&rsquo; column, and the <a href="#test-form">Test Form</a> should fill itself in.</h4>

            <h4>Becca Productions Inc.</h4>

            <div className="video-container">
              <video controls width="640" height="360">
                <source src={`${pub}/DannyVid.mp4`} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
};

export default DocumentationSection;
