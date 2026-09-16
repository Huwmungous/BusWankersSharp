import { useCallback, useEffect, useState } from 'react';

// The page's tabs, in nav order. `id` doubles as the URL hash (#test-form),
// which is what makes a tab linkable/bookmarkable and lets ordinary <a href>
// links inside the page (e.g. Documentation's "try it on the test form")
// switch tabs without any prop drilling. Documentation is the landing tab.
export const TABS = [
  { id: 'update-files', label: 'Update Files' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'running-order', label: 'Running Order' },
  { id: 'test-form', label: 'Test Form' },
];

export const DEFAULT_TAB = 'documentation';

const isTab = (id) => TABS.some((t) => t.id === id);

const tabFromHash = () => {
  const id = (window.location.hash || '').replace(/^#/, '');
  return isTab(id) ? id : DEFAULT_TAB;
};

// The active tab, driven by window.location.hash. Two components use this
// independently (Navigation to highlight, BusWankersPage to show/hide), and
// because both listen to the same hashchange event they never disagree.
export function useActiveTab() {
  const [activeTab, setActiveTab] = useState(tabFromHash);

  useEffect(() => {
    const onHashChange = () => setActiveTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const selectTab = useCallback((id) => {
    if (!isTab(id)) return;
    if (window.location.hash === `#${id}`) {
      setActiveTab(id);
      return;
    }
    // Setting the hash fires hashchange, which updates state above. Using
    // the hash (rather than pushState) is deliberate: it's what makes the
    // in-page <a href="#test-form"> links work with no JS of their own.
    window.location.hash = id;
  }, []);

  return [activeTab, selectTab];
}
