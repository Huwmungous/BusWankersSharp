import React, { useState } from 'react';
import { CopyButton, copyText } from './GroupFillPanel';
import { useAutofillGroups } from '../useAutofillGroups';
import { SALE_INFO, formatWhen } from '../saleInfo';
import { DEFAULT_YEAR } from '../festival';
import './GroupsSection.css';

// Plain-text rendering of one group, for the "Copy whole group" button - one
// line per person, tab-separated so it also pastes cleanly into a
// spreadsheet. Slot 0 is always "Your Details" to match the registration
// form's own wording (see GroupFillPanel/bookmarklet).
const groupAsText = (group) =>
  group.members.map((m, i) => `${i === 0 ? 'Your Details' : `#${i}`}\t${m.registrationId}\t${m.postCode}`).join('\n');

// A "copy the whole group" button, separate from the per-field CopyButtons
// below it because it copies a multi-line block rather than one value - the
// success/failure feedback would be misleading shared with them.
const CopyGroupButton = ({ group }) => {
  const [state, setState] = useState('idle'); // idle | copied | failed
  const onClick = async () => {
    const ok = await copyText(groupAsText(group));
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 2000);
  };
  return (
    <button type="button" className={`groups-copy-all groups-copy-all-${state}`} onClick={onClick}>
      {state === 'copied' ? 'Group copied' : state === 'failed' ? 'Copy failed' : 'Copy whole group'}
    </button>
  );
};

// One group, table always visible - no "show details" click to find first.
// This is the fallback path: if the drag-a-bookmark or bookmarklet route
// isn't working (browser blocked it, phone with no bookmarks bar, laptop
// died and you're on someone else's), everything needed to type the six
// boxes by hand - or paste them one at a time - is right here.
const GroupRow = ({ group }) => {
  const count = group.members.length;
  return (
    <li className="groups-group">
      <div className="groups-group-head">
        <div className="groups-group-title">
          <strong>Group {group.label}</strong>
          <span className="groups-group-count">{count} {count === 1 ? 'person' : 'people'}</span>
        </div>
        <CopyGroupButton group={group} />
      </div>
      <table className="groups-members">
        <thead>
          <tr><th>Slot</th><th>Registration Number</th><th>Postcode</th></tr>
        </thead>
        <tbody>
          {group.members.map((m, i) => (
            <tr key={`${m.registrationId}-${i}`}>
              <td>{i === 0 ? 'Your Details' : `#${i}`}</td>
              <td><code>{m.registrationId}</code> <CopyButton text={m.registrationId} /></td>
              <td><code>{m.postCode}</code> <CopyButton text={m.postCode} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
};

// The Groups tab: a dedicated, always-expanded view of every group's
// registration numbers and postcodes with one-click copy buttons, so that on
// sale morning someone can fall back to typing (or pasting) the boxes by
// hand the moment the bookmark, bookmarklet, extension or Launcher jump
// doesn't work - without having to find the same table buried a few clicks
// into the Documentation tab first.
//
// storedFiles/storeStatus/storeError come from BusWankersPage's shared store
// (see useAutofillGroups) - the same data the Documentation tab reads, so
// the two never disagree about which sales are loaded. saleType/
// onSaleTypeChange are lifted up to BusWankersPage too, rather than kept
// here, so this tab defaults to (and stays in step with) whichever sale is
// currently selected on the Documentation tab.
const GroupsSection = ({
  year = DEFAULT_YEAR,
  storedFiles = new Map(),
  storeStatus = 'loading',
  storeError = '',
  saleType = 'Coach',
  onSaleTypeChange = () => {},
}) => {
  const info = SALE_INFO[saleType];
  const { groups, status, error, isEmpty, stored } = useAutofillGroups(info.filename, storedFiles, storeStatus, storeError);

  return (
    <section className="groups-section" aria-label="Groups - copy and paste fallback">
      <div className="container">
        <h1>{year} Groups</h1>
        <p className="groups-intro">
          Quick fallback if the bookmark, bookmarklet, extension or Launcher jump doesn&rsquo;t work on the day: every
          group&rsquo;s registration numbers and postcodes, ready to copy straight into the form.
        </p>

        <div className="form-group sale-picker">
          <label htmlFor="groupsSaleType">Which sale?</label>
          <select
            id="groupsSaleType"
            className="form-input"
            value={saleType}
            onChange={(e) => onSaleTypeChange(e.target.value)}
          >
            {Object.entries(SALE_INFO).map(([key, tab]) => {
              const f = storedFiles.get(tab.filename);
              const empty = !f || f.size === 0;
              return (
                <option key={key} value={key}>
                  {tab.label}{empty ? ' (empty)' : ''}
                </option>
              );
            })}
          </select>
          <p className="sale-picker-note">
            {storeStatus === 'loading' && 'Checking which sales are loaded…'}
            {storeStatus === 'error' && `Couldn't check the sales: ${storeError}`}
            {storeStatus === 'ready' && isEmpty && 'Nothing has been loaded for this sale yet - the organiser needs to upload the spreadsheet on the Update Files tab.'}
            {storeStatus === 'ready' && !isEmpty && `Groups last updated ${formatWhen(stored.lastModified)}`}
          </p>
        </div>

        {status === 'loading' && <p className="groups-note">Loading the {info.label.toLowerCase()} groups…</p>}
        {status === 'error' && <p className="groups-note groups-error">Couldn&rsquo;t load the groups: {error}</p>}
        {status === 'ready' && !groups && (
          <p className="groups-note">
            Nothing has been ingested for the {info.label.toLowerCase()} yet, so there are no groups to show.
          </p>
        )}
        {status === 'ready' && groups && groups.length === 0 && (
          <p className="groups-note">The {info.label.toLowerCase()} file has no groups in it.</p>
        )}
        {status === 'ready' && groups && groups.length > 0 && (
          <ul className="groups-list">
            {groups.map((g) => (
              <GroupRow key={g.code} group={g} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default GroupsSection;
