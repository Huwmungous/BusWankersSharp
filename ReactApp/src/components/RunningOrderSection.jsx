import React, { useMemo } from 'react';
import { useAutofillGroups } from '../useAutofillGroups';
import { buildGroupLookup, groupLabelForRegistration } from '../runningOrder';
import { SALE_INFO } from '../saleInfo';
import './RunningOrderSection.css';

const formatWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};

const SALE_KEYS = Object.keys(SALE_INFO);

// The "Glasto nnnn Running Order" tab: everyone on the workbook's roster
// sheet (the "Glasto nnnn" tab, named for the festival year) as of the last
// ingest, in surname order, with their reg number, plus one column per sale
// (2026-09-18) showing which group - if any - that person is in for that
// sale. Rendered as a native <details> (open by default now it has a tab of
// its own) so it can still be collapsed and needs no state of its own.
//
// runningOrder: { year, sheet, generatedAt, entries: [{ regNumber, firstName,
// lastName, name }] } from GET /running-order, or null when no roster has been
// ingested yet. `year` is passed separately because the page falls back to a
// default when there's no roster, and the heading should still read sensibly.
//
// storedFiles/storeStatus/storeError: the same shared file-store state
// BusWankersPage already threads through to DocumentationSection/
// GroupsSection - needed here too because a per-sale group column has to
// load ALL five sales' groups, not just whichever one is currently selected
// elsewhere on the page. useAutofillGroups is called once per SALE_INFO
// entry (a fixed, static list, so this is a normal - not conditional -
// number of hook calls) so each sale's groups load and cache exactly the
// way Documentation/Groups already do, rather than a second, diverging
// fetch path.
const RunningOrderSection = ({
  year,
  runningOrder = null,
  status = 'loading',
  error = '',
  storedFiles = new Map(),
  storeStatus = 'loading',
  storeError = '',
}) => {
  const entries = runningOrder ? runningOrder.entries : [];
  const count = entries.length;
  const title = `Glasto ${year} Running Order`;

  // One useAutofillGroups call per sale - SALE_INFO has a fixed, known set
  // of keys, so this is the same fixed number of hooks on every render.
  const coach = useAutofillGroups(SALE_INFO.Coach.filename, storedFiles, storeStatus, storeError);
  const general = useAutofillGroups(SALE_INFO.General.filename, storedFiles, storeStatus, storeError);
  const resaleCoach = useAutofillGroups(SALE_INFO['Resale - Coach'].filename, storedFiles, storeStatus, storeError);
  const resaleGeneral = useAutofillGroups(SALE_INFO['Resale - General'].filename, storedFiles, storeStatus, storeError);
  const demo = useAutofillGroups(SALE_INFO.Demo.filename, storedFiles, storeStatus, storeError);

  const groupsBySale = {
    Coach: coach,
    General: general,
    'Resale - Coach': resaleCoach,
    'Resale - General': resaleGeneral,
    Demo: demo,
  };

  // registrationNumber -> group letter, one lookup per sale, rebuilt only
  // when that sale's own groups actually change (not on every render, and
  // not when a DIFFERENT sale's groups load).
  const lookupsBySale = useMemo(() => {
    const out = {};
    for (const key of SALE_KEYS) {
      out[key] = buildGroupLookup(groupsBySale[key].groups);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach.groups, general.groups, resaleCoach.groups, resaleGeneral.groups, demo.groups]);

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
              {runningOrder.generatedAt ? ` - last updated ${formatWhen(runningOrder.generatedAt)}` : ''}. The
              sale columns show which group (if any) each person is in for that sale, once its file has been
              uploaded on the Update Files tab.
            </p>
            <table className="running-order-table">
              <thead>
                <tr>
                  <th className="running-order-pos">#</th>
                  <th>Reg Number</th>
                  <th>Name</th>
                  {SALE_KEYS.map((key) => (
                    <th key={key} className="running-order-group-col" title={SALE_INFO[key].label}>
                      {SALE_INFO[key].folderLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.regNumber}-${i}`}>
                    <td className="running-order-pos">{i + 1}</td>
                    <td className="running-order-reg">{e.regNumber}</td>
                    <td>{e.name || [e.firstName, e.lastName].filter(Boolean).join(' ')}</td>
                    {SALE_KEYS.map((key) => {
                      const label = groupLabelForRegistration(lookupsBySale[key], e.regNumber);
                      return (
                        <td key={key} className="running-order-group-cell">
                          {label || <span className="running-order-group-empty">—</span>}
                        </td>
                      );
                    })}
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
