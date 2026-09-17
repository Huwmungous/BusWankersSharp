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
