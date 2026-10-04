// Client for the Registrations tab's routes on the UploaderService
// (api/autofill/registrations - see RegistrationAllocationController).
//
// Who is "a user"? Everyone signs in as the same Keycloak identity, so the
// token can't tell people apart. Each browser invents a random id for itself,
// keeps it in localStorage, and sends it as `claimant`: the server holds a
// registration for the browser that copied it and offers it to nobody else.
// It tells browsers apart, nothing more - clearing site data starts a fresh
// "person" (what the old one copied stays allocated).
//
// The id travels in the query string (GET) or the JSON body (POST), never a
// header, and the JSON body goes up as a typed Blob so the browser sets the
// Content-Type itself - nothing here depends on how the sign-in fetch
// interceptor treats headers. Registration numbers and postcodes are never
// logged, only counts and outcomes.
import { API_BASE, loggedFetch, readErrorMessage, UPLOADERS_ONLY_MESSAGE } from './autofillApi';
import { getLog, asError } from '../log';

const REGISTRATIONS_BASE = `${API_BASE}/registrations`;
const CLAIMANT_STORAGE_KEY = 'bw-claimant-id';

// Created when used, never at module load (see ../log.js).
const regLog = (attributes) => getLog('registrationsApi', attributes);

// Held in memory too, so a browser with storage blocked (private window) still
// keeps ONE id for the life of the page rather than a new one per request.
let memoryClaimantId = null;

const makeClaimantId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  let id = '';
  for (let i = 0; i < 32; i += 1) id += Math.floor(Math.random() * 16).toString(16);
  return id;
};

// This browser's id, created on first use. Exported for the tests.
export function claimantId() {
  if (memoryClaimantId) return memoryClaimantId;
  try {
    const stored = window.localStorage.getItem(CLAIMANT_STORAGE_KEY);
    if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) {
      memoryClaimantId = stored;
      return stored;
    }
  } catch (err) {
    regLog().debug('Browser storage unavailable for the claimant id - using an in-memory one', asError(err));
  }

  memoryClaimantId = makeClaimantId();
  try {
    window.localStorage.setItem(CLAIMANT_STORAGE_KEY, memoryClaimantId);
  } catch (err) {
    regLog().debug('Could not store the claimant id - it lasts for this page only', asError(err));
  }
  regLog().info('New claimant id created for this browser');
  return memoryClaimantId;
}

// For the tests: forget the in-memory copy so the next call reads storage again.
export function resetClaimantIdForTests() {
  memoryClaimantId = null;
}

const jsonBody = (value) => new Blob([JSON.stringify(value)], { type: 'application/json' });

// The shape the server answers with, made safe to read: a pool state is
// { loaded, total, remaining, allAllocated, entry: { regNumber, postCode,
// allocated, mine } | null }.
function normaliseState(body) {
  const entry = body && body.entry
    ? {
      regNumber: String(body.entry.regNumber),
      postCode: String(body.entry.postCode),
      allocated: !!body.entry.allocated,
      mine: !!body.entry.mine,
    }
    : null;
  return {
    loaded: !!(body && body.loaded),
    total: (body && body.total) || 0,
    remaining: (body && body.remaining) || 0,
    allAllocated: !!(body && body.allAllocated),
    entry,
  };
}

async function readState(response, what) {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `${what} failed (${response.status}).`));
  }
  const state = normaliseState(await response.json());
  regLog({ total: state.total, remaining: state.remaining, hasEntry: !!state.entry }).debug(`${what} answered`);
  return state;
}

// What to show when the tab opens: this browser's own latest registration if
// it has claimed one (so a reload doesn't lose the postcode), else the first
// free one. Allocates nothing.
export async function fetchCurrentRegistration() {
  const url = `${REGISTRATIONS_BASE}/current?claimant=${encodeURIComponent(claimantId())}`;
  const response = await loggedFetch('registrations/current', url, { cache: 'no-store' });
  return readState(response, 'Loading the registration');
}

// The next FREE registration after the one on screen (wrapping round). Allocates nothing.
export async function fetchNextRegistration(afterRegNumber) {
  const response = await loggedFetch('registrations/next', `${REGISTRATIONS_BASE}/next`, {
    method: 'POST',
    body: jsonBody({ claimant: claimantId(), after: afterRegNumber || null }),
  });
  return readState(response, 'Loading the next registration');
}

// The Copy button's first step: reserve this registration for this browser.
// Resolves to { claimed, reason, state }. claimed false means someone else got
// there first ('taken') or it has left the pool ('missing'); `state` then
// carries the next free registration to move on to.
export async function claimRegistration(regNumber) {
  const response = await loggedFetch('registrations/claim', `${REGISTRATIONS_BASE}/claim`, {
    method: 'POST',
    body: jsonBody({ claimant: claimantId(), regNumber }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Reserving the registration failed (${response.status}).`));
  }
  const body = await response.json();
  const result = { claimed: !!body.claimed, reason: body.reason || null, state: normaliseState(body.state) };
  regLog({ claimed: result.claimed, reason: result.reason, remaining: result.state.remaining }).info('Registration claim answered');
  return result;
}

// Uploaders only: read the "Unique Reg Numbers" sheet of the compiled
// workbook into the pool. Resolves to the server's summary { sheet, total,
// added, stillAllocated, droppedAllocated, skippedRows, duplicateRows }.
export async function loadRegistrationPool(file) {
  regLog({ fileName: file && file.name, fileBytes: file && file.size }).info('Registration pool load requested');

  const form = new FormData();
  form.append('file', file);

  const response = await loggedFetch('registrations/load', `${REGISTRATIONS_BASE}/load`, { method: 'POST', body: form });
  if (response.status === 403) {
    throw new Error(UPLOADERS_ONLY_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed (${response.status}).`));
  }
  const summary = await response.json();
  regLog({ total: summary.total, added: summary.added, stillAllocated: summary.stillAllocated }).info('Registration pool loaded');
  return summary;
}
