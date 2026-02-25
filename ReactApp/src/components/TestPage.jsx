import React from 'react';
import './TestPage.css';

const TestPage = () => {
  return (
    <div className="test-page">
      <div className="container">
        <h1>Glastonbury Registration Form Test Page</h1>
        <p>This is a mockup of the Glastonbury registration form for testing purposes.</p>
        
        <div className="form-container">
          <h2>Registration Details</h2>
          
          <div className="form-group">
            <label>Registration Number:</label>
            <input type="text" className="form-input" placeholder="Enter registration number" />
          </div>
          
          <div className="form-group">
            <label>Postcode:</label>
            <input type="text" className="form-input" placeholder="Enter postcode" />
          </div>
          
          <div className="form-group">
            <label>Additional Registrations (up to 3 more)</label>
            <div className="additional-registrations">
              <div className="registration-item">
                <label>Registration Number:</label>
                <input type="text" className="form-input" placeholder="Enter registration number" />
              </div>
              <div className="registration-item">
                <label>Postcode:</label>
                <input type="text" className="form-input" placeholder="Enter postcode" />
              </div>
            </div>
          </div>
          
          <button className="submit-button">Proceed</button>
        </div>
      </div>
    </div>
  );
};

export default TestPage;