import React, { useMemo, useState } from 'react';
import ExtensionInstructions from './ExtensionInstructions';
import GroupFillPanel from './GroupFillPanel';
import SaleBookmarklet from './SaleBookmarklet';
import { downloadStoredFile, groupsUrlFor, saveBlob } from '../api/autofillApi';
import { bookmarkFolderFileName, bookmarkFolderHtml, bookmarkFolderName, saleBookmarkletTitle } from '../bookmarklet';
import { DEFAULT_YEAR } from '../festival';
import { SALE_INFO, formatWhen } from '../saleInfo';
import { useAutofillGroups } from '../useAutofillGroups';
import { buildNameLookup } from '../runningOrder';
import './DocumentationSection.css';

// The Documentation tab (the landing tab). Pick a sale, then choose HOW to
// fill the registration form - three routes, all driven by the same
// autofill file, offered left-to-right in this order:
//   - Extension (AutoFill Options / Lightning Autofill): the route used in
//     previous buying rounds, so it's the default and sits on the left.
//     Needs installing first, can go stale if you forget to re-download the
//     file, and the free plan is capped at 10 goes a day - the card spells
//     all three out, and ExtensionInstructions repeats the warning up front.
//   - Bookmark: drag ONE bookmark to the bookmarks bar (SaleBookmarklet, see
//     ../bookmarklet.js), try it on the Test Form, click it on the See
//     Tickets page on the day and tap your own group from the list that
//     pops up. No extension, no account, no daily limit, no download-then-
//     import dance - added 2026-09-16, made single-drag on 2026-09-17. Not
//     used in anger yet, which the card says plainly. The old per-group
//     bookmarks and the whole-folder download/import are still there (see
//     the "advanced options" details) for anyone who'd rather have a
//     bookmark already set to their own group, or is setting this up on
//     someone else's browser. Every bookmark - whichever route it came from
//     - checks live for fresher data at click time (see bookmarklet.js) -
//     so there's no "your bookmarks are stale, re-download them" concern to
//     surface here any more; a bookmark generated today keeps working
//     correctly even if the underlying spreadsheet changes before the sale.
//   - Copy & paste: the last-resort fallback - point people at the
//     standalone Groups tab (see GroupsSection), where every registration
//     number and postcode has its own Copy button, for when neither of the
//     above is working or practical (e.g. no bookmarks bar on a phone).
// The chosen method is remembered per browser (localStorage) so someone who
// picked a different route lands on their own instructions next time.
//
// storedFiles: Map of filename -> { filename, size, lastModified } from the
// backend's store (see BusWankersPage). A sale whose filename isn't in it has
// nothing ingested yet - the dropdown says so, the groups panel explains, and
// the download button is disabled. While the store is still loading (or
// unreachable) nothing is known, so every sale is treated as empty rather
// than guessing.
const METHOD_KEY = 'bw-fill-method';
const METHODS = ['extension', 'bookmark', 'copypaste'];
const DEFAULT_METHOD = 'extension'; // AutoFill Options - used in previous buying rounds

const readSavedMethod = () => {
  try {
    const v = window.localStorage.getItem(METHOD_KEY);
    return METHODS.includes(v) ? v : DEFAULT_METHOD;
  } catch {
    return DEFAULT_METHOD;
  }
};

// A short Pros/Cons list for a method card. Plain <span>/<br> only (no
// <ul>/<dl>) because this sits inside a <button>, whose content model is
// phrasing content - block-level list markup there is invalid HTML even
// though most browsers render it fine.
const ProsCons = ({ pros = [], cons = [] }) => (
  <span className="method-card-proscons">
    {pros.length > 0 && (
      <span className="method-card-proscons-block method-card-pros">
        <strong>Pros:</strong>
        {pros.map((p, i) => (
          <React.Fragment key={i}><br />&bull; {p}</React.Fragment>
        ))}
      </span>
    )}
    {cons.length > 0 && (
      <span className="method-card-proscons-block method-card-cons">
        <strong>Cons:</strong>
        {cons.map((c, i) => (
          <React.Fragment key={i}><br />&bull; {c}</React.Fragment>
        ))}
      </span>
    )}
  </span>
);

