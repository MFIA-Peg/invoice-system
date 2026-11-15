(function () {
  const NAV_ITEMS = [
    { label: 'Dashboard', href: 'dashboard.html' },
    { label: 'Departments', href: 'reports.html' },
    { label: 'Customers', href: 'companies.html' },
    { label: 'Projects', href: 'companies.html' },
    { label: 'Purchase Orders', href: 'companies.html' },
    { label: 'Invoices', href: 'reports.html' },
    { label: 'Collections', href: 'collections.html' },
    { label: 'Reports', href: 'reports.html' },
    { label: 'User Management', href: 'user-management.html', role: 'finance_manager' },
    { label: 'Export to Excel', action: 'export' },
    { label: 'Refresh', action: 'refresh' },
    { label: 'Sign Out', action: 'logout' }
  ];

  function getRole() {
    return String(sessionStorage.getItem('pe_user_role') || '').toLowerCase();
  }

  function exportCurrentView() {
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find(t => t.querySelectorAll('tr').length > 1) || tables[0];
    if (!table) {
      alert('No table available to export on this screen.');
      return;
    }

    const rows = Array.from(table.querySelectorAll('tr')).map(row => {
      return Array.from(row.children).map(cell => {
        return '"' + String(cell.textContent || '').replace(/"/g, '""') + '"';
      }).join(',');
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (document.title || 'report') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function refreshCurrentView() {
    if (typeof window.loadDashboard === 'function') return window.loadDashboard();
    if (typeof window.loadCollections === 'function') return window.loadCollections();
    if (typeof window.loadAll === 'function') return window.loadAll();
    if (typeof window.refreshDashboard === 'function') return window.refreshDashboard();
    window.location.reload();
  }

  function signOutCurrentUser() {
    if (typeof window.logoutUser === 'function') {
      return window.logoutUser();
    }

    sessionStorage.clear();
    window.location.replace('login.html');
  }

  function handleNavAction(item) {
    if (item.action === 'export') return exportCurrentView();
    if (item.action === 'refresh') return refreshCurrentView();
    if (item.action === 'logout') return signOutCurrentUser();
    if (item.href) {
      window.location.href = item.href;
    }
  }

  function buildNav() {
    if (document.getElementById('power-energy-nav')) return;

    const nav = document.createElement('div');
    nav.id = 'power-energy-nav';
    nav.style.position = 'sticky';
    nav.style.top = '0';
    nav.style.zIndex = '1000';
    nav.style.background = '#14263d';
    nav.style.borderBottom = '1px solid #e2e8f0';
    nav.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.08)';
    nav.style.padding = '10px 14px';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.gap = '8px';
    row.style.alignItems = 'center';

    const role = getRole();
    NAV_ITEMS.forEach(item => {
      if (item.role && role !== item.role) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.style.padding = '8px 12px';
      button.style.borderRadius = '7px';
      button.style.border = 'none';
      button.style.background = item.action === 'logout' ? '#b91c1c' : item.action === 'export' ? '#0f766e' : '#1d4ed8';
      button.style.color = '#fff';
      button.style.cursor = 'pointer';
      button.style.fontWeight = '700';
      button.style.fontSize = '12px';
      button.style.lineHeight = '1.2';

      if (item.action || item.href) {
        button.addEventListener('click', () => handleNavAction(item));
      }

      row.appendChild(button);
    });

    nav.appendChild(row);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildNav, { once: true });
  } else {
    buildNav();
  }

  window.powerNav = buildNav;
})();
