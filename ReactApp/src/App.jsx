import React from 'react';
import Navigation from './components/Navigation';
import BusWankersPage from './components/BusWankersPage';
import './App.css';

// One page with tabs (see src/tabs.js and BusWankersPage). No router: the
// active tab is the URL hash (#documentation, #test-form, ...), so tabs are
// bookmarkable and plain <a href="#..."> links switch between them.
function App() {
  return (
    <div className="App">
      <Navigation />
      <BusWankersPage />
    </div>
  );
}

export default App;