// saleType/onSaleTypeChange: lifted up to BusWankersPage (rather than local
// state here) so the Groups tab's fallback view defaults to whatever sale is
// currently selected here, and either tab changing it moves both.
//
// runningOrder: the ingested roster (see BusWankersPage/fetchRunningOrder) -
// used only to look up each member's name by registration number for the
// group tables' Name column (see runningOrder.js); the autofill files
// themselves never carry names.
const DocumentationSection = ({
  year = DEFAULT_YEAR,
  storedFiles = new Map(),
  storeStatus = 'loading',
  storeError = '',
  saleType = 'Coach',
  onSaleTypeChange = () => {},
  runningOrder = null,
}) => {
  const [method, setMethod] = useState(readSavedMethod); // extension | bookmark | copypaste
  const [downloadStatus, setDownloadStatus] = useState('idle'); // idle | working | error
  const [downloadError, setDownloadError] = useState('');
  const nameLookup = useMemo(() => buildNameLookup(runningOrder), [runningOrder]);

  const info = SALE_INFO[saleType];
  const {
    groups,
    status: groupsStatus,
    error: groupsError,
    isEmpty,
    stored,
  } = useAutofillGroups(info.filename, storedFiles, storeStatus, storeError);
  const remoteImportUrl = `https://longmanrd.net/buswankers/${info.filename}`;

  // This sale's live group-data URL (see groupsUrlFor in api/autofillApi.js
  // and DownloadGroups on the backend) - baked into every bookmarklet
  // generated below so each one can check for fresher data at click time
  // (see bookmarklet.js). Always computed, even for a sale with nothing
  // ingested yet (isEmpty below already handles that case by not offering a
  // download or groups at all).
  const groupsUrl = groupsUrlFor(info.filename);

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

  // Every group's bookmark for this sale in one importable bookmarks file, as
  // a folder named "Glasto <Sale> Bookmarks" (see bookmarkFolderHtml/
  // bookmarkFolderName). No data-version suffix any more - see
  // bookmarkFolderName's own comment for why - so this is a single, stable
  // name regardless of how many times the underlying spreadsheet changes.
  const folderName = bookmarkFolderName(info.folderLabel);
  const downloadBookmarkFolder = () => {
    if (!groups || groups.length === 0) return;
    const html = bookmarkFolderHtml(groups, folderName, year, groupsUrl, info.folderLabel);
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
            All three use the same {info.label.toLowerCase()} data. Pick whichever you&rsquo;re happier with - you can switch any time.
          </p>
          <div className="method-cards">
            <button
              type="button"
              className={`method-card${method === 'extension' ? ' method-card-active' : ''}`}
              aria-pressed={method === 'extension'}
              onClick={() => chooseMethod('extension')}
            >
              <span className="method-card-title">AutoFill Options extension</span>
              <span className="method-card-text">
                The browser extension we&rsquo;ve used in previous years (now called Lightning Autofill). Fills the page
                automatically. If you already use it and know it, carry on.
              </span>
              <ProsCons
                pros={['Used in previous buying rounds']}
                cons={[
                  'Requires installation',
                  <>Risk of stale data - <strong>make sure you have the most up-to-date files downloaded</strong></>,
                  'Daily usage limit of 10 goes',
                ]}
              />
            </button>
            <button
              type="button"
              className={`method-card${method === 'bookmark' ? ' method-card-active' : ''}`}
              aria-pressed={method === 'bookmark'}
              onClick={() => chooseMethod('bookmark')}
            >
              <span className="method-card-title">Bookmark</span>
              <span className="method-card-text">
                A one-click bookmark with your group&rsquo;s details built in. No extension, no account, nothing to install.
                Chrome, Edge, Firefox and Safari.
              </span>
              <ProsCons
                pros={['Simple drag-drop to the bookmarks bar', 'Always up-to-date']}
                cons={['Never tested']}
              />
            </button>
            <button
              type="button"
              className={`method-card${method === 'copypaste' ? ' method-card-active' : ''}`}
              aria-pressed={method === 'copypaste'}
              onClick={() => chooseMethod('copypaste')}
            >
              <span className="method-card-title">Copy &amp; paste</span>
              <span className="method-card-text">
                If all else fails, copy and paste text from the Groups page.
              </span>
            </button>
          </div>
        </div>

        {method === 'bookmark' && (
          <div className="doc-steps">
            <h3>Step 1 - get the bookmark into your browser</h3>

            {groups && groups.length > 0 ? (
              <>
                <p>
                  <strong>Drag this one bookmark to your bookmarks bar</strong> - that&rsquo;s the whole install. It works
                  for everyone on the {info.label.toLowerCase()}: on the day, click it and tap your own group from the
                  list that pops up, then check the boxes and click Proceed.
                </p>

                <SaleBookmarklet
                  groups={groups}
                  year={year}
                  saleFolderLabel={info.folderLabel}
                  groupsUrl={groupsUrl}
                  onTried={showTestForm}
                />

                <p className="doc-fallback">
                  Not sure how to drag a link onto your bookmarks bar? Right-click it instead and choose &ldquo;Bookmark
                  link&rdquo; (or &ldquo;Add to favourites&rdquo;) from the menu that appears.
                </p>
              </>
            ) : (
              <p className="bw-note">
                {groupsStatus === 'loading' ? `Loading the ${info.label.toLowerCase()} groups…` : `Nothing has been loaded for this sale yet - the organiser needs to upload the spreadsheet on the Update Files tab.`}
              </p>
            )}



            <details className="doc-alt">
              <summary>Prefer a bookmark already set to your own group, or setting this up for someone else&rsquo;s browser? (advanced options)</summary>
              <div className="doc-alt-body">
                <p>
                  <strong>Import the whole folder.</strong> The button below downloads a small file that adds a bookmarks
                  folder called <strong>{folderName}</strong> containing a separate bookmark for every group. Import it
                  and, on the day, open the folder on your bookmarks bar and click your own group&rsquo;s bookmark directly
                  - no tap-your-group step needed, at the cost of a download-then-import first.
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
                  <strong>Or drag one of the green Glasto {year} - Fill Group&hellip; bookmarks below onto your bookmarks bar</strong>{' '}
                  (or right-click one and choose &ldquo;Bookmark link&rdquo; / &ldquo;Add to favourites&rdquo;) for just your own group.
                </p>

                <GroupFillPanel
                  groups={groups}
                  status={groupsStatus}
                  error={groupsError}
                  year={year}
                  saleLabel={info.label}
                  saleFolderLabel={info.folderLabel}
                  onTried={showTestForm}
                  nameLookup={nameLookup}
                  groupsUrl={groupsUrl}
                />
              </div>
            </details>

            <h3>Step 2 - try it out</h3>
            <p>
              Click <strong>Try it on the Test Form</strong> next to the bookmark above, or go to the <a href="#test-form">Test Form tab</a> and
              click your new bookmark there. For the closest possible rehearsal, open the{' '}
              <a href={`${process.env.PUBLIC_URL}/test_page.html`} target="_blank" rel="noopener noreferrer">saved copy of the real See Tickets page</a>{' '}
              and click your bookmark on that. Either way, tap your group when asked, and your details should appear in the boxes with a green bar
              confirming how many people were filled in; click <strong>Proceed</strong> to see exactly what the form holds.
              Do this well before the sale, not on the morning.
            </p>

            <h3>Step 3 - on the day</h3>
            <ol>
              <li>Be on <code>glastonbury.seetickets.com</code> <em>before</em> the sale opens and wait in the queue. Don&rsquo;t refresh,
                and don&rsquo;t open extra tabs or devices - the festival says that can get you blocked.</li>
              <li>When the registration page appears (the one asking for &ldquo;Registration Number&rdquo; and &ldquo;Postcode&rdquo; for each
                person), click your <strong>{saleBookmarkletTitle(info.folderLabel, year)}</strong> bookmark once, then tap your
                own group in the list that pops up.</li>

              <li>Check the boxes look right - the green bar tells you how many people were filled - then click <strong>Proceed</strong>.
                You have 10 minutes on that page, so there&rsquo;s no rush, but there&rsquo;s nothing to type either.</li>
            </ol>
            <p className="doc-fallback">
              No bookmarks bar (on a phone, say)? Open <strong>Show details / copy &amp; paste</strong> under your group in the advanced
              options above: every registration number and postcode has a Copy button, so you can paste rather than type.
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

        {method === 'copypaste' && (
          <div className="doc-steps">
            <h3>Copy your registration numbers and postcodes by hand</h3>
            <p>
              This is the last-resort fallback, for when the bookmark or the extension isn&rsquo;t working, or
              you&rsquo;re somewhere a bookmarks bar isn&rsquo;t practical (a phone, say). Head over to the{' '}
              <a href="#groups">Groups tab</a> and find your own group there - every registration number and
              postcode has its own Copy button, so you can paste each one straight into the registration form
              instead of typing it out. It always shows the latest data; there&rsquo;s just nothing to automate,
              so you copy and paste box by box.
            </p>
            <p className="doc-fallback">
              <a href="#groups">Go to the Groups tab &rarr;</a>
            </p>
          </div>
        )}
      </div>
    </section>
  );
};

export default DocumentationSection;
