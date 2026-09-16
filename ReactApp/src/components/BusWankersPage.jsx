import React, { useCallback, useEffect, useState } from 'react';
import DocumentationSection from './DocumentationSection';
import IngestBar from './IngestBar';
import LaunchSection from './LaunchSection';
import RunningOrderSection from './RunningOrderSection';
import TestSection from './TestSection';
import { fetchRunningOrder, fetchStoredFiles } from '../api/autofillApi';
import { DEFAULT_YEAR } from '../festival';
import { useActiveTab } from '../tabs';
import './BusWankersPage.css';

// The site is one page with five tabs (see src/tabs.js): Update Files (upload
// a spreadsheet to refresh the live autofill files), Documentation (the
// landing tab - pick and download your autofill file), Running Order (who's
// on this year's roster), Test Form (a mockup of the registration form) and
// Launch (arm this browser to jump to the ticket page at the sale time).
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

  const refreshStore = useCallback(async () => {
    // The two fetches are independent: a running-order problem must not hide
    // the autofill files, and vice versa, so each settles its own state.
    const filesPromise = fetchStoredFiles().then(
      (files) => {
        setStoredFiles(files);
        setStoreStatus('ready');
        setStoreError('');
      },
      (err) => {
        setStoreStatus('error');
        setStoreError(err.message || 'Could not reach the upload service.');
      },
    );

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
  }, []);

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
        <DocumentationSection year={year} storedFiles={storedFiles} storeStatus={storeStatus} storeError={storeError} />
      </div>
      <div {...tabProps('running-order')}>
        <RunningOrderSection
          year={year}
          runningOrder={runningOrder}
          status={runningOrderStatus}
          error={runningOrderError}
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
