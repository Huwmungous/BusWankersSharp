import React, { useMemo } from 'react';
import { useAutofillGroups } from '../useAutofillGroups';
import {
  buildGroupLookup,
  groupLabelForRegistration,
  buildPostcodeLookup,
  postcodeForRegistration,
  combinePostcodes,
} from '../runningOrder';
import { SALE_INFO } from '../saleInfo';
import './RunningOrderSection.css';

const formatWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};

// Demo is a testing-only "sale" (see SALE_INFO.Demo) - nobody's actually
// booked into it, so unlike Documentation/Groups (which still offer it for
// testing), the Running Order table doesn't get a column for it (Hugh,
// 2026-09-18: "demo should not appear") - just the 4 real sales.
const SALE_KEYS = Object.keys(SALE_INFO).filter((key) => key !== 'Demo');
// The "Glasto nnnn Running Order" tab: everyone on the workbook's roster
// sheet (the "Glasto nnnn" tab, named for the festival year) as of the last
// ingest, in surname order, with their reg number and postcode, plus one
// column per real sale (2026-09-18; Demo excluded) showing which group - if
// any - that person is in for that sale. Rendered as a native <details>
// (open by default now it has a tab of its own) so it can still be
// collapsed and needs no state of its own.
//
// Postcode (2026-09-19): the roster sheet itself turns out not to carry a
// Postcode column in Hugh's real workbooks - RosterReader.cs reads one when
// present, but for now e.postCode from GET /running-order is always ''. So
// the cell is built from the per-sale group files instead (they do carry
// it - see buildPostcodeLookup/combinePostcodes in src/runningOrder.js),
// the same files the group columns already load. Someone in more than one
// sale can have their postcode typed in independently for each, so when
// two sales disagree the cell shows a conflict warning (title tooltip
// lists every sale's value) rather than silently picking one.
//
// Invalid postcodes (2026-09-18): combinePostcodes also checks each
// source's value against isValidUkPostcode (a shape check, not a real
// deliverability lookup - see its doc comment). A single agreed value that
// fails that check renders with the "invalid format" warning style rather
// than as a normal postcode; a conflict where one or more of the clashing
// values is also malformed notes that in the tooltip alongside the clash
// itself, rather than as a separate warning.

//
// runningOrder: { year, sheet, generatedAt, entries: [{ regNumber, firstName,
// lastName, name, postCode }] } from GET /running-order, or null when no
// roster has been ingested yet. `year` is passed separately because the
// page falls back to a default when there's no roster, and the heading
// should still read sensibly.
//
// storedFiles/storeStatus/storeError: the same shared file-store state
// BusWankersPage already threads through to DocumentationSection/
// GroupsSection - needed here too because a per-sale group column has to
// load all four real sales' groups, not just whichever one is currently
// selected elsewhere on the page. useAutofillGroups is called once per real
// sale (a fixed, static list, so this is a normal - not conditional -
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

  // One useAutofillGroups call per REAL sale (Demo excluded - see SALE_KEYS
  // above) - a fixed, known set of keys, so this is the same fixed number of
  // hooks on every render.
  const coach = useAutofillGroups(SALE_INFO.Coach.filename, storedFiles, storeStatus, storeError);
  const general = useAutofillGroups(SALE_INFO.General.filename, storedFiles, storeStatus, storeError);
  const resaleCoach = useAutofillGroups(SALE_INFO['Resale - Coach'].filename, storedFiles, storeStatus, storeError);
  const resaleGeneral = useAutofillGroups(SALE_INFO['Resale - General'].filename, storedFiles, storeStatus, storeError);

  const groupsBySale = {
    Coach: coach,
    General: general,
    'Resale - Coach': resaleCoach,
    'Resale - General': resaleGeneral,
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
  }, [coach.groups, general.groups, resaleCoach.groups, resaleGeneral.groups]);

  // registrationNumber -> postcode, one lookup per sale, same shape and
  // same dependency rules as lookupsBySale above - built from the same
  // per-sale groups, just pulling postCode instead of the group letter.
  const postcodeLookupsBySale = useMemo(() => {
    const out = {};
    for (const key of SALE_KEYS) {
      out[key] = buildPostcodeLookup(groupsBySale[key].groups);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach.groups, general.groups, resaleCoach.groups, resaleGeneral.groups]);


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
                  <th>Postcode</th>
                  {SALE_KEYS.map((key) => (
                    <th key={key} className="running-order-group-col" title={SALE_INFO[key].label}>
                      {SALE_INFO[key].folderLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  // Postcode: gathered from every real sale this person is
                  // in, plus the roster's own Postcode column when that
                  // sheet has one (currently always blank - see the doc
                  // comment above). combinePostcodes flags a genuine
                  // disagreement between sources rather than silently
                  // picking one, and separately flags a value (agreed or
                  // not) that isn't shaped like a real UK postcode.
                  const postcodeSources = SALE_KEYS
                    .map((key) => ({
                      source: SALE_INFO[key].folderLabel,
                      value: postcodeForRegistration(postcodeLookupsBySale[key], e.regNumber),
                    }))
                    .filter((s) => s.value);
                  if (e.postCode) postcodeSources.push({ source: 'roster', value: e.postCode });
                  const postcodeInfo = combinePostcodes(postcodeSources);

                  const postcodeCellClass = postcodeInfo.conflict
                    ? ' running-order-postcode-conflict'
                    : postcodeInfo.invalid
                      ? ' running-order-postcode-invalid'
                      : '';
                  const postcodeTitle = postcodeInfo.conflict
                    ? `Postcodes don't match:\n${postcodeInfo.sources
                        .map((s) => `${s.source}: ${s.value}${s.invalid ? ' (invalid format)' : ''}`)
                        .join('\n')}`
                    : postcodeInfo.invalid
                      ? "Doesn't look like a valid UK postcode"
                      : undefined;

                  return (
                    <tr key={`${e.regNumber}-${i}`}>
                      <td className="running-order-pos">{i + 1}</td>
                      <td className="running-order-reg">{e.regNumber}</td>
                      <td>{e.name || [e.firstName, e.lastName].filter(Boolean).join(' ')}</td>
                      <td className={`running-order-postcode${postcodeCellClass}`} title={postcodeTitle}>
                        {postcodeInfo.conflict ? (
                          '⚠ conflict'
                        ) : postcodeInfo.value ? (
                          <>
                            {postcodeInfo.value}
                            {postcodeInfo.invalid ? ' ⚠' : ''}
                          </>
                        ) : (
                          <span className="running-order-group-empty">—</span>
                        )}
                      </td>

                      {SALE_KEYS.map((key) => {
                        const label = groupLabelForRegistration(lookupsBySale[key], e.regNumber);
                        return (
                          <td key={key} className="running-order-group-cell">
                            {label || <span className="running-order-group-empty">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

              </tbody>
            </table>
          </>
        )}
      </details>
    </section>
  );
};

export default RunningOrderSection;
