import { useEffect, useState } from 'react';
import { fetchAutofillGroups } from './api/autofillApi';

// Loads one sale's groups from its stored autofill file, kept in step with
// the shared store (see BusWankersPage): reloads whenever the chosen
// filename changes or the store is refreshed (an ingest just happened). A
// sale with no file uploaded yet is "ready, no groups" rather than an error
// - only a genuine fetch failure sets `status` to 'error'.
//
// Shared by DocumentationSection (the bookmark/extension walkthrough) and
// GroupsSection (the standalone copy/paste fallback tab) so both read the
// same groups for the same sale rather than each polling the backend on its
// own, possibly-diverging schedule.
export function useAutofillGroups(filename, storedFiles, storeStatus, storeError) {
  const [groups, setGroups] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');

  const stored = storedFiles.get(filename);
  const isEmpty = !stored || stored.size === 0;

  useEffect(() => {
    let cancelled = false;
    if (storeStatus !== 'ready') {
      setStatus(storeStatus === 'error' ? 'error' : 'loading');
      setError(storeStatus === 'error' ? storeError : '');
      return undefined;
    }
    if (isEmpty) {
      setGroups(null);
      setStatus('ready');
      setError('');
      return undefined;
    }
    setStatus('loading');
    fetchAutofillGroups(filename).then(
      (g) => {
        if (cancelled) return;
        setGroups(g);
        setStatus('ready');
        setError('');
      },
      (err) => {
        if (cancelled) return;
        setStatus('error');
        setError(err.message || 'Could not reach the upload service.');
      },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, isEmpty, storeStatus, storeError, stored]);

  return { groups, status, error, isEmpty, stored };
}
