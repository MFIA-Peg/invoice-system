/* Shared navigation for the Power Energy static HTML application.
 * Include with: <script src="shared-nav.js" defer></script>
 * Export is delegated to the current page so it can honor that page's filters.
 */
(function () {
  'use strict';

  const items = [
  [
    "Dashboard",
    "dashboard.html"
  ],
  [
    "Customers",
    "companies.html"
  ],
  [
    "Departments",
    "departments.html"
  ],
  [
    "Projects",
    "projects.html"
  ],
  [
    "Purchase Orders",
    "purchase-orders.html"
  ],
  [
    "Invoices",
    "invoices.html"
  ],
  [
    "Collections",
    "collections.html"
  ],
  [
    "Reports",
    "reports.html"
  ],
  [
    "User Management",
    "user-management.html",
    "finance_manager"
  ]
];

  function role() {
    return String(sessionStorage.getItem('pe_user_role') || '').toLowerCase().trim();
  }

  function button(label, handler, className) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.className = className || '';
    el.addEventListener('click', handler);
    return el;
  }

  function mount() {
    if (document.getElementById('pe-global-nav')) return;
    const nav = document.createElement('nav');
    nav.id = 'pe-global-nav';
    nav.setAttribute('aria-label', 'Main navigation');
    nav.style.cssText = 'position:sticky;top:0;z-index:1500;background:#14263d;padding:10px 14px;box-shadow:0 2px 8px #0f172a22;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap;width:100%;box-sizing:border-box;margin:auto;';

    items.forEach(([label, href, requiredRole]) => {
      if (requiredRole && role() !== requiredRole) return;
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      a.style.cssText = 'display:inline-block;padding:8px 10px;border-radius:6px;background:#1e3a5f;color:#fff;text-decoration:none;font:600 14px Arial,sans-serif;';
      row.appendChild(a);
    });

    row.appendChild(button('Export to Excel', function () {
      if (typeof window.exportToExcel === 'function') window.exportToExcel();
      else alert('Excel export is not available on this screen yet.');
    }, 'pe-nav-export'));
    row.appendChild(button('Refresh', function () {
      if (typeof window.refreshDashboard === 'function') return window.refreshDashboard();
      if (typeof window.loadDashboard === 'function') return window.loadDashboard();
      if (typeof window.loadCollections === 'function') return window.loadCollections();
      if (typeof window.loadAll === 'function') return window.loadAll();
      window.location.reload();
    }));
    row.appendChild(button('Sign Out', async function () {
      if (typeof window.logoutUser === 'function') return window.logoutUser();
      try {
        const api = window.supabase;
        if (api && typeof window.client !== 'undefined' && window.client.auth) await window.client.auth.signOut();
      } finally {
        sessionStorage.clear();
        window.location.replace('login.html');
      }
    }, 'pe-nav-signout'));

    Array.from(row.querySelectorAll('button')).forEach((el) => {
      el.style.cssText += 'padding:8px 10px;border:0;border-radius:6px;background:#0f766e;color:#fff;font:600 14px Arial,sans-serif;cursor:pointer;';
    });
    const signOut = row.querySelector('.pe-nav-signout');
    if (signOut) signOut.style.background = '#b91c1c';
    nav.appendChild(row);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
