// log.js
// One place for the BusWankers frontend's logging, built on IFLogger
// (LoggerService from @if/web-common). Everything logged through here ships to
// LoggerWebService (when the config service supplies a logger URL) and is
// searchable in the log viewer by its attributes.
//
// The attribute pattern: the message is a fixed sentence, and the variable
// facts travel as attributes - context fields on the logger - never spliced
// into the message text. So 'Download completed' with { fileName, bytes }
// can be filtered on fileName in the viewer, where a message with the values
// baked in cannot.
//
// Loggers are created when used, never at module load: LoggerService only
// learns the logger URL and level once AppInitializer has fetched the config
// (see main.jsx), so a module-level logger would be built too early. Callers
// therefore write getLog('Category', { ... }).debug('...') at the point of use.
//
// Log messages stay in English: they are for diagnosis, not for the person
// using the page.
//
// Nothing here reads a binding before its declaration - every const below is
// initialised at module load, ahead of any call that can reach it.

import { LoggerService } from '@if/web-common';

// Attribute names the log envelope owns: IFLogger silently drops a context key
// that collides with one of these, so a call site using one would lose that
// attribute without any warning. getLog renames them with an 'attr' prefix
// instead (e.g. 'version' becomes 'attrVersion').
const RESERVED_ATTRIBUTES = new Set([
  'realm', 'client', 'timestamp', 'level', 'category', 'eventId', 'eventName',
  'message', 'exception', 'stackTrace', 'application', 'environment', 'version',
  'host', 'pathname',
]);

// Longest attribute value kept. Mirrors the cap the backend IFLogger applies, so
// one call site that passes a big value cannot bloat every row it writes.
const MAX_ATTRIBUTE_LENGTH = 1024;

const renameIfReserved = (key) =>
  RESERVED_ATTRIBUTES.has(key) ? `attr${key.charAt(0).toUpperCase()}${key.slice(1)}` : key;

const attributeValue = (value) => {
  const text = String(value);
  return text.length <= MAX_ATTRIBUTE_LENGTH ? text : `${text.slice(0, MAX_ATTRIBUTE_LENGTH)}... (truncated)`;
};

// Drops null/undefined attributes and stringifies the rest. Returns null when
// nothing is left, so the caller can skip withContext entirely.
export const cleanAttributes = (attributes) => {
  if (!attributes || typeof attributes !== 'object') return null;
  const cleaned = {};
  let any = false;
  for (const key of Object.keys(attributes)) {
    const value = attributes[key];
    if (value === null || value === undefined) continue;
    cleaned[renameIfReserved(key)] = attributeValue(value);
    any = true;
  }
  return any ? cleaned : null;
};

// A logger for a category, optionally carrying attributes on every line it
// writes. Cheap enough to call per log statement (IFLogger caches the
// underlying logger by category).
export const getLog = (category, attributes) => {
  const base = LoggerService.create(category);
  const cleaned = cleanAttributes(attributes);
  return cleaned ? base.withContext(cleaned) : base;
};

// An Error (or whatever was thrown) as something safe to pass to IFLogger's
// exception parameter, which expects an Error.
export const asError = (thrown) => (thrown instanceof Error ? thrown : new Error(String(thrown)));

// Last-chance logging for anything nothing else caught: script errors and
// promise rejections nobody handled. These are exactly the failures that left
// no trace before. Safe to call once, at start-up; each handler creates its
// logger when it fires (see the note at the top about timing). A failure inside
// a handler is swallowed - logging must never make a bad situation worse.
let globalErrorLoggingInstalled = false;

export const installGlobalErrorLogging = () => {
  if (globalErrorLoggingInstalled || typeof window === 'undefined') return;
  globalErrorLoggingInstalled = true;

  window.addEventListener('error', (event) => {
    try {
      getLog('window', {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      }).error('Uncaught error', event.error ? asError(event.error) : new Error(String(event.message)));
    } catch {
      // never let logging throw from an error handler
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      getLog('window').error('Unhandled promise rejection', asError(event.reason));
    } catch {
      // never let logging throw from an error handler
    }
  });
};
