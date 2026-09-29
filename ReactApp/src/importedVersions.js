import { useCallback, useEffect, useState } from 'react';

// Which version of each sale's autofill file THIS BROWSER last took, so the
// Documentation tab can say "there's a newer file than the one you imported".
//
// Why it lives here and not in the extension: AutoFill Options / Lightning
// Autofill is a third-party extension - a web page can neither read what it
// has imported nor write into it. The only things this page can observe are
// (a) the person downloading the file through it, and (b) the person telling
// it "I've imported this" (needed for the Remote Import route, where the
// extension itself pulls the URL and the page never sees the transfer). Both
// end up in markTaken below.
//
// Stored per browser in localStorage as { [filename]: { hash, lastModified,
// at } }. Everything that touches storage is wrapped in try/catch - storage
// can be blocked or full (private windows, cleared site data) and the page
// must still work, just without remembering.
//
// Everything the hook uses is a plain module-level const declared ABOVE it,
// and nothing is read from storage at import time, so there is no
// temporal-dead-zone exposure however the bundler orders things.

export const STORAGE_KEY = 'bw-imported-versions';

// Reads the whole record; anything unparseable or of the wrong shape is
// treated as "nothing recorded" rather than an error.
export const readTaken = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeTaken = (taken) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(taken));
  } catch (err) {
    console.debug('[updates] could not remember the imported version:', err && err.message);
  }
};

// What this browser last took for a file: { hash, lastModified, at }.
const entryFor = (file) => ({
  hash: (file && file.hash) || '',
  lastModified: (file && file.lastModified) || '',
  at: new Date().toISOString(),
});

// 'empty'   - nothing stored for this sale (nothing to be out of date with)
// 'never'   - this browser has no record of taking the file
// 'current'  - what was taken is what is stored now
// 'stale'   - the stored file has changed since it was taken
//
// The content hash decides when both sides have one - a re-ingest of an
// unchanged spreadsheet rewrites the file (new lastModified, same bytes) and
// must not raise a false alarm. When either side lacks a hash (the backend
// predates it, or the file couldn't be read) it falls back to lastModified,
// which errs towards "stale" - the safe direction.
export const updateStateFor = (file, taken) => {
  if (!file || file.size === 0) return 'empty';
  if (!taken) return 'never';
  if (file.hash && taken.hash) return file.hash === taken.hash ? 'current' : 'stale';
  return file.lastModified && file.lastModified === taken.lastModified ? 'current' : 'stale';
};

// taken: the whole record (filename -> entry); markTaken(filename, file)
// records that this browser now has that version of the file.
export function useImportedVersions() {
  const [taken, setTaken] = useState(readTaken);

  // Another tab of the app recording a download/import should be reflected
  // here at once, not on the next reload. (The storage event only fires in
  // OTHER tabs, so it never echoes our own writes.)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === null || e.key === STORAGE_KEY) setTaken(readTaken());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const markTaken = useCallback((filename, file) => {
    if (!filename || !file) return;
    const entry = entryFor(file);
    console.debug('[updates] recording taken version', filename, entry.hash || entry.lastModified);
    writeTaken({ ...readTaken(), [filename]: entry });
    setTaken((prev) => ({ ...prev, [filename]: entry }));
  }, []);

  return { taken, markTaken };
}
