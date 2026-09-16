// The sale time is always a UK wall-clock time ("9am on the Thursday"),
// whatever clock the machine running the browser is on - someone arming a
// browser from abroad, or with a laptop still on holiday time, must not end
// up an hour out. So the launcher stores the sale time as a London wall-clock
// string (YYYY-MM-DDTHH:mm, what <input type="datetime-local"> speaks) and
// converts it to an epoch through Europe/London explicitly, with BST/GMT
// worked out by Intl rather than by us.

const LONDON = 'Europe/London';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const londonParts = (epochMs) => {
  const parts = {};
  for (const { type, value } of partsFormatter.formatToParts(new Date(epochMs))) {
    parts[type] = value;
  }
  // hourCycle h23 should never yield "24", but some engines have; be safe.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

// Offset of London from UTC at the given instant, in ms (0 in winter, +3600000 in BST).
const londonOffsetMs = (epochMs) => {
  const p = londonParts(epochMs);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(epochMs / 1000) * 1000;
};

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// 'YYYY-MM-DDTHH:mm' in London time -> epoch ms, or null if unparseable.
export function londonWallToEpoch(wall) {
  const m = WALL_RE.exec(wall || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  if (!Number.isFinite(guess)) return null;
  // Two passes handle the DST edge: the offset at the guess may differ from
  // the offset at the true instant right around a clock change.
  let epoch = guess - londonOffsetMs(guess);
  epoch = guess - londonOffsetMs(epoch);
  return epoch;
}

const pad2 = (n) => String(n).padStart(2, '0');

// epoch ms -> 'YYYY-MM-DDTHH:mm' London wall-clock (for the datetime-local input).
export function epochToLondonWall(epochMs) {
  const p = londonParts(epochMs);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

const readableFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

// e.g. "Thu 19 Nov 2026, 09:00:00 GMT" (or "... BST" in summer).
export function formatLondon(epochMs) {
  return readableFormatter.format(new Date(epochMs));
}

// A clock readout with milliseconds, London time: "09:00:00.000".
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatLondonClock(epochMs) {
  const ms = ((Math.floor(epochMs) % 1000) + 1000) % 1000;
  return `${clockFormatter.format(new Date(epochMs))}.${String(ms).padStart(3, '0')}`;
}
