import React, { useEffect, useRef } from 'react';
import { runSaleFillOnThisPage, saleBookmarkletHref, saleBookmarkletTitle } from '../bookmarklet';
import './GroupFillPanel.css';
import './SaleBookmarklet.css';

// The single, whole-sale bookmarklet (2026-09-17): one drag installs ONE
// bookmark that covers every group, rather than a bookmark per group or a
// download-then-import folder. Clicking it on the registration page live-
// fetches (or falls back to the embedded data, same rules as the per-group
// bookmarklets) every group for the sale and shows a plain tap-to-choose
// list so the person picks their own group before it fills - see
// SALE_FILL_SOURCE/saleBookmarkletSource in ../bookmarklet.js for the
// mechanics and why this is the most "one action" installing a bookmark can
// get: a page can't write to the bookmarks bar itself, so a single drag of
// a single link is the ceiling, not a shortcut we've stopped short of.
//
// groups: the sale's full group list (same shape DocumentationSection
// already has from useAutofillGroups) - required; this component renders
// nothing useful without at least one group. groupsUrl: this sale's live
// group-data URL (see groupsUrlFor in api/autofillApi.js).
const SaleBookmarklet = ({ groups, year, saleFolderLabel, groupsUrl, onTried }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.setAttribute('href', saleBookmarkletHref(groups, groupsUrl));
  }, [groups, groupsUrl]);

  const tryOnTestForm = () => {
    runSaleFillOnThisPage(groups, groupsUrl);
    if (onTried) onTried();
  };

  const title = saleBookmarkletTitle(saleFolderLabel, year);

  return (
    <div className="bw-sale-bookmarklet">
      <a
        ref={ref}
        className="bw-bookmarklet bw-bookmarklet-primary"
        title={`Drag me to your bookmarks bar - one bookmark for the whole ${saleFolderLabel} sale. Click it on the registration page and tap your group.`}
        draggable="true"
        onClick={(e) => {
          // Clicking it HERE would run the fill against this page - harmless
          // but confusing (it would fill the hidden Test Form). Explain instead.
          e.preventDefault();
          window.alert(
            `Don't click it here - drag "${title}" up to your bookmarks bar ` +
            '(or right-click it and choose "Bookmark link"). Then, on the Glastonbury registration page, click the bookmark and tap your group.',
          );
        }}
      >
        {title}
      </a>
      <button
        type="button"
        className="bw-try"
        onClick={tryOnTestForm}
        title="Fill the Test Form tab with this bookmark, exactly as it would work on the day - picker included"
      >
        Try it on the Test Form
      </button>
    </div>
  );
};

export default SaleBookmarklet;
