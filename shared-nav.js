
/* Power Energy — Shared Navigation */
(function () {
  'use strict';

 const items = [
  ['Dashboard', 'dashboard.html'],
  ['Customers', 'companies.html'],
  ['Departments', 'departments.html'],
  ['Projects', 'projects.html'],
  ['Purchase Orders', 'purchase-orders.html'],
  ['Invoices', 'invoices.html'],
  ['Collections', 'collections.html'],
  ['Reports', 'reports.html'],
  ['User Management', 'user-management.html', 'finance_manager']
];

  function role() {
    return String(sessionStorage.getItem('pe_user_role') || '')
      .toLowerCase().trim();
  }

  function mount() {
    if (document.getElementById('pe-global-nav')) return;

    const nav = document.createElement('nav');
    nav.id = 'pe-global-nav';
    nav.setAttribute('aria-label', 'Main navigation');

    nav.style.cssText =
      'position:sticky;top:0;z-index:1500;' +
      'background:#14263d;padding:12px 18px;' +
      'box-shadow:0 3px 16px #14263d20;';

    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:8px;' +
      'flex-wrap:wrap;max-width:1600px;margin:auto;';

    const brand = document.createElement('strong');
    brand.textContent = 'POWER ENERGY';
    brand.style.cssText =
      'color:white;font:800 15px Arial,sans-serif;' +
      'margin-right:15px;';

    row.appendChild(brand);

    items.forEach(([label, href, requiredRole]) => {
      if (requiredRole && role() !== requiredRole) return;

      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;

      const current = location.pathname.split('/').pop();
      const active = current === href.split('?')[0];

      a.style.cssText =
        'padding:9px 12px;border-radius:7px;' +
        'color:white;text-decoration:none;' +
        'font:600 12px Arial,sans-serif;' +
        'background:' + (active ? '#2563eb' : '#1e3a5f') + ';';

      row.appendChild(a);
    });

    function addButton(label, handler, color) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText =
        'padding:9px 12px;border:0;border-radius:7px;' +
        'background:' + color + ';color:white;' +
        'font:600 12px Arial,sans-serif;cursor:pointer;';
      b.addEventListener('click', handler);
      row.appendChild(b);
    }

    addButton('Export to Excel', () => {
      if (typeof window.exportToExcel === 'function') {
        window.exportToExcel();
      } else {
        alert('Excel export is not available on this page yet.');
      }
    }, '#0f766e');

    addButton('Refresh', () => {
      if (typeof window.refreshDashboard === 'function')
        return window.refreshDashboard();

      if (typeof window.loadDashboard === 'function')
        return window.loadDashboard();

      if (typeof window.fetchAll === 'function')
        return window.fetchAll();

      if (typeof window.loadCollections === 'function')
        return window.loadCollections();

      location.reload();
    }, '#2563eb');

    addButton('Sign Out', async () => {
      if (typeof window.logoutUser === 'function') {
        return window.logoutUser();
      }

      if (!confirm('Sign out of Power Energy?')) return;

      sessionStorage.clear();
      location.replace('login.html');
    }, '#b91c1c');

    nav.appendChild(row);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
