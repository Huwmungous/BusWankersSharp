import React, { useCallback, useEffect, useRef, useState } from 'react';
import DocumentationSection from './DocumentationSection';
import GroupsSection from './GroupsSection';
import IngestBar from './IngestBar';
import LaunchSection from './LaunchSection';
import RunningOrderSection from './RunningOrderSection';
import TestSection from './TestSection';
import { fetchRunningOrder, fetchStoredFiles } from '../api/autofillApi';
import { DEFAULT_YEAR } from '../festival';
import { useActiveTab } from '../tabs';
import './BusWankersPage.css';

// Two file-listing entries are "the same" when nothing about them moved.
// (hash is '' when the server couldn't work one out - both sides then compare
// equal on it and size/lastModified decide.)
const sameStoredFile = (a, b) =>
  a.size === b.size && a.lastModified === b.lastModified && (a.hash || '') === (b.hash || '');

// Folds a freshly fetched listing into the current one, reusing the existing
// entry object wherever it is unchanged, and returning the existing Map
// itself when nothing at all changed. Identity matters: useAutofillGroups
// re-fetches a sale's groups whenever its entry object changes, so handing
// it look-alike copies on every background re-check would reload the groups
// (and flash "loading") each time. Module-level and declared above the
// component, so it is initialised before any render or callback can call it.
const mergeStoredFiles = (prev, next) => {
  let changed = prev.size !== next.size;
  const merged = new Map();
  for (const [name, file] of next) {
    const existing = prev.get(name);
    if (existing && sameStoredFile(existing, file)) {
      merged.set(name, existing);
    } else {
      merged.set(name, file);
      changed = true;
    }
  }
  return changed ? merged : prev;
};

