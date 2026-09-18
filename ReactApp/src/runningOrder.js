// Cross-references a group's registration numbers (from the autofill CSV -
// see bookmarklet.js's parseAutofillCsv, which only carries registrationId/
// postCode) against the ingested roster's firstName/lastName (see
// api/autofillApi.fetchRunningOrder), so the group tables can show whose
// registration number is whose without the autofill files themselves ever
// needing to carry names.
//
// Registration numbers come from two different sources (the AutoFill CSV
// export vs the roster spreadsheet) that don't promise identical formatting
// - a purely numeric one might have a leading zero in one and not the
// other - so purely-numeric values are compared by their numeric value, and
// anything else by a trimmed, case-insensitive string.
const normaliseReg = (value) => {
  const s = String(value || '').trim();
  if (!s) return '';
  return /^\d+$/.test(s) ? String(Number(s)) : s.toUpperCase();
};

// Builds a registrationNumber -> "First Last" lookup from a fetchRunningOrder
// result (or null, if nothing's been ingested yet - returns an empty map).
export function buildNameLookup(runningOrder) {
  const map = new Map();
  const entries = runningOrder && Array.isArray(runningOrder.entries) ? runningOrder.entries : [];
  for (const e of entries) {
    const key = normaliseReg(e.regNumber);
    if (!key) continue;
    const name = `${e.firstName || ''} ${e.lastName || ''}`.replace(/\s+/g, ' ').trim();
    if (name) map.set(key, name);
  }
  return map;
}

// Looks up one registration number in a lookup built by buildNameLookup;
// '' if there's no roster entry for it (not ingested, or a genuine mismatch).
export function nameForRegistration(nameLookup, registrationId) {
  return nameLookup.get(normaliseReg(registrationId)) || '';
}

// Builds a registrationNumber -> group-letter lookup from one sale's groups
// (the array useAutofillGroups/fetchAutofillGroups returns - see
// parseAutofillCsv in bookmarklet.js: [{ label, members: [{registrationId,
// postCode}] }]), for the Running Order tab's per-sale columns (2026-09-18).
// label is the RAW group letter ("A"), not sale-qualified - the column
// header itself (the sale's folderLabel) already says which sale, so
// "A" in the Coach column and "A" in the General column read unambiguously
// side by side without repeating "Coach"/"General" in every cell.
export function buildGroupLookup(groups) {
  const map = new Map();
  if (!Array.isArray(groups)) return map;
  for (const g of groups) {
    for (const m of g.members || []) {
      const key = normaliseReg(m.registrationId);
      if (key) map.set(key, g.label);
    }
  }
  return map;
}

// Looks up one registration number in a lookup built by buildGroupLookup;
// '' if that person isn't in this sale's groups (not ingested for this sale,
// or genuinely not part of it - most people are only in one or two sales).
export function groupLabelForRegistration(groupLookup, registrationId) {
  return groupLookup.get(normaliseReg(registrationId)) || '';
}
