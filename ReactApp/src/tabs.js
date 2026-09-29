import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsUploader } from './auth/uploaders';

// The page's tabs, in nav order. `id` doubles as the URL hash (#test-form),
// which is what makes a tab linkable/bookmarkable and lets ordinary <a href>
// links inside the page (e.g. Documentation's "try it on the test form")
// switch tabs without any prop drilling. Documentation is the landing tab.
//
// `uploadersOnly` tabs are shown only to members of the "uploaders" Keycloak
// group (see auth/uploaders.js) - Update Files, the one tab that changes what
// the live autofill files hold. Everyone else neither sees the tab nor can
// reach it by typing #update-files (they land on Documentation instead); the
// server enforces the same rule on the routes behind it.
export const TABS = [
  { id: 'update-files', label: 'Update Files', uploadersOnly: true },
  { id: 'documentation', label: 'Documentation' },
  // Standalone copy/paste fallback for every group - see GroupsSection - for
  // when the bookmark, bookmarklet, extension or Launcher jump doesn't work.
  { id: 'groups', label: 'Groups' },
  { id: 'running-order', label: 'Running Order' },
  { id: 'test-form', label: 'Test Form' },
  // id stays 'launch': it's the hash (#launch) that launch links point at.
  { id: 'launch', label: 'Launcher' },
];

export const DEFAULT_TAB = 'documentation';

// The tabs a person may see: all of them for an uploader, the rest for anyone
// else. Pure, so it can be tested without React.
export const tabsFor = (uploader) => TABS.filter((t) => uploader || !t.uploadersOnly);

const tabFromHash = (available) => {
  const id = (window.location.hash || '').replace(/^#/, '');
  return available.some((t) => t.id === id) ? id : DEFAULT_TAB;
};

// The tabs the signed-in user is allowed to see (see tabsFor). Memoised so the
// list keeps its identity between renders and the effects below don't re-run.
export function useVisibleTabs() {
  const uploader = useIsUploader();
  return useMemo(() => tabsFor(uploader), [uploader]);
}

// The active tab, driven by window.location.hash. Two components use this
// independently (Navigation to highlight, BusWankersPage to show/hide), and
// because both listen to the same hashchange event they never disagree. A hash
// naming a tab the user may not see (#update-files, for a non-uploader) falls
// back to the landing tab, both on load and if their groups change later.
export function useActiveTab() {
  const available = useVisibleTabs();
  const [activeTab, setActiveTab] = useState(() => tabFromHash(available));

  useEffect(() => {
    setActiveTab(tabFromHash(available));
    const onHashChange = () => setActiveTab(tabFromHash(available));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [available]);

  const selectTab = useCallback((id) => {
    if (!available.some((t) => t.id === id)) return;
    if (window.location.hash === `#${id}`) {
      setActiveTab(id);
      return;
    }
    // Setting the hash fires hashchange, which updates state above. Using
    // the hash (rather than pushState) is deliberate: it's what makes the
    // in-page <a href="#test-form"> links work with no JS of their own.
    window.location.hash = id;
  }, [available]);

  return [activeTab, selectTab];
}
