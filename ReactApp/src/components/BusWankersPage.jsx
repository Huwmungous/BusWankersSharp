import React from 'react';
import './BusWankersPage.css';

const pub = process.env.PUBLIC_URL;

const BusWankersPage = () => {
  return (
    <div className="bus-wankers-page">
      <div className="container">
        <h1>This is the 2025 Glastonbury General Sale Autofill File</h1>
        <h2>Use this file to populate your Autofill Options</h2>

        <div className="image-container">
          <img src={`${pub}/Hippies_1.png`} alt="ImportExport Image" className="image-with-shadow" />
        </div>

        <h4>In AutoFill Options you will see a band of tabs across the top. You should be on the Sync tab to start.</h4>

        <div className="image-container">
          <img src={`${pub}/sync.png`} alt="sync Image" className="image-with-shadow" />
        </div>

        <br />

        <h4>You can enter the following "https://longmanrd.net/buswankers/g_autofill.csv" into the Remote Import box and click Import.</h4>

        <h4>OR</h4>

        <h4>
          You can click{' '}
          <a href={`${pub}/g_autofill.csv`} download="g_autofill.csv">this link</a>
          {' '}to download autofill file and save it, you then click on the Import button under Import/Export, and browse to where you've saved the file
        </h4>

        <h1>NB: !!! the filename is different for general sale; 'g_autofill' NOT 'bw_autofill'</h1>

        <br />

        <h4>
          After you've completed either of the above you then need to click on the "Forms Field" tab, scroll to the bottom and click save.
          <br /><br />
          You will see a green dialogue box pop up at the top of the page telling you the import was successful (or not)
        </h4>

        <br />

        <div className="image-container">
          <img src={`${pub}/formfield.png`} alt="Form Fields Image" className="image-with-shadow" />
        </div>

        <br />

        <h4>If the import was successful you should see registrations and postcodes appearing in the 'value' column.</h4>

        <h4>
          You Can Test Your AutoFill on a mockup of the Glasto Registration Form by{' '}
          <a href={`${pub}/test_page.html`}>clicking here</a>.
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
