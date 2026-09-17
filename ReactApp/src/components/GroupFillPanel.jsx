import React, { useEffect, useRef, useState } from 'react';
import { bookmarkletHref, bookmarkletSource, bookmarkletTitle, runFillOnThisPage } from '../bookmarklet';
import './GroupFillPanel.css';

// A javascript: href has to be set outside React's render path: React 18
// warns on javascript: URLs in JSX and a future version will refuse them,
// and this is the one legitimate use - a bookmarklet the user drags to
// their bookmarks bar.
const BookmarkletLink = ({ group, year }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.setAttribute('href', bookmarkletHref(group));
  }, [group]);
  return (
    <a
      ref={ref}
      className="bw-bookmarklet"
      title={`Drag me to your bookmarks bar - or right-click and bookmark. Then click it on the registration page to fill in ${group.members.length} people.`}
      draggable="true"
      onClick={(e) => {
        // Clicking it HERE would run the fill against this page - harmless
        // but confusing (it would fill the hidden Test Form). Explain instead.
        e.preventDefault();
        window.alert(
          `Don't click it here - drag "${bookmarkletTitle(group, year)}" up to your bookmarks bar ` +
          '(or right-click it and choose "Bookmark link"). Then, on the Glastonbury registration page, click the bookmark.',
        );
      }}
    >
      {bookmarkletTitle(group, year)}
    </a>
  );
};

// Exported alongside CopyButton so GroupsSection (the standalone copy/paste
// fallback tab) can offer the same one-click clipboard behaviour without a
// second implementation of it drifting out of step with this one.
export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const CopyButton = ({ text, label = 'Copy', copiedLabel = 'Copied' }) => {
  const [state, setState] = useState('idle'); // idle | copied | failed
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };
  return (
    <button type="button" className={`bw-copy bw-copy-${state}`} onClick={onClick} title={`Copy "${text}"`}>
      {state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
};

// One group's card: the bookmarklet to drag, a "try it" button that runs
// the same fill against the Test Form tab, and (collapsed) the copy/paste
// fallback and the raw bookmarklet code for anyone on a phone.
const GroupCard = ({ group, year, onTried }) => {
  const [showDetails, setShowDetails] = useState(false);
  const count = group.members.length;

  const tryOnTestForm = () => {
    runFillOnThisPage(group);
    if (onTried) onTried(group);
  };

  return (
    <li className="bw-group">
      <div className="bw-group-head">
        <div className="bw-group-title">
          <strong>Group {group.label}</strong>
          <span className="bw-group-count">{count} {count === 1 ? 'person' : 'people'}</span>
        </div>
        <div className="bw-group-actions">
          <BookmarkletLink group={group} year={year} />
          <button type="button" className="bw-try" onClick={tryOnTestForm} title="Fill the Test Form tab with this group, exactly as the bookmark would">
            Try it on the Test Form
          </button>
          <button type="button" className="bw-details-toggle" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide details' : 'Show details / copy & paste'}
          </button>
        </div>
      </div>

      {showDetails && (
        <div className="bw-group-details">
          <p className="bw-note">
            If you can&rsquo;t use a bookmark (on a phone, say), copy each value from here into the matching box.
            Slot 0 is &ldquo;Your Details&rdquo;; #1 onwards are the additional registrations.
          </p>
          <table className="bw-members">
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
          <p className="bw-note">
            Advanced: the bookmark&rsquo;s code, for adding a bookmark by hand (e.g. on iPhone: bookmark any page, then edit its address and paste this in).{' '}
            <CopyButton text={`javascript:${encodeURIComponent(bookmarkletSource(group))}`} label="Copy bookmark code" copiedLabel="Code copied" />
          </p>
        </div>
      )}
    </li>
  );
};

// groups: from fetchAutofillGroups (null = file not in store), status:
// loading | ready | error. saleLabel is for the wording only.
const GroupFillPanel = ({ groups, status, error, year, saleLabel, onTried }) => {
  if (status === 'loading') {
    return <p className="bw-note">Loading the {saleLabel.toLowerCase()} groups…</p>;
  }
  if (status === 'error') {
    return <p className="bw-note bw-error">Couldn&rsquo;t load the groups: {error}</p>;
  }
  if (!groups) {
    return (
      <p className="bw-note">
        Nothing has been ingested for the {saleLabel.toLowerCase()} yet, so there are no groups to show - the organiser
        needs to upload the spreadsheet on the Update Files tab.
      </p>
    );
  }
  if (groups.length === 0) {
    return <p className="bw-note">The {saleLabel.toLowerCase()} file has no groups in it.</p>;
  }

  return (
    <ul className="bw-groups">
      {groups.map((g) => (
        <GroupCard key={g.code} group={g} year={year} onTried={onTried} />
      ))}
    </ul>
  );
};

export default GroupFillPanel;
