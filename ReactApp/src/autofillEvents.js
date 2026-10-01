import { getLog, asError } from './log';

// The server's "the stored autofill files changed" signal (GET /events, a
// Server-Sent Events stream). Read with fetch rather than EventSource because
// EventSource cannot send the Authorization header, and the global fetch is
// the one that carries the Keycloak token. Nothing here polls: the only timer
// is the back-off before RE-connecting a dropped stream.

export const EVENTS_URL = '/buswankers-api/api/autofill/events';

// Created when used, never at module load (see ./log.js).
const eventsLog = (attributes) => getLog('AutofillEvents', attributes);

const RECONNECT_FIRST_MS = 2000;
const RECONNECT_MAX_MS = 30000;

// Incremental SSE parser. feed(text) may be called with arbitrary chunk
// boundaries; onFrame({ event, data }) fires once per completed frame. Comment
// lines (": keepalive") are ignored, as the spec says.
export const createSseParser = (onFrame) => {
  let buffer = '';
  let event = 'message';
  let dataLines = [];

  const processLine = (line) => {
    if (line === '') {
      if (dataLines.length > 0) {
        onFrame({ event, data: dataLines.join('\n') });
      }
      event = 'message';
      dataLines = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  };

  return {
    feed(text) {
      buffer += text;
      let newline;
      while ((newline = buffer.search(/\r\n|\n|\r/)) !== -1) {
        const match = buffer.slice(newline).match(/^(\r\n|\n|\r)/);
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + match[0].length);
        processLine(line);
      }
    },
  };
};

const parseData = (data) => {
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
};

// Opens the stream and keeps it open, reconnecting with a capped back-off if it
// drops. onChange(info) is called when the server says files changed - and once
// after every RE-connection, because a frame sent while the stream was down
// would otherwise be missed. onState('connecting'|'open'|'closed'|'unsupported')
// is optional. Returns a function that closes everything.
export const subscribeToFileChanges = ({ onChange, onState, fetchImpl } = {}) => {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const state = (value) => {
    if (onState) onState(value);
  };

  let stopped = false;
  let controller = null;
  let timer = null;
  let delay = RECONNECT_FIRST_MS;
  let connections = 0;

  const scheduleReconnect = (connect) => {
    if (stopped) return;
    state('closed');
    eventsLog({ delayMs: delay }).debug('Events stream closed - reconnecting after a delay');
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  };

  const connect = async () => {
    timer = null;
    if (stopped) return;
    controller = new AbortController();
    const attempt = connections + 1;
    state('connecting');
    eventsLog({ attempt }).debug('Opening the events stream');

    try {
      const response = await doFetch(EVENTS_URL, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        // An old browser that cannot stream a response body: the page still
        // re-checks when it comes back into view, so this is only a lost nicety.
        eventsLog().warn('This browser cannot stream a response - live updates are off');
        state('unsupported');
        return;
      }

      connections += 1;
      const reconnected = connections > 1;
      delay = RECONNECT_FIRST_MS;
      state('open');
      eventsLog({ attempt, reconnected }).debug('Events stream open');
      if (reconnected) {
        // We may have missed a signal while disconnected.
        onChange?.({ reason: 'reconnected' });
      }

      const parser = createSseParser((frame) => {
        if (frame.event === 'files-changed') {
          const info = parseData(frame.data);
          eventsLog({ sequence: info.sequence, reason: info.reason }).info('Server says the autofill files changed');
          onChange?.({ reason: info.reason || 'changed', sequence: info.sequence });
        } else if (frame.event === 'hello') {
          eventsLog({ sequence: parseData(frame.data).sequence }).debug('Events stream said hello');
        }
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      eventsLog().debug('Events stream ended by the server');
    } catch (err) {
      if (stopped) return;
      eventsLog({ reason: err && err.message }).warn('Events stream failed', asError(err));
    }
    scheduleReconnect(connect);
  };

  connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (controller) controller.abort();
    state('closed');
    eventsLog().debug('Events subscription closed');
  };
};
