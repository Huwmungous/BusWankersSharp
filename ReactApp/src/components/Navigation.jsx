import React from 'react';
import { TABS, useActiveTab } from '../tabs';
import { WHATSAPP_GROUP_URL } from '../links';
import './Navigation.css';

// The tab bar. Each entry is a real link to the tab's hash (#documentation,
// #test-form, ...) so tabs are bookmarkable and the browser back button
// walks between them; useActiveTab is what highlights the current one and
// what BusWankersPage uses to decide which tab body to show. The WhatsApp
// shortcut sits at the far end, and only when a link is configured.
const Navigation = () => {
  const [activeTab, selectTab] = useActiveTab();

  const onTabClick = (e, id) => {
    e.preventDefault();
    selectTab(id);
  };

  return (
    <nav className="navigation" aria-label="Page sections">
      <div className="nav-container">
        <a href="#documentation" className="nav-logo" onClick={(e) => onTabClick(e, 'documentation')}>
          Bus Wankers
        </a>
        <ul className="nav-menu" role="tablist">
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
        </ul>
      </div>
    </nav>
  );
};

export default Navigation;
