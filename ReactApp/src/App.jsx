import React from 'react';
import Navigation from './components/Navigation';
import BusWankersPage from './components/BusWankersPage';
import './App.css';

// One page now - Documentation, Test Form and Upload all live as sections on
// it (see BusWankersPage). No router needed for a single page; in-page anchor
// links (#test-section / #upload-section) handle jumping around it.
function App() {
  return (
    <div className="App">
      <Navigation />
      <BusWankersPage />
    </div>
  );
}

export default App;
