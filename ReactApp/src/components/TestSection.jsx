import React, { useRef, useState } from 'react';
import './TestSection.css';

// Mirrors Common/BusWankers.cs DEFAULT_MAX_IN_A_GROUP - one "main" registration
// plus up to 5 additional, for a maximum of 6 people per group/coach.
const MAX_IN_A_GROUP = 6;

const SLOTS = Array.from({ length: MAX_IN_A_GROUP }, (_, i) => i);

// The registration-form mockup the AutoFill Options extension fills in.
//
// The inputs here are deliberately UNCONTROLLED (no value/onChange, no React
// state behind them). The extension fills a field by setting its .value and
// firing input/change events - which React's controlled-input machinery
// doesn't recognise as a user edit, so the React state stayed empty and the
// next re-render (typing in any other box) wiped the autofilled values back
// to ''. That is exactly what made "the test page doesn't work" (2026-09-16).
// With plain inputs the DOM is the only source of truth, so whatever the
// extension puts in stays put; Proceed reads the form directly and shows what
// it found, so the person can see the autofill actually landed.
//
// The ids/names must stay as they are: registrations_N__RegistrationId and
// registrations_N__PostCode are what the generated autofill rules target
// (Common/BusWankers.cs - the rule name is matched case-insensitively against
// id and name, so "Postcode" there vs "PostCode" here is fine).
//
// year: the festival year the page is about (from BusWankersPage - the
// ingested roster's "Glasto nnnn" sheet, or the fallback).
const TestSection = ({ year }) => {
  const formRef = useRef(null);
  const [readout, setReadout] = useState(null); // null | { filled: [{slot, registrationId, postCode}], blank: number }

  const readForm = () => {
    const form = formRef.current;
    if (!form) return { filled: [], blank: MAX_IN_A_GROUP };
    const data = new FormData(form);
    const filled = [];
    let blank = 0;
    for (const slot of SLOTS) {
      const registrationId = String(data.get(`registrations[${slot}].RegistrationId`) || '').trim();
      const postCode = String(data.get(`registrations[${slot}].PostCode`) || '').trim();
      if (registrationId || postCode) filled.push({ slot, registrationId, postCode });
      else blank++;
    }
    return { filled, blank };
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Test mockup only - there is nothing to submit to. Show what the form
    // holds so the person can confirm the extension filled the right people.
    setReadout(readForm());
  };

  const clearForm = () => {
    if (formRef.current) formRef.current.reset();
    setReadout(null);
  };

  return (
    <section className="test-section" id="test-section" aria-label="Test your autofill">
      <div className="container">
        <h2>Glastonbury {year} Registration Form Test Page</h2>
        <p>
          This is a mockup of the Glastonbury General Sale registration form, used to test
          the AutoFill Options {year} General Sale profile before the real sale opens at
          9:00am BST on Sunday 4th October 2026.
        </p>
        <p className="test-hint">
          With your autofill file imported into AutoFill Options, pick your group&rsquo;s
          profile in the extension and the boxes below should fill themselves in. If they
          don&rsquo;t fill on their own, click the AutoFill Options icon and choose your
          group, then click <strong>Proceed</strong> to see what was filled in.
        </p>

        <form ref={formRef} className="form-container" onSubmit={handleSubmit} autoComplete="off">
          <h3>Your Details</h3>
          <div className="form-group">
            <label htmlFor="registrations_0__RegistrationId">Registration Number:</label>
            <input
              id="registrations_0__RegistrationId"
              name="registrations[0].RegistrationId"
              type="text"
              className="form-input"
              placeholder="Enter registration number"
              defaultValue=""
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
              defaultValue=""
            />
          </div>

          <div className="form-group">
            <label>Additional Registrations (up to {MAX_IN_A_GROUP - 1} more)</label>
            <div className="additional-registrations">
              {SLOTS.slice(1).map((index) => (
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
                      defaultValue=""
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
                      defaultValue=""
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" className="submit-button">Proceed</button>

          <p className="clear-form">
            <a href="#test-form" onClick={(e) => { e.preventDefault(); clearForm(); }}>
              Clear registration form
            </a>
          </p>
        </form>

        {readout && (
          <div className="test-readout" role="status" aria-live="polite">
            <h3>What the form contains</h3>
            <p className="test-readout-note">
              Nothing is submitted from this page - this is just what AutoFill Options (or you) put in the boxes.
            </p>
            {readout.filled.length === 0 ? (
              <p className="test-readout-empty">
                Every box is empty. If you expected the extension to fill them, check that the autofill
                file has been imported and that the right group profile is selected in AutoFill Options.
              </p>
            ) : (
              <table className="test-readout-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Registration Number</th>
                    <th>Postcode</th>
                  </tr>
                </thead>
                <tbody>
                  {readout.filled.map((r) => (
                    <tr key={r.slot}>
                      <td>{r.slot}</td>
                      <td className="test-readout-mono">{r.registrationId || <em>blank</em>}</td>
                      <td className="test-readout-mono">{r.postCode || <em>blank</em>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {readout.filled.length > 0 && readout.blank > 0 && (
              <p className="test-readout-note">
                {readout.blank} of the {MAX_IN_A_GROUP} slots {readout.blank === 1 ? 'is' : 'are'} empty - normal for a group of fewer than {MAX_IN_A_GROUP}.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default TestSection;
