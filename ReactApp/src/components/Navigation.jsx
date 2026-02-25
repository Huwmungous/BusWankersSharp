import React from 'react';
import { Link } from 'react-router-dom';
import './Navigation.css';

const Navigation = () => {
  return (
    <nav className="navigation">
      <div className="nav-container">
        <Link to="/" className="nav-logo">Bus Wankers</Link>
        <ul className="nav-menu">
          <li className="nav-item">
            <Link to="/" className="nav-link">Documentation</Link>
          </li>
          <li className="nav-item">
            <Link to="/test" className="nav-link">Test Form</Link>
          </li>
        </ul>
      </div>
    </nav>
  );
};

export default Navigation;