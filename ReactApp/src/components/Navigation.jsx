import React from 'react';
import './Navigation.css';

// Everything lives on one page now, so these are in-page anchor jumps to the
// Test and Upload sections rather than routes.
const Navigation = () => {
  return (
    <nav className="navigation">
      <div className="nav-container">
        <a href="#top" className="nav-logo">Bus Wankers</a>
        <ul className="nav-menu">
          <li className="nav-item">
            <a href="#top" className="nav-link">Documentation</a>
          </li>
          <li className="nav-item">
            <a href="#test-section" className="nav-link">Test Form</a>
          </li>
          <li className="nav-item">
            <a href="#upload-section" className="nav-link">Generate Autofill</a>
          </li>
        </ul>
      </div>
    </nav>
  );
};

export default Navigation;
