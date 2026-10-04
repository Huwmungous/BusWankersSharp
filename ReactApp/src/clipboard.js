import { getLog, asError } from './log';

// Created when used, never at module load (see ./log.js).
const clipboardLog = (attributes) => getLog('clipboard', attributes);

// Copy text that is only known AFTER an asynchronous step - here, the answer
// to "may this browser have this registration?". Browsers only let a page
// write to the clipboard in direct response to a click, and Safari counts
// that as over once an await has gone by. So where the browser supports it
// the clipboard write is started immediately inside the click, handed a
// PROMISE for the text (ClipboardItem accepts one), and completes when the
// text arrives. Elsewhere it simply waits for the text and then writes it.
//
// `textPromise` resolves to the text to copy, or to null/undefined for "don't
// copy anything" (the claim was refused). It may also reject, and that
// rejection is passed on to the caller untouched.
//
// Resolves to { text, copied }: text is what the promise gave (null if
// nothing was to be copied), copied is whether it reached the clipboard.
// Only lengths are logged - what is copied is a registration number or
// postcode.
export async function copyWhenReady(textPromise) {
  let text = null;
  const settled = Promise.resolve(textPromise).then((t) => {
    text = t == null ? null : String(t);
    return text;
  });
  // Without this, a rejection that happens before anything awaits `settled`
  // is reported as unhandled.
  settled.catch(() => {});

  const supportsPromisedItems =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof window.ClipboardItem === 'function';

  if (supportsPromisedItems) {
    try {
      const blob = settled.then((t) => {
        if (t == null) throw new Error('nothing to copy');
        return new Blob([t], { type: 'text/plain' });
      });
      await navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': blob })]);
      clipboardLog({ chars: text ? text.length : 0 }).debug('Text copied to the clipboard (promised item)');
      return { text, copied: true };
    } catch (err) {
      // Either nothing was to be copied (handled just below), or the browser
      // refused the promised item - fall through to the plain route.
      clipboardLog().debug('Promised clipboard write did not complete', asError(err));
    }
  }

  await settled; // a rejection from the caller's promise surfaces here
  if (text == null) return { text: null, copied: false };

  return { text, copied: await writePlainText(text) };
}

// navigator.clipboard.writeText where it works, otherwise the old
// select-and-execCommand route (an insecure page, an older browser).
async function writePlainText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      clipboardLog({ chars: text.length }).debug('Text copied to the clipboard');
      return true;
    }
  } catch (err) {
    clipboardLog({ chars: text.length }).warn('Clipboard writeText failed - trying the fallback', asError(err));
  }

  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    clipboardLog({ chars: text.length, ok }).debug('Text copied with the execCommand fallback');
    return ok;
  } catch (err) {
    clipboardLog({ chars: text.length }).warn('Clipboard fallback failed', asError(err));
    return false;
  }
}
