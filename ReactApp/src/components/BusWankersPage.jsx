import React, { useState } from 'react';
import './BusWankersPage.css';

const pub = process.env.PUBLIC_URL;

// Two separate sales use two separate autofill files - keep the filename,
// dates and (where known) cost tied to whichever tab is selected so nobody
// downloads/imports the wrong one.
const SALE_INFO = {
  coach: {
    label: 'Coach Tickets',
    shortLabel: 'Coach + Ticket Package Sale',
    heading: 'This is the 2027 Glastonbury Coach Ticket Autofill File',
    filename: 'bw_autofill.csv',
    dates: [
      'Registration deadline: 5:00pm BST, Friday 25th September 2026',
      'Coach + ticket package sale: 6:00pm BST, Thursday 1st October 2026',
    ],
    cost: null,
  },
  general: {
    label: 'General Sale',
    shortLabel: 'General Sale',
    heading: 'This is the 2027 Glastonbury General Sale Autofill File',
    filename: 'g_autofill.csv',
    dates: [
      'Registration deadline: 5:00pm BST, Friday 25th September 2026',
      'General sale (standard tickets): 9:00am BST, Sunday 4th October 2026',
    ],
    cost: [
      "General Admission tickets (valid Wed 23rd – Sun 27th June 2027): £408 (including a £5 booking fee per ticket) plus postage and packing",
      "Deposit is £100 per person — for a 6-person group that's £600 you need in your account on ticket buying day",
    ],
  },
};

const BusWankersPage = () => {
  const [saleType, setSaleType] = useState('coach');
  const info = SALE_INFO[saleType];

  return (
    <div className="bus-wankers-page">
      <div className="container">
        <div className="sale-tabs" role="tablist" aria-label="Ticket sale type">
          {Object.entries(SALE_INFO).map(([key, tab]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={saleType === key}
              className={`sale-tab${saleType === key ? ' active' : ''}`}
              onClick={() => setSaleType(key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <h1>{info.heading}</h1>
        <h2>Use this file to populate your Autofill Options</h2>

        <div className="key-dates">
          <h3>Key Dates for the 2027 {info.shortLabel}</h3>
          <ul>
            {info.dates.map((d) => <li key={d}>{d}</li>)}
          </ul>
          {info.cost && (
            <ul className="cost-info">
              {info.cost.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
        </div>

        <div className="image-container">
          <img src={`${pub}/Hippies_1.png`} alt="ImportExport" className="image-with-shadow" />
        </div>

        <h4>In AutoFill Options you will see a band of tabs across the top. You should be on the Sync tab to start.</h4>

        <div className="image-container">
          <img src={`${pub}/sync.png`} alt="Sync" className="image-with-shadow" />
        </div>

        <br />

        <h4>You can enter the following "https://longmanrd.net/buswankers/{info.filename}" into the Remote Import box and click Import.</h4>

        <h4>OR</h4>

        <h4>
          You can click{' '}
          <a href={`${pub}/${info.filename}`} download={info.filename}>this link</a>
          {' '}to download the {info.label.toLowerCase()} autofill file and save it, you then click on the Import button under Import/Export, and browse to where you've saved the file
        </h4>

        <br />

        <h4>
          After you've completed either of the above you then need to click on the "Forms Field" tab, scroll to the bottom and click save.
          <br /><br />
          You will see a green dialogue box pop up at the top of the page telling you the import was successful (or not)
        </h4>

        <br />

        <div className="image-container">
          <img src={`${pub}/formfield.png`} alt="Form Fields" className="image-with-shadow" />
        </div>

        <br />

        <h4>If the import was successful you should see registrations and postcodes appearing in the 'value' column.</h4>

        <h4>
          You Can Test Your AutoFill on a mockup of the Glasto Registration Form by{' '}
          <a href={`${pub}/#/test`}>clicking here</a>.
        </h4>

        <h4>Becca Productions Inc.</h4>

        <div className="video-container">
          <video controls width="640" height="360">
            <source src={`${pub}/DannyVid.mp4`} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </div>
  );
};

export default BusWankersPage;
