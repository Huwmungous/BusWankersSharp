// Launcher settings live in THIS browser's localStorage - deliberately. Every
// browser on every machine is its own queue entrant, and what's installed
// differs from host to host, so each armed browser carries its own copy of
// the settings rather than the backend holding one list for everyone. To
// save typing the same thing into Chrome, Firefox, Edge, Opera and Safari in
// turn, the page can hand out a "launch link" with the settings in its query
// string; opening that link in a browser writes them into that browser's
// storage and strips them from the address bar.
//
// Settings:
//   url     - the ticket page to open at the sale time
//   saleAt  - London wall-clock 'YYYY-MM-DDTHH:mm' (see londonTime.js), or ''
//   leadMs  - fire this many ms BEFORE the sale time (0 = exactly on it)

export const STORAGE_KEY = 'buswankers.launch.v1';

export const DEFAULT_URL = 'https://glastonbury.seetickets.com/';

export const DEFAULT_CONFIG = Object.freeze({
  url: DEFAULT_URL,
  saleAt: '',
  leadMs: 0,
});

const QUERY_KEYS = { url: 'url', saleAt: 'saleAt', leadMs: 'lead' };

const clampLead = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-60000, Math.min(60000, Math.round(n)));
};

const sanitise = (raw) => ({
  url: typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : DEFAULT_URL,
  saleAt: typeof raw.saleAt === 'string' ? raw.saleAt : '',
  leadMs: clampLead(raw.leadMs),
});

function readStorage() {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? sanitise(parsed) : null;
  } catch (err) {
    console.debug('[launch] localStorage unreadable:', err && err.message);
    return null;
  }
}

export function saveConfig(config) {
  const clean = sanitise(config);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch (err) {
    console.debug('[launch] localStorage unwritable:', err && err.message);
  }
  return clean;
}

// Settings carried in the address bar, if any: { config, present }.
function readQuery() {
  const params = new URLSearchParams(window.location.search);
  const present = Object.values(QUERY_KEYS).some((k) => params.has(k));
  if (!present) return { present: false, config: null };
  const base = readStorage() || DEFAULT_CONFIG;
  return {
    present: true,
    config: sanitise({
      url: params.has(QUERY_KEYS.url) ? params.get(QUERY_KEYS.url) : base.url,
      saleAt: params.has(QUERY_KEYS.saleAt) ? params.get(QUERY_KEYS.saleAt) : base.saleAt,
      leadMs: params.has(QUERY_KEYS.leadMs) ? params.get(QUERY_KEYS.leadMs) : base.leadMs,
    }),
  };
}

// Strip the launch settings from the address bar (keeping the tab hash) so a
// reload or a bookmark of this page doesn't keep re-importing them.
function stripQuery() {
  try {
    const url = new URL(window.location.href);
    for (const k of Object.values(QUERY_KEYS)) url.searchParams.delete(k);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // history API unavailable - harmless, the settings are saved anyway
  }
}

// What the page starts with: a launch link's settings (saved as this
// browser's own on the way in), else this browser's saved settings, else the
// defaults. `imported` says a launch link was consumed, so the page can say so.
export function loadConfig() {
  const query = readQuery();
  if (query.present) {
    const saved = saveConfig(query.config);
    stripQuery();
    return { config: saved, imported: true };
  }
  return { config: readStorage() || { ...DEFAULT_CONFIG }, imported: false };
}

// A link that opens THIS page on the Launch tab with these settings baked in.
export function buildLaunchLink(config) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = 'launch';
  const clean = sanitise(config);
  url.searchParams.set(QUERY_KEYS.url, clean.url);
  if (clean.saleAt) url.searchParams.set(QUERY_KEYS.saleAt, clean.saleAt);
  if (clean.leadMs) url.searchParams.set(QUERY_KEYS.leadMs, String(clean.leadMs));
  return url.toString();
}
