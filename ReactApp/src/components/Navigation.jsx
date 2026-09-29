import React, { useEffect, useRef } from 'react';
import { TABS, useActiveTab } from '../tabs';
import { WHATSAPP_GROUP_URL } from '../links';
import InstallPrompt from './InstallPrompt';
import LogoutButton from './LogoutButton';
import './Navigation.css';

// The tab bar. Each entry is a real link to the tab's hash (#documentation,
// #test-form, ...) so tabs are bookmarkable and the browser back button
// walks between them; useActiveTab is what highlights the current one and
// what BusWankersPage uses to decide which tab body to show. The WhatsApp
// shortcut sits at the far end, and only when a link is configured.
const Navigation = () => {
  const [activeTab, selectTab] = useActiveTab();
  const menuRef = useRef(null);

  const onTabClick = (e, id) => {
    e.preventDefault();
    selectTab(id);
  };

  // On tablets and phones the tabs are one horizontally scrolling row, so keep
  // the active tab centred in it (including when a tab is switched by an
  // in-page link or the URL hash). This scrolls the strip itself rather than
  // using scrollIntoView, which would also drag the page up to the nav bar.
  useEffect(() => {
    const menu = menuRef.current;
    const active = menu && menu.querySelector('.nav-link-active');
    const item = active && active.parentElement;
    if (!menu || !item) return;
    menu.scrollLeft = Math.max(0, item.offsetLeft - (menu.clientWidth - item.offsetWidth) / 2);
  }, [activeTab]);

  return (
    <>
      <InstallPrompt />
      <nav className="navigation" aria-label="Page sections">
        <div className="nav-container">
          <a href="#documentation" className="nav-logo" onClick={(e) => onTabClick(e, 'documentation')}>
            <img src={`${process.env.PUBLIC_URL}/nav-logo.png`} alt="" className="nav-logo-image" />
            Bus Wankers
          </a>
          <ul className="nav-menu" role="tablist" ref={menuRef}>
            {TABS.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <li key={tab.id} className="nav-item" role="presentation">
                  <a
                    href={`#${tab.id}`}
                    className={`nav-link${active ? ' nav-link-active' : ''}`}
                    role="tab"
                    aria-selected={active}
                    aria-controls={`tab-${tab.id}`}
                    onClick={(e) => onTabClick(e, tab.id)}
                  >
                    {tab.label}
                  </a>
                </li>
              );
            })}
            {WHATSAPP_GROUP_URL && (
              <li className="nav-item nav-item-whatsapp" role="presentation">
                <a
                  href={WHATSAPP_GROUP_URL}
                  className="nav-link nav-link-whatsapp"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the Bus Wankers WhatsApp group"
                >
                  WhatsApp
                </a>
              </li>
            )}
            <li className="nav-item nav-item-logout" role="presentation">
              <LogoutButton />
            </li>
          </ul>
        </div>
      </nav>
    </>
  );
};

export default Navigation;
