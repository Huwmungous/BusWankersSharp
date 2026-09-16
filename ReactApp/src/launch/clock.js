// NTP-grade time for the sale-day launcher.
//
// A browser can't talk NTP, so the UploaderService does it for us (GET
// /api/time, see UploaderService/NtpClock.cs) and we apply the same
// round-trip arithmetic over the HTTP hop: with our send/receive times t0/t3
// and the server's NTP-corrected receive/send times t1/t2,
//     offset = ((t1 - t0) + (t2 - t3)) / 2
// is how far THIS browser's clock is from true time. Several samples are taken
// and the one with the shortest round trip wins (a short round trip bounds the
// error), which on a LAN or a decent broadband line lands within a few
// milliseconds of NTP - far better than a laptop clock that may be seconds out.
//
// Nothing here is React-specific; LaunchSection calls syncClock() and then
// uses correctedNow(sync) wherever it needs "the real time now".

export const TIME_URL = '/buswankers-api/api/time';

// One exchange with /api/time. Returns { offsetMs, rttMs, source, server,
// serverOffsetMs } or throws with a message the page can show.
export async function sampleOnce() {
  const t0 = Date.now();
  let response;
  try {
    response = await fetch(`${TIME_URL}?_=${t0}`, { cache: 'no-store' });
  } catch (err) {
    throw new Error(`Could not reach the time service (${err.message || 'network error'}).`);
  }
  const t3 = Date.now();
  if (!response.ok) {
    throw new Error(`Time service answered ${response.status}.`);
  }
  const body = await response.json();
  const t1 = Number(body.receivedMs);
  const t2 = Number(body.sentMs);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
    throw new Error('Time service reply was not understood.');
  }
  return {
    offsetMs: ((t1 - t0) + (t2 - t3)) / 2,
    rttMs: (t3 - t0) - (t2 - t1),
    source: body.source || 'unknown',
    server: body.server || null,
    serverOffsetMs: Number.isFinite(Number(body.offsetMs)) ? Number(body.offsetMs) : null,
    error: body.error || null,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Take `count` samples a little apart and keep the best. Returns
//   { offsetMs, rttMs, source, server, serverOffsetMs, samples, syncedAt, spreadMs }
// where syncedAt is the LOCAL Date.now() at completion and spreadMs is the
// range of offsets seen across samples (a rough confidence figure to show).
export async function syncClock(count = 8, gapMs = 120) {
  const samples = [];
  let lastError = null;
  for (let i = 0; i < count; i++) {
    try {
      samples.push(await sampleOnce());
    } catch (err) {
      lastError = err;
    }
    if (i < count - 1) await sleep(gapMs);
  }
  if (samples.length === 0) {
    throw lastError || new Error('No time samples succeeded.');
  }
  const best = samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
  const offsets = samples.map((s) => s.offsetMs);
  return {
    offsetMs: best.offsetMs,
    rttMs: best.rttMs,
    source: best.source,
    server: best.server,
    serverOffsetMs: best.serverOffsetMs,
    error: best.error,
    samples: samples.length,
    spreadMs: Math.max(...offsets) - Math.min(...offsets),
    syncedAt: Date.now(),
  };
}

// The corrected time now, in ms since the epoch; falls back to the local clock
// when there is no sync yet.
export function correctedNow(sync) {
  return Date.now() + (sync ? sync.offsetMs : 0);
}

// Wait until the corrected clock reaches `targetMs`, then call onFire(). Two
// independent tickers: a main-thread timeout/poll, and a Web Worker ticker
// (Chrome throttles a background tab's main-thread timers - after five
// minutes hidden, to once a MINUTE - but a dedicated worker's timers are
// left alone, so the worker is what saves the day if the tab ends up behind
// another window). Whichever notices first fires; the other is cancelled.
//
// getNow: () => corrected ms (read on every tick, so a re-sync while armed
// takes effect without rescheduling). leadMs: fire this many ms early.
// Returns a cancel function.
export function scheduleAt(targetMs, getNow, onFire, { leadMs = 0, onTick } = {}) {
  let fired = false;
  let timer = null;
  let worker = null;
  const fireAt = targetMs - leadMs;

  const fire = (via) => {
    if (fired) return;
    fired = true;
    cancel();
    onFire(via, getNow() - fireAt);
  };

  const check = (via) => {
    if (fired) return;
    const remaining = fireAt - getNow();
    if (onTick) onTick(remaining);
    if (remaining <= 0) {
      fire(via);
      return;
    }
    // Coarse sleep until the last second and a half, then poll tightly.
    const delay = remaining > 1500 ? Math.min(remaining - 1000, 30000) : 4;
    timer = setTimeout(() => check('main'), delay);
  };

  try {
    const source = 'let id=null;onmessage=(e)=>{if(e.data==="stop"){clearInterval(id);id=null;return;}' +
      'clearInterval(id);id=setInterval(()=>postMessage(Date.now()),e.data);};';
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => {
      if (fired) return;
      if (fireAt - getNow() <= 0) fire('worker');
    };
    // 5 ms ticks: in the first live rehearsal the main-thread poll was
    // throttled (tab not focused) and the worker fired the jump - 19 ms late
    // on a 25 ms tick. Workers aren't throttled, so a tight tick is cheap.
    worker.postMessage(5);
  } catch (err) {
    // No workers (very old browser, or a blob: CSP) - the main thread is enough.
    console.debug('[launch] worker ticker unavailable:', err && err.message);
    worker = null;
  }

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (worker) {
      try {
        worker.postMessage('stop');
        worker.terminate();
      } catch {
        // already gone
      }
      worker = null;
    }
  }

  check('main');
  return () => {
    fired = true;
    cancel();
  };
}
