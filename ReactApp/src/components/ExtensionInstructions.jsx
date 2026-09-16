import React from 'react';
import { downloadUrlFor } from '../api/autofillApi';

const pub = process.env.PUBLIC_URL;

// The original route: import the sale's autofill file into the AutoFill
// Options / Lightning Autofill browser extension, which then fills the
// registration page automatically. Kept as a first-class option alongside
// the bookmark because plenty of people already use it and know it; the
// free plan's 10-fills-a-day cap is the one thing they must know.
//
// info: the SALE_INFO entry for the chosen sale; isEmpty: nothing ingested
// for it yet; remoteImportUrl: the public URL AutoFill's Remote Import can
// pull; onDownload + downloadStatus/downloadError: the Download button.
const ExtensionInstructions = ({ info, isEmpty, remoteImportUrl, downloadStatus, downloadError, onDownload }) => (
  <div className="doc-steps doc-extension">
    <p className="doc-warning">
      <strong>Before you rely on it:</strong> the extension&rsquo;s free plan is limited to <strong>10 fills per day</strong>, and
      every page load that triggers it counts. Test the day before, not on the morning, and don&rsquo;t reload the registration
      page. If it stops filling during the sale, switch to the <strong>Bookmark</strong> method above or the copy &amp; paste
      details under your group - both use exactly the same data.
    </p>

    <h3>Step 1 - get the {info.label.toLowerCase()} autofill file into AutoFill Options</h3>

    <p className="sale-picker-note">
      <button
        type="button"
        className="download-button download-inline"
        onClick={onDownload}
        disabled={isEmpty || downloadStatus === 'working'}
        title={isEmpty ? 'Nothing has been ingested for this sale yet' : `Download ${info.filename}`}
      >
        {downloadStatus === 'working' ? 'Downloading…' : `Download ${info.filename}`}
      </button>
      {downloadStatus === 'error' && <span className="sale-picker-error"> {downloadError}</span>}
    </p>

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

    <h4>If the import was successful you should see registrations and postcodes appearing in the &lsquo;value&rsquo; column.</h4>

    <h3>Step 2 - try it out</h3>
    <p>
      Go to the <a href="#test-form">Test Form tab</a>, or open the{' '}
      <a href={`${pub}/test_page.html`} target="_blank" rel="noopener noreferrer">saved copy of the real See Tickets page</a>, and
      pick your group&rsquo;s profile in AutoFill Options. The boxes should fill themselves in; click <strong>Proceed</strong> there to see exactly what went in. Do this
      well before the sale, and remember each fill counts towards the day&rsquo;s ten.
    </p>

    <h3>Step 3 - on the day</h3>
    <ol>
      <li>Be on <code>glastonbury.seetickets.com</code> <em>before</em> the sale opens and wait in the queue. Don&rsquo;t refresh,
        and don&rsquo;t open extra tabs or devices - the festival says that can get you blocked, and every reload spends a fill.</li>
      <li>When the registration page appears, the extension should fill it; if not, click the AutoFill Options icon and choose your group.</li>
      <li>Check the boxes look right, then click <strong>Proceed</strong>. You have 10 minutes on that page.</li>
    </ol>

    <h4>Becca Productions Inc.</h4>

    <div className="video-container">
      <video controls width="640" height="360">
        <source src={`${pub}/DannyVid.mp4`} type="video/mp4" />
        Your browser does not support the video tag.
      </video>
    </div>
  </div>
);

export default ExtensionInstructions;
