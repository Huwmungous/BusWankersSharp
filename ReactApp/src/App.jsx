import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Navigation from './components/Navigation';
import BusWankersPage from './components/BusWankersPage';
import TestPage from './components/TestPage';
import UploadPage from './components/UploadPage';
import './App.css';

function App() {
  return (
    <HashRouter>
      <div className="App">
        <Navigation />
        <Routes>
          <Route path="/" element={<BusWankersPage />} />
          <Route path="/test" element={<TestPage />} />
          <Route path="/upload" element={<UploadPage />} />
        </Routes>
      </div>
    </HashRouter>
  );
}

export default App;
