import React, { useState } from 'react';
import ExtensionInstructions from './ExtensionInstructions';
import GroupFillPanel from './GroupFillPanel';
import { downloadStoredFile, saveBlob } from '../api/autofillApi';
import { bookmarkFolderFileName, bookmarkFolderHtml, bookmarkFolderName } from '../bookmarklet';
import { DEFAULT_YEAR } from '../festival';
import { SALE_INFO, formatWhen } from '../saleInfo';
import { useAutofillGroups } from '../useAutofillGroups';
import './DocumentationSection.css';

// The Documentation tab (the landing tab). Pick a sale, then choose HOW to
// fill the registration form - two equal routes, both driven by the same
// autofill file:
//   - Bookmark: drag your group's "Fill Group X" bookmark to the bookmarks
//     bar, try it on the Test Form, click it on the See Tickets page on the
//     day. No extension, no account, no daily limit. Added 2026-09-16 and
//     the recommended route.
//   - Extension: the original AutoFill Options / Lightning Autofill route,
//     for people who already use it. Its free plan is capped at 10 fills a
//     day, which the instructions warn about up front.
// The chosen method is remembered per browser (localStorage) so someone who
// picked the extension lands on their own instructions next time.
//
// storedFiles: Map of filename -> { filename, size, lastModified } from the
// backend's store (see BusWankersPage). A sale whose filename isn't in it has
// nothing ingested yet - the dropdown says so, the groups panel explains, and
// the download button is disabled. While the store is still loading (or
// unreachable) nothing is known, so every sale is treated as empty rather
// than guessing.
const METHOD_KEY = 'bw-fill-method';

const readSavedMethod = () => {
  try {
    const v = window.localStorage.getItem(METHOD_KEY);
    return v === 'extension' ? 'extension' : 'bookmark';
  } catch {
    return 'bookmark';
  }
};

