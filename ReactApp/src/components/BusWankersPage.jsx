import React, { useCallback, useEffect, useState } from 'react';
import DocumentationSection from './DocumentationSection';
import IngestBar from './IngestBar';
import RunningOrderSection from './RunningOrderSection';
import TestSection from './TestSection';
import UploadSection from './UploadSection';
import { fetchRunningOrder, fetchStoredFiles } from '../api/autofillApi';
import { DEFAULT_YEAR } from '../festival';
import './BusWankersPage.css';

// The whole site is one page: upload a spreadsheet at the very top to refresh
// the live autofill files, see who's on this year's roster just below that,
// pick your autofill file, test it further down, and (password-protected)
// generate a one-off file from a spreadsheet at the bottom. Each section owns
// its own styling/markup - this lays them out in order and owns the state
// they share: which autofill files actually exist in the backend's store
// right now (so the dropdown can flag empty ones and an ingest can refresh
// it), and the roster from the last ingest, which is where the festival year
// the whole page talks about comes from.
const BusWankersPage = () => {
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

  return (
    <div className="bus-wankers-page" id="top">
      <IngestBar onIngested={refreshStore} />
      <RunningOrderSection
        year={year}
        runningOrder={runningOrder}
        status={runningOrderStatus}
        error={runningOrderError}
      />
      <DocumentationSection year={year} storedFiles={storedFiles} storeStatus={storeStatus} storeError={storeError} />
      <TestSection year={year} />
      <UploadSection />
    </div>
  );
};

export default BusWankersPage;
