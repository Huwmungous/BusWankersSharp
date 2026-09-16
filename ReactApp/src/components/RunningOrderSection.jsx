import React from 'react';
import './RunningOrderSection.css';

const formatWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};

// The "Glasto nnnn Running Order" tab: everyone on the workbook's roster
// sheet (the "Glasto nnnn" tab, named for the festival year) as of the last
// ingest, in surname order, with their reg number. Rendered as a native
// <details> (open by default now it has a tab of its own) so it can still be
// collapsed and needs no state of its own.
//
// runningOrder: { year, sheet, generatedAt, entries: [{ regNumber, firstName,
// lastName, name }] } from GET /running-order, or null when no roster has been
// ingested yet. `year` is passed separately because the page falls back to a
// default when there's no roster, and the heading should still read sensibly.
const RunningOrderSection = ({ year, runningOrder = null, status = 'loading', error = '' }) => {
  const entries = runningOrder ? runningOrder.entries : [];
  const count = entries.length;
  const title = `Glasto ${year} Running Order`;

  let note = null;
  if (status === 'loading') {
    note = 'Loading the running order…';
  } else if (status === 'error') {
    note = `Couldn't load the running order: ${error}`;
  } else if (!runningOrder) {
    note = `No 'Glasto ${year}' worksheet has been ingested yet - upload a spreadsheet on the Update Files tab.`;
  } else if (count === 0) {
    note = `'${runningOrder.sheet}' has nobody with a Reg Number on it.`;
  }

  return (
    <section className="running-order" aria-label={title}>
      <details className="running-order-details" open>
        <summary className="running-order-summary">
          <span className="running-order-title">{title}</span>
          {runningOrder && count > 0 && (
            <span className="running-order-count">
              {count} {count === 1 ? 'person' : 'people'}
            </span>
          )}
        </summary>

        {note && <p className={`running-order-note${status === 'error' ? ' running-order-error' : ''}`}>{note}</p>}

        {runningOrder && count > 0 && (
          <>
            <p className="running-order-note">
              From the &lsquo;{runningOrder.sheet}&rsquo; worksheet, in surname order
              {runningOrder.generatedAt ? ` - last updated ${formatWhen(runningOrder.generatedAt)}` : ''}.
            </p>
            <table className="running-order-table">
              <thead>
                <tr>
                  <th className="running-order-pos">#</th>
                  <th>Reg Number</th>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.regNumber}-${i}`}>
                    <td className="running-order-pos">{i + 1}</td>
                    <td className="running-order-reg">{e.regNumber}</td>
                    <td>{e.name || [e.firstName, e.lastName].filter(Boolean).join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </details>
    </section>
  );
};

export default RunningOrderSection;
