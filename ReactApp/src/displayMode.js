import { useEffect, useState } from 'react';

// Is this page running as the INSTALLED app (PWA in its own window) rather
// than in a normal browser tab? It matters for the Bookmark route: the fill
// bookmark can only be set up from a browser tab - an installed app window
// has no bookmarks bar, nothing to drag onto, and no menu to bookmark a link
// with. Chrome/Edge/Android report standalone via the display-mode media
// query; iOS Safari's home-screen apps report it via navigator.standalone.
//
// The value is read once and then kept in step with the media query (it can
// change if the same page is opened in the app from a tab, or vice versa),
// so a component using this re-renders rather than showing stale advice.
const QUERY = '(display-mode: standalone)';

const readStandalone = () => {
  try {
    if (typeof window === 'undefined') return false;
    if (window.navigator && window.navigator.standalone === true) return true; // iOS
    return !!(window.matchMedia && window.matchMedia(QUERY).matches);
  } catch {
    return false;
  }
};

export const useIsStandalone = () => {
  const [standalone, setStandalone] = useState(readStandalone);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    let mql;
    try {
      mql = window.matchMedia(QUERY);
    } catch {
      return undefined;
    }
    const onChange = () => setStandalone(readStandalone());
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange); // older Safari
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else if (mql.removeListener) mql.removeListener(onChange);
    };
  }, []);

  return standalone;
};

export default useIsStandalone;