// The site is one page with six tabs (see src/tabs.js): Update Files (upload
// a spreadsheet to refresh the live autofill files), Documentation (the
// landing tab - pick and download your autofill file), Groups (a standalone
// copy/paste fallback for every group, for when the bookmark, bookmarklet,
// extension or Launcher jump doesn't work), Running Order (who's on this
// year's roster), Test Form (a mockup of the registration form) and Launcher
// (arm this browser to open the ticket page at the sale time).
//
// Every tab body stays mounted and is simply hidden when not selected, so
// switching tabs never throws away what's in them - the upload bar's result
// list, a half-filled test form - and the shared state here is fetched once:
// which autofill files actually exist in the backend's store right now (so
// the dropdown can flag empty ones and an ingest can refresh it), and the
// roster from the last ingest, which is where the festival year the whole
// page talks about comes from.
const BusWankersPage = () => {
  const [activeTab] = useActiveTab();
  const [storedFiles, setStoredFiles] = useState(new Map());
  const [storeStatus, setStoreStatus] = useState('loading'); // loading | ready | error
  const [storeError, setStoreError] = useState('');
  const [runningOrder, setRunningOrder] = useState(null);
  const [runningOrderStatus, setRunningOrderStatus] = useState('loading'); // loading | ready | error
  const [runningOrderError, setRunningOrderError] = useState('');
  // Which sale (Coach/General/...) the page is currently looking at. Lifted
  // up here - rather than each tab keeping its own - so the Groups tab's
  // fallback view always starts on whatever sale is selected on the
  // Documentation tab, and picking a different sale in either place moves
  // both (they're both permanently mounted, just hidden - see tabProps).
  const [saleType, setSaleType] = useState('Coach');

  // Whether a listing has ever loaded successfully. A ref, not state: it only
  // steers how a later background re-check treats a failure, and must be
  // readable inside callbacks without making them re-create.
  const filesLoadedRef = useRef(false);

  // Just the autofill file listing (the running order doesn't move often
  // enough to be worth re-fetching alongside it). `quiet` is for the
  // background re-checks below - the dropdown being used, the tab coming back
  // into view - where a transient failure must not throw away a listing that
  // was working: it is logged and the last good one stays. The first load,
  // and an ingest's refresh, are not quiet and report failures as before.
  //
  // Declared BEFORE refreshStore and recheckFiles on purpose: both read it in
  // their dependency arrays at the moment they are created, so declaring it
  // after them would be a temporal-dead-zone error.
  const refreshFiles = useCallback(async ({ quiet = false } = {}) => {
    try {
      const files = await fetchStoredFiles();
      console.debug('[updates] file listing fetched', { quiet, files: files.size });
      filesLoadedRef.current = true;
      // Keep the SAME Map (and the same entry objects) when nothing changed,
      // so a re-check that finds nothing new causes no re-render and, more to
      // the point, doesn't make useAutofillGroups reload the groups.
      setStoredFiles((prev) => mergeStoredFiles(prev, files));
      setStoreStatus('ready');
      setStoreError('');
    } catch (err) {
      if (quiet && filesLoadedRef.current) {
        console.debug('[updates] background re-check failed, keeping the last listing:', err && err.message);
        return;
      }
      setStoreStatus('error');
      setStoreError((err && err.message) || 'Could not reach the upload service.');
    }
  }, []);

  // The documentation tab's hook for "check now": used when the sale
  // dropdown changes so the banner reflects the server as it is at that
  // moment, not as it was when the page loaded.
  const recheckFiles = useCallback(() => refreshFiles({ quiet: true }), [refreshFiles]);

  // Event-driven, not polled: when the tab or installed app comes back into
  // view (the usual state of a page someone left open on the morning of a
  // sale) look again, once. Nothing runs while it's in the background.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.debug('[updates] page visible again - re-checking the file listing');
        recheckFiles();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [recheckFiles]);

  const refreshStore = useCallback(async () => {
    // The two fetches are independent: a running-order problem must not hide
    // the autofill files, and vice versa, so each settles its own state.
    const filesPromise = refreshFiles();

    const rosterPromise = fetchRunningOrder().then(
      (roster) => {
        setRunningOrder(roster);
        setRunningOrderStatus('ready');
        setRunningOrderError('');
      },
      (err) => {
        setRunningOrderStatus('error');
        setRunningOrderError(err.message || 'Could not reach the upload service.');
      },
    );

    await Promise.all([filesPromise, rosterPromise]);
  }, [refreshFiles]);

  useEffect(() => {
    refreshStore();
  }, [refreshStore]);

  // The year the page is about: from the ingested roster when there is one,
  // otherwise the fallback, so nothing ever renders "Glastonbury undefined".
  const year = runningOrder && Number.isInteger(runningOrder.year) ? runningOrder.year : DEFAULT_YEAR;

  const tabProps = (id) => ({
    id: `tab-${id}`,
    className: 'tab-panel',
    role: 'tabpanel',
    hidden: activeTab !== id,
  });

  return (
    <div className="bus-wankers-page" id="top">
      <div {...tabProps('update-files')}>
        <IngestBar onIngested={refreshStore} />
      </div>
      <div {...tabProps('documentation')}>
        <DocumentationSection
          year={year}
          storedFiles={storedFiles}
          storeStatus={storeStatus}
          storeError={storeError}
          saleType={saleType}
          onSaleTypeChange={setSaleType}
          runningOrder={runningOrder}
          onRecheckFiles={recheckFiles}
        />
      </div>
      <div {...tabProps('groups')}>
        <GroupsSection
          year={year}
          storedFiles={storedFiles}
          storeStatus={storeStatus}
          storeError={storeError}
          saleType={saleType}
          onSaleTypeChange={setSaleType}
          runningOrder={runningOrder}
        />
      </div>
      <div {...tabProps('running-order')}>
        <RunningOrderSection
          year={year}
          runningOrder={runningOrder}
          status={runningOrderStatus}
          error={runningOrderError}
          storedFiles={storedFiles}
          storeStatus={storeStatus}
          storeError={storeError}
        />
      </div>

      <div {...tabProps('test-form')}>
        <TestSection year={year} />
      </div>
      <div {...tabProps('launch')}>
        <LaunchSection year={year} />
      </div>
    </div>
  );
};

export default BusWankersPage;