// saleType/onSaleTypeChange: lifted up to BusWankersPage (rather than local
// state here) so the Groups tab's fallback view defaults to whatever sale is
// currently selected here, and either tab changing it moves both.
const DocumentationSection = ({
  year = DEFAULT_YEAR,
  storedFiles = new Map(),
  storeStatus = 'loading',
  storeError = '',
  saleType = 'Coach',
  onSaleTypeChange = () => {},
}) => {
  const [method, setMethod] = useState(readSavedMethod); // bookmark | extension
  const [downloadStatus, setDownloadStatus] = useState('idle'); // idle | working | error
  const [downloadError, setDownloadError] = useState('');

  const info = SALE_INFO[saleType];
  const {
    groups,
    status: groupsStatus,
    error: groupsError,
    isEmpty,
    stored,
  } = useAutofillGroups(info.filename, storedFiles, storeStatus, storeError);
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

  // Every group's bookmark for this sale in one importable bookmarks file,
  // as a folder named "Glasto <Sale> Bookmarks" (see bookmarkFolderHtml).
  const folderName = bookmarkFolderName(info.folderLabel);
  const downloadBookmarkFolder = () => {
    if (!groups || groups.length === 0) return;
    const html = bookmarkFolderHtml(groups, folderName, year);
    saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), bookmarkFolderFileName(info.folderLabel));
  };

  const chooseMethod = (m) => {
    setMethod(m);
    try { window.localStorage.setItem(METHOD_KEY, m); } catch { /* per-browser convenience only */ }
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
              onChange={(e) => { onSaleTypeChange(e.target.value); setDownloadStatus('idle'); setDownloadError(''); }}
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

        <div className="method-chooser" role="group" aria-label="How do you want to fill the form?">
          <h3>How do you want to fill in the registration form?</h3>
          <p className="method-chooser-note">
            Both use the same {info.label.toLowerCase()} data. Pick whichever you&rsquo;re happier with - you can switch any time.
          </p>
          <div className="method-cards">
            <button
              type="button"
              className={`method-card${method === 'bookmark' ? ' method-card-active' : ''}`}
              aria-pressed={method === 'bookmark'}
              onClick={() => chooseMethod('bookmark')}
            >
              <span className="method-card-title">Bookmark</span>
              <span className="method-card-badge method-card-badge-good">No daily limit</span>
              <span className="method-card-text">
                A one-click bookmark with your group&rsquo;s details built in. No extension, no account, nothing to install.
                Chrome, Edge, Firefox and Safari.
              </span>
            </button>
            <button
              type="button"
              className={`method-card${method === 'extension' ? ' method-card-active' : ''}`}
              aria-pressed={method === 'extension'}
              onClick={() => chooseMethod('extension')}
            >
              <span className="method-card-title">AutoFill Options extension</span>
              <span className="method-card-badge method-card-badge-warn">Free plan: 10 fills a day</span>
              <span className="method-card-text">
                The browser extension we&rsquo;ve used in previous years (now called Lightning Autofill). Fills the page
                automatically. If you already use it and know it, carry on.
              </span>
            </button>
          </div>
        </div>

        {method === 'bookmark' && (
          <div className="doc-steps">
            <h3>Step 1 - get the bookmarks into your browser</h3>
            <p>
              <strong>Easiest: import the whole folder.</strong> The button below downloads a small file that adds a bookmarks
              folder called <strong>{folderName}</strong> containing a bookmark for every group. Import it and you&rsquo;re done -
              on the day, open the folder on your bookmarks bar and click your group. The bookmarks carry each group&rsquo;s
              registration numbers and postcodes inside them, so on the day they need nothing from this site.
            </p>
            <p className="folder-download">
              <button
                type="button"
                className="download-button folder-download-button"
                onClick={downloadBookmarkFolder}
                disabled={groupsStatus !== 'ready' || !groups || groups.length === 0}
                title={groups && groups.length ? `Download ${bookmarkFolderFileName(info.folderLabel)}` : 'No groups loaded for this sale yet'}
              >
                Download &ldquo;{folderName}&rdquo;
              </button>
            </p>
            <details className="import-howto">
              <summary>How to import the folder (Chrome, Edge, Firefox, Safari)</summary>
              <ul>
                <li><strong>Chrome:</strong> menu <kbd>&#8942;</kbd> &rarr; Bookmarks and lists &rarr; Import bookmarks and settings &rarr;
                  choose <em>Bookmarks HTML file</em> &rarr; pick the downloaded file. If you already had bookmarks, the folder appears
                  inside an <em>Imported</em> folder on the bookmarks bar - drag <strong>{folderName}</strong> out onto the bar if you like.</li>
                <li><strong>Edge:</strong> menu <kbd>&hellip;</kbd> &rarr; Favourites &rarr; <kbd>&hellip;</kbd> &rarr; Import favourites &rarr;
                  <em>Favourites or bookmarks HTML file</em> &rarr; pick the file.</li>
                <li><strong>Firefox:</strong> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> opens the Library &rarr; Import and Backup &rarr;
                  Import Bookmarks from HTML&hellip; &rarr; pick the file. The folder lands on the Bookmarks Toolbar.</li>
                <li><strong>Safari (Mac):</strong> File &rarr; Import From &rarr; Bookmarks HTML File&hellip; &rarr; pick the file; the folder
                  appears under <em>Imported</em> in the sidebar - drag it to the Favourites bar.</li>
                <li>Can&rsquo;t see a bookmarks bar at all? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>
                  (<kbd>&#8984;</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on a Mac) to show it.</li>
              </ul>
            </details>
            <p>
              <strong>Or drag the green Glasto {year} - Fill Group&hellip; bookmarks onto your bookmarks bar</strong>{' '}
              (or right-click one and choose &ldquo;Bookmark link&rdquo; / &ldquo;Add to favourites&rdquo;).
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
              click your new bookmark there. For the closest possible rehearsal, open the{' '}
              <a href={`${process.env.PUBLIC_URL}/test_page.html`} target="_blank" rel="noopener noreferrer">saved copy of the real See Tickets page</a>{' '}
              and click your bookmark on that. Either way your group&rsquo;s details should appear in the boxes and a green bar
              should confirm how many people were filled in; click <strong>Proceed</strong> to see exactly what the form holds.
              Do this well before the sale, not on the morning.
            </p>

            <h3>Step 3 - on the day</h3>
            <ol>
              <li>Be on <code>glastonbury.seetickets.com</code> <em>before</em> the sale opens and wait in the queue. Don&rsquo;t refresh,
                and don&rsquo;t open extra tabs or devices - the festival says that can get you blocked.</li>
              <li>When the registration page appears (the one asking for &ldquo;Registration Number&rdquo; and &ldquo;Postcode&rdquo; for each
                person), open the <strong>{folderName}</strong> folder on your bookmarks bar and click your{' '}
                <strong>Glasto {year} - Fill Group &hellip;</strong> bookmark once.</li>
              <li>Check the boxes look right - the green bar tells you how many people were filled - then click <strong>Proceed</strong>.
                You have 10 minutes on that page, so there&rsquo;s no rush, but there&rsquo;s nothing to type either.</li>
            </ol>
            <p className="doc-fallback">
              No bookmarks bar (on a phone, say)? Open <strong>Show details / copy &amp; paste</strong> under your group: every
              registration number and postcode has a Copy button, so you can paste rather than type.
            </p>
          </div>
        )}

        {method === 'extension' && (
          <ExtensionInstructions
            info={info}
            isEmpty={isEmpty}
            remoteImportUrl={remoteImportUrl}
            downloadStatus={downloadStatus}
            downloadError={downloadError}
            onDownload={handleDownload}
          />
        )}
      </div>
    </section>
  );
};

export default DocumentationSection;
