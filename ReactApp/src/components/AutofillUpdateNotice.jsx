import React from 'react';
import { formatWhen } from '../saleInfo';
import './AutofillUpdateNotice.css';

// The "is your autofill file up to date?" banner under the sale dropdown on
// the Documentation tab (extension route only - the bookmark and the copy &
// paste tables always read live data, so they can't go stale).
//
// It cannot reach into the AutoFill Options extension to update it (a page
// can't touch another extension's storage), so it does the next best thing:
// it knows which version of this sale's file this browser last downloaded or
// confirmed importing (see ../importedVersions.js), compares that with the
// version the server holds right now, and when they differ puts the fix one
// click away.
//
// updateState (from updateStateFor): 'empty' | 'never' | 'current' | 'stale'.
// Nothing is rendered for 'empty' - the sale picker's own note already says
// nothing has been loaded. file: the server's current entry for the sale
// (filename, lastModified, hash). onDownload / onMarkImported are the page's
// handlers; downloadStatus/downloadError mirror the shared download state.
const AutofillUpdateNotice = ({
  info,
  file,
  updateState,
  remoteImportUrl,
  downloadStatus,
  downloadError,
  onDownload,
  onMarkImported,
}) => {
  if (!info || !file || updateState === 'empty') return null;

  const label = info.label.toLowerCase();
  const when = formatWhen(file.lastModified);
  const working = downloadStatus === 'working';

  if (updateState === 'current') {
    return (
      <p className="update-notice update-notice-current" role="status">
        You have the latest {label} autofill file{when ? ` (updated ${when})` : ''}.
      </p>
    );
  }

  const stale = updateState === 'stale';

  return (
    <div className={`update-notice ${stale ? 'update-notice-stale' : 'update-notice-never'}`} role="status">
      <p className="update-notice-heading">
        {stale
          ? `The ${label} autofill file has been updated since you last took it${when ? ` (${when})` : ''}.`
          : `This browser has no record of you importing the ${label} autofill file.`}
      </p>
      <p className="update-notice-body">
        {stale
          ? 'Your extension may still hold the old details. Download the new file and import it again, or paste the Remote Import address into AutoFill Options.'
          : 'If you haven\u2019t imported it yet, download it and import it into AutoFill Options. If you already have the current file, say so and this reminder will go away.'}
      </p>
      <div className="update-notice-actions">
        <button type="button" className="update-notice-button" onClick={onDownload} disabled={working}>
          {working ? 'Downloading\u2026' : `Download ${info.filename}`}
        </button>
        <button type="button" className="update-notice-button update-notice-secondary" onClick={onMarkImported}>
          I&rsquo;ve imported the current file
        </button>
      </div>
      <p className="update-notice-remote">
        Remote Import address: <code>{remoteImportUrl}</code>
      </p>
      {downloadStatus === 'error' && <p className="update-notice-error">{downloadError}</p>}
    </div>
  );
};

export default AutofillUpdateNotice;
