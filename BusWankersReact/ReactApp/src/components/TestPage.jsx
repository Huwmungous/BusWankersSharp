import React, { useState } from 'react';
import './TestPage.css';

// Mirrors Common/BusWankers.cs DEFAULT_MAX_IN_A_GROUP - one "main" registration
// plus up to 5 additional, for a maximum of 6 people per group/coach.
const MAX_IN_A_GROUP = 6;

const emptyRegistrations = () =>
  Array.from({ length: MAX_IN_A_GROUP }, () => ({ registrationId: '', postCode: '' }));

const TestPage = () => {
  const [registrations, setRegistrations] = useState(emptyRegistrations());

  const updateField = (index, field, value) => {
    setRegistrations((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const clearForm = () => {
    if (window.confirm('Are you sure you want to clear the registration details form?')) {
      setRegistrations(emptyRegistrations());
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Test mockup only - there is nothing to submit to. This exists purely so the
    // AutoFill Options extension has real registrations_N__RegistrationId /
    // registrations_N__PostCode fields to sync its 2027 General Sale profile against.
    window.alert('This is a test mockup - nothing is actually submitted.');
  };

  return (
    <div className="test-page">
      <div className="container">
        <h1>Glastonbury 2027 Registration Form Test Page</h1>
        <p>
          This is a mockup of the Glastonbury General Sale registration form, used to test
          the AutoFill Options 2027 General Sale profile before the real sale opens at
          9:00am BST on Sunday 4th October 2026.
        </p>

        <form className="form-container" onSubmit={handleSubmit}>
          <h2>Your Details</h2>
          <div className="form-group">
            <label htmlFor="registrations_0__RegistrationId">Registration Number:</label>
            <input
              id="registrations_0__RegistrationId"
              name="registrations[0].RegistrationId"
              type="text"
              className="form-input"
              placeholder="Enter registration number"
              value={registrations[0].registrationId}
              onChange={(e) => updateField(0, 'registrationId', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="registrations_0__PostCode">Postcode:</label>
            <input
              id="registrations_0__PostCode"
              name="registrations[0].PostCode"
              type="text"
              className="form-input"
              placeholder="Enter postcode"
              value={registrations[0].postCode}
              onChange={(e) => updateField(0, 'postCode', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Additional Registrations (up to {MAX_IN_A_GROUP - 1} more)</label>
            <div className="additional-registrations">
              {registrations.slice(1).map((reg, i) => {
                const index = i + 1;
                return (
                  <div className="registration-pair" key={index}>
                    <span className="guest-count">#{index}</span>
                    <div className="registration-item">
                      <label htmlFor={`registrations_${index}__RegistrationId`}>
                        Registration Number:
                      </label>
                      <input
                        id={`registrations_${index}__RegistrationId`}
                        name={`registrations[${index}].RegistrationId`}
                        type="text"
                        className="form-input"
                        placeholder="Enter registration number"
                        value={reg.registrationId}
                        onChange={(e) => updateField(index, 'registrationId', e.target.value)}
                      />
                    </div>
                    <div className="registration-item">
                      <label htmlFor={`registrations_${index}__PostCode`}>Postcode:</label>
                      <input
                        id={`registrations_${index}__PostCode`}
                        name={`registrations[${index}].PostCode`}
                        type="text"
                        className="form-input"
                        placeholder="Enter postcode"
                        value={reg.postCode}
                        onChange={(e) => updateField(index, 'postCode', e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button type="submit" className="submit-button">Proceed</button>

          <p className="clear-form">
            <a href="#/test" onClick={(e) => { e.preventDefault(); clearForm(); }}>
              Clear registration form
            </a>
          </p>
        </form>
      </div>
    </div>
  );
};

export default TestPage;
