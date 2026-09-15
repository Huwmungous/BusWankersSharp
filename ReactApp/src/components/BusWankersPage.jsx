import React from 'react';
import DocumentationSection from './DocumentationSection';
import TestSection from './TestSection';
import UploadSection from './UploadSection';
import './BusWankersPage.css';

// The whole site is one page now: pick your autofill file at the top, test it
// further down, and (password-protected) generate a new one from a spreadsheet
// at the bottom. Each section owns its own styling/markup - this just lays
// them out in order.
const BusWankersPage = () => {
  return (
    <div className="bus-wankers-page" id="top">
      <DocumentationSection />
      <TestSection />
      <UploadSection />
    </div>
  );
};

export default BusWankersPage;
