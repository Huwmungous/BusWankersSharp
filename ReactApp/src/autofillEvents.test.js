import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./log', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLog: () => logger, asError: (e) => e };
});

import { createSseParser, subscribeToFileChanges } from './autofillEvents';

const encoder = new TextEncoder();

// A fetch response whose body yields the given text chunks, then ends (or
// stays open, if keepOpen, until aborted).
const streamResponse = (chunks, { keepOpen = false, signal } = {}) => {
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => {
          if (index < chunks.length) {
            return Promise.resolve({ done: false, value: encoder.encode(chunks[index++]) });
          }
          if (!keepOpen) return Promise.resolve({ done: true });
          return new Promise((_, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        },
      }),
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('createSseParser', () => {
  it('parses an event with data', () => {
    const frames = [];
    createSseParser((f) => frames.push(f)).feed('event: files-changed\ndata: {"sequence":3}\n\n');
    expect(frames).toEqual([{ event: 'files-changed', data: '{"sequence":3}' }]);
  });

  it('copes with frames split across chunks', () => {
    const frames = [];
    const parser = createSseParser((f) => frames.push(f));
    parser.feed('event: hel');
    parser.feed('lo\ndata: {"sequ');
    parser.feed('ence":1}\n');
    expect(frames).toEqual([]);
    parser.feed('\n');
    expect(frames).toEqual([{ event: 'hello', data: '{"sequence":1}' }]);
  });

  it('ignores comment keepalives', () => {
    const frames = [];
    createSseParser((f) => frames.push(f)).feed(': keepalive\n\n');
    expect(frames).toEqual([]);
  });

  it('defaults the event name to message and handles several frames at once', () => {
    const frames = [];
    createSseParser((f) => frames.push(f)).feed('data: a\n\nevent: x\ndata: b\n\n');
    expect(frames).toEqual([
      { event: 'message', data: 'a' },
      { event: 'x', data: 'b' },
    ]);
  });
});

describe('subscribeToFileChanges', () => {
  it('calls onChange for each files-changed frame but not for hello', async () => {
    const onChange = vi.fn();
    const fetchImpl = vi.fn((url, { signal }) =>
      Promise.resolve(
        streamResponse(
          ['event: hello\ndata: {"sequence":0}\n\n', ': keepalive\n\n', 'event: files-changed\ndata: {"sequence":1,"reason":"ingest"}\n\n'],
          { keepOpen: true, signal },
        ),
      ),
    );
    const stop = subscribeToFileChanges({ onChange, fetchImpl });
    await flush();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ reason: 'ingest', sequence: 1 });
    stop();
  });

  it('reconnects after the stream ends and reports a change on the reconnection', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const fetchImpl = vi.fn((url, { signal }) =>
      Promise.resolve(streamResponse(['event: hello\ndata: {"sequence":0}\n\n'], { keepOpen: fetchImpl.mock.calls.length > 1, signal })),
    );
    const stop = subscribeToFileChanges({ onChange, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith({ reason: 'reconnected' });
    stop();
  });

  it('retries after an HTTP error and stops retrying once unsubscribed', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 401, body: null }));
    const stop = subscribeToFileChanges({ onChange: vi.fn(), fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports unsupported when the body cannot be streamed', async () => {
    const onState = vi.fn();
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true, status: 200, body: null }));
    const stop = subscribeToFileChanges({ onChange: vi.fn(), onState, fetchImpl });
    await flush();
    expect(onState).toHaveBeenCalledWith('unsupported');
    stop();
  });
});
