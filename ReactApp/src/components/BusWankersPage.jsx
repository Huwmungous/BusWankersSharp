import React, { useCallback, useEffect, useState } from 'react';
import DocumentationSection from './DocumentationSection';
import IngestBar from './IngestBar';
import TestSection from './TestSection';
import UploadSection from './UploadSection';
import { fetchStoredFiles } from '../api/autofillApi';
import './BusWankersPage.css';

// The whole site is one page: upload a spreadsheet at the very top to refresh
// the live autofill files, pick your autofill file just below that, test it
// further down, and (password-protected) generate a one-off file from a
// spreadsheet at the bottom. Each section owns its own styling/markup - this
// lays them out in order and owns the one bit of state two of them share:
// which autofill files actually exist in the backend's store right now, so
// the dropdown can flag empty ones and an ingest can refresh it.
const BusWankersPage = () => {
  const [storedFiles, setStoredFiles] = useState(new Map());
  const [storeStatus, setStoreStatus] = useState('loading'); // loading | ready | error
  const [storeError, setStoreError] = useState('');

  const refreshStore = useCallback(async () => {
    try {
      const files = await fetchStoredFiles();
      setStoredFiles(files);
      setStoreStatus('ready');
      setStoreError('');
    } catch (err) {
      setStoreStatus('error');
      setStoreError(err.message || 'Could not reach the upload service.');
    }
  }, []);

  useEffect(() => {
    refreshStore();
  }, [refreshStore]);

  return (
    <div className="bus-wankers-page" id="top">
      <IngestBar onIngested={refreshStore} />
      <DocumentationSection storedFiles={storedFiles} storeStatus={storeStatus} storeError={storeError} />
      <TestSection />
      <UploadSection />
    </div>
  );
};

export default BusWankersPage;
