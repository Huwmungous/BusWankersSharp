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

// Builds a registrationNumber -> postcode lookup from one sale's groups,
// same shape as buildGroupLookup (2026-09-19: the "Glasto nnnn" roster
// sheet turned out not to actually have a Postcode column - see
// RosterReader.cs - so the Running Order tab's Postcode column is built
// from the per-sale group files instead, which do carry it). Blank
// postcodes (an unfilled slot) are skipped rather than overwriting a real
// one, though a genuine reg number shouldn't appear twice within one sale.
export function buildPostcodeLookup(groups) {
  const map = new Map();
  if (!Array.isArray(groups)) return map;
  for (const g of groups) {
    for (const m of g.members || []) {
      const key = normaliseReg(m.registrationId);
      const value = String(m.postCode || '').trim();
      if (key && value) map.set(key, value);
    }
  }
  return map;
}

// Looks up one registration number in a lookup built by buildPostcodeLookup;
// '' if that sale has no postcode on file for them.
export function postcodeForRegistration(postcodeLookup, registrationId) {
  return postcodeLookup.get(normaliseReg(registrationId)) || '';
}

// Postcodes are meant to be the same person's address whichever sale they
// came from, but they're typed independently into each sale's export, so
// they can genuinely disagree - a typo, or someone who moved between
// sales. normalisePostcodeValue strips whitespace and case (the same way
// bookmarklet.js's own normalisePostcode does for the CSV it writes) before
// comparing, so "S70 2LD" and "S702LD" read as the same postcode, not a
// conflict.
const normalisePostcodeValue = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();

// A UK postcode has a fairly rigid shape - 1-2 letters, 1-2 digits (with an
// occasional extra letter for a handful of inner-London districts), then a
// digit and two letters (or the single historical special case, GIR 0AA).
// This isn't full Royal Mail validation - it doesn't know which area codes
// actually exist - but it reliably catches the kind of typo that turns up
// in a hand-typed spreadsheet column: a transposed digit, a name pasted
// into the wrong cell, a postcode missing its inward part. That's the
// point here - flagging something for a human to check, not certifying
// deliverability. Checked against the same normalised (whitespace/case
// stripped) value combinePostcodes already computes, so formatting alone
// never trips it.
const UK_POSTCODE_PATTERN = /^GIR0AA$|^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

export function isValidUkPostcode(value) {
  const normalised = normalisePostcodeValue(value);
  return normalised.length > 0 && UK_POSTCODE_PATTERN.test(normalised);
}

// Combines every source's postcode for one person (typically one entry per
// real sale they're in, from buildPostcodeLookup) into what the Running
// Order cell should show. `sources` is [{ source, value }, ...] - `source`
// is just a label for the tooltip (a sale's folderLabel, say). Each
// returned source is annotated with `invalid` (per isValidUkPostcode)
// alongside its original `source`/`value`.
//
//  - no non-blank values: { value: '', conflict: false, invalid: false,
//    sources: [] } - renders as the usual em-dash "nothing on file yet".
//  - all non-blank values agree (after normalising): { value: <the first
//    one, in its original casing/spacing>, conflict: false, invalid: <is
//    that value a valid UK postcode>, sources }.
//  - two or more disagree: { value: '', conflict: true, invalid: <does any
//    source fail validation>, sources } - the cell renders a warning
//    instead of guessing which one's right, and `sources` is what a
//    tooltip lists to show the clash (and which entries, if any, are also
//    malformed).
export function combinePostcodes(sources) {
  const nonBlank = (sources || []).filter((s) => s && s.value);
  if (nonBlank.length === 0) return { value: '', conflict: false, invalid: false, sources: [] };

  const annotated = nonBlank.map((s) => ({ ...s, invalid: !isValidUkPostcode(s.value) }));

  const seen = new Map(); // normalised -> first-seen raw value
  for (const s of annotated) {
    const norm = normalisePostcodeValue(s.value);
    if (!seen.has(norm)) seen.set(norm, s.value);
  }

  if (seen.size === 1) {
    return { value: annotated[0].value, conflict: false, invalid: annotated[0].invalid, sources: annotated };
  }
  return { value: '', conflict: true, invalid: annotated.some((s) => s.invalid), sources: annotated };
}

