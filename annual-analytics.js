(function (global) {
  'use strict';
  const year = Number(new Intl.DateTimeFormat('en', {timeZone: 'Asia/Riyadh', year: 'numeric'}).format(new Date()));
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const currency = new Intl.NumberFormat('en-SA', {style: 'currency', currency: 'SAR', maximumFractionDigits: 2});
  const number = value => Number(value || 0);
  const date = value => String(value || '').slice(0, 10);
  const inYear = value => /^\d{4}-\d{2}-\d{2}$/.test(date(value)) && Number(date(value).slice(0, 4)) === year;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  let data = {invoices: [], orders: [], projects: [], collections: []};
  let loading;
  async function rows(client, table) {
    const result = [];
    for (let from = 0; ; from += 1000) {
      const response = await client.from(table).select('*').order('id').range(from, from + 999);
      if (response.error) throw response.error;
      result.push(...(response.data || []));
      if (!response.data || response.data.length < 1000) return result;
      if (from >= 100000) throw new Error('Annual financial record limit exceeded');
    }
  }
  async function load(client) {
    if (loading) return loading;
    loading = Promise.all(['invoices', 'pos', 'projects', 'invoice_collections'].map(table => rows(client, table)))
      .then(([invoices, orders, projects, collections]) => { data = {invoices, orders, projects, collections}; })
      .finally(() => { loading = null; });
    return loading;
  }
  function due(invoice) {
    if (invoice.due_date) return date(invoice.due_date);
    if (!invoice.approval_date || invoice.payment_terms == null) return '';
    const value = new Date(date(invoice.approval_date) + 'T12:00:00Z');
    if (!Number.isFinite(value.getTime())) return '';
    value.setUTCDate(value.getUTCDate() + number(invoice.payment_terms));
    return value.toISOString().slice(0, 10);
  }
  function metrics(invoice, order) {
    const net = Math.max(0, number(invoice.invoice_amount) - number(invoice.advance_amortisation));
    const vat = order?.vat ? Math.round((net * 0.15 + Number.EPSILON) * 100) / 100 : 0;
    const total = net + vat;
    const retentionOnly=String(invoice.status||'').trim().toUpperCase()==='RETENTION';
    const recordedRetention = Math.max(0, number(invoice.retention_amount) + number(invoice.retention_vat) - number(invoice.retention_released_amount));
    const retention = retentionOnly?Math.min(recordedRetention,Math.max(0,total-number(invoice.paid_amount)-number(invoice.retention_released_amount))):recordedRetention;
    const balance = retentionOnly?0:Math.max(0, total - number(invoice.retention_amount) - number(invoice.retention_vat) - number(invoice.paid_amount));
    return {net, vat, total, retention, balance};
  }
  function snapshot(scope = {}) {
    const orderMap = new Map(data.orders.map(order => [String(order.po_no), order]));
    const projectMap = new Map(data.projects.map(project => [String(project.id), project]));
    const invoiceIds = scope.invoiceIds && new Set(scope.invoiceIds.map(String));
    const orderNos = scope.orderNos && new Set(scope.orderNos.map(String));
    const projectIds = scope.projectIds && new Set(scope.projectIds.map(String));
    const companies = scope.companies && new Set(scope.companies.map(String));
    const departments = scope.departments && new Set(scope.departments.map(String));
    const collectionIds = scope.collectionIds && new Set(scope.collectionIds.map(String));
    function dimension(row, order) {
      const project = projectMap.get(String(row.project_id ?? order?.project_id));
      return (!orderNos || orderNos.has(String(order?.po_no ?? row.po_no))) &&
        (!projectIds || projectIds.has(String(project?.id))) &&
        (!companies || companies.has(String(order?.company ?? project?.company ?? row.company))) &&
        (!departments || departments.has(String(order?.department ?? project?.department ?? row.department)));
    }
    const scoped = data.invoices.filter(invoice => {
      if (/^(cancelled|canceled|void)$/i.test(invoice.status || '')) return false;
      return (!invoiceIds || invoiceIds.has(String(invoice.id))) && dimension(invoice, orderMap.get(String(invoice.po_no)));
    });
    const scopedIds = new Set(scoped.map(invoice => String(invoice.id)));
    const annual = scoped.filter(invoice => {
      const value = due(invoice);
      return inYear(value) && (!scope.dueFrom || value >= scope.dueFrom) && (!scope.dueTo || value <= scope.dueTo);
    });
    const collections = data.collections.filter(collection => scopedIds.has(String(collection.invoice_id)) &&
      (!collectionIds || collectionIds.has(String(collection.id))) && inYear(collection.collection_date) &&
      (!scope.collectionFrom || date(collection.collection_date) >= scope.collectionFrom) &&
      (!scope.collectionTo || date(collection.collection_date) <= scope.collectionTo));
    const totals = {net: 0, vat: 0, total: 0, collected: 0, balance: 0, overdue: 0, pending: 0, retention: 0};
    for (const invoice of annual) {
      const m = metrics(invoice, orderMap.get(String(invoice.po_no)));
      for (const key of ['net', 'vat', 'total', 'balance', 'retention']) totals[key] += m[key];
      if (due(invoice) < today) totals.overdue += m.balance;
    }
    // Pending invoices have no due date until approved. Use their invoice issue year.
    for (const invoice of scoped) {
      if (!due(invoice) && !invoice.approval_date && inYear(invoice.start_date)) {
        totals.pending += metrics(invoice, orderMap.get(String(invoice.po_no))).total;
      }
    }
    totals.collected = collections.reduce((sum, collection) => sum + number(collection.amount), 0);
    const orders = data.orders.filter(order => dimension(order, order) && inYear(order.po_date) &&
      (!scope.orderFrom || date(order.po_date) >= scope.orderFrom) && (!scope.orderTo || date(order.po_date) <= scope.orderTo));
    const poValue = orders.reduce((sum, order) => sum + number(order.po_value_ex_vat), 0);
    const billedByOrder = new Map();
    for (const invoice of scoped) {
      const key = String(invoice.po_no);
      billedByOrder.set(key, (billedByOrder.get(key) || 0) + number(invoice.invoice_amount));
    }
    const remaining = orders.reduce((sum, order) => sum + Math.max(0, number(order.po_value_ex_vat) - (billedByOrder.get(String(order.po_no)) || 0)), 0);
    const activityIds = new Set([...annual.map(invoice => String(invoice.project_id)), ...orders.map(order => String(order.project_id))]);
    const collectedInvoiceIds = new Set(collections.map(collection => String(collection.invoice_id)));
    for (const invoice of scoped) if (collectedInvoiceIds.has(String(invoice.id))) activityIds.add(String(invoice.project_id));
    const paid = annual.filter(invoice => {
      const m = metrics(invoice, orderMap.get(String(invoice.po_no)));
      return m.balance <= 0.005 && m.retention <= 0.005;
    }).reduce((sum, invoice) => sum + metrics(invoice, orderMap.get(String(invoice.po_no))).total, 0);
    return {totals, annual, collections, orders, orderMap, poValue, remaining, activityIds, paid, scoped,
      advance: orders.reduce((sum, order) => sum + number(order.advance_received_amount), 0)};
  }
  const labels = [
    ['Invoice Value Ex VAT', 'net'], ['VAT', 'vat'], ['Invoice Total', 'total'],
    ['Collected', 'collected'], ['Open Balance', 'balance'], ['Overdue', 'overdue'],
    ['Pending Approval', 'pending'], ['Retention', 'retention']
  ];
  function style() {
    if (document.getElementById('peAnnualStyle')) return;
    const element = document.createElement('style');
    element.id = 'peAnnualStyle';
    element.textContent = '.pe-annual-note{font-size:13px;color:#64748b;margin:0 0 12px;grid-column:1/-1}.pe-annual-chart{display:grid;gap:12px;width:100%;height:auto!important;max-height:none!important;padding:12px 0}.pe-annual-row{display:grid;grid-template-columns:minmax(120px,175px) minmax(15px,1fr) minmax(90px,auto);gap:10px;align-items:center;font:15px/1.5 Inter,Segoe UI,Arial,sans-serif}.pe-annual-track{height:16px;background:#e2e8f0;border-radius:5px;position:relative;overflow:hidden}.pe-annual-fill{position:absolute;height:100%;background:#0f766e;border-radius:5px}.pe-annual-fill.negative{background:#b45309}.pe-annual-amount{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:#14263d}.pe-annual-chart-wrap{height:auto!important;min-height:0!important}.pe-annual-chart-wrap canvas{display:none}@media(max-width:650px){.pe-annual-row{grid-template-columns:minmax(90px,110px) 1fr minmax(65px,auto);font-size:13px}}';
    document.head.appendChild(element);
  }
  function chart(id, items) {
    let host = document.getElementById(id);
    if (!host) return;
    style();
    if (host.tagName === 'CANVAS') {
      const instance = global.Chart?.getChart?.(host);
      if (instance) instance.destroy();
      const replacement = document.createElement('div');
      replacement.id = id;
      host.replaceWith(replacement);
      host = replacement;
      host.parentElement.classList.add('pe-annual-chart-wrap');
    }
    host.classList.add('pe-annual-chart');
    const min = Math.min(0, ...items.map(([, value]) => number(value)));
    const max = Math.max(0, ...items.map(([, value]) => number(value)));
    const range = max - min || 1;
    host.innerHTML = items.map(([label, raw]) => {
      const value = number(raw);
      return '<div class="pe-annual-row"><span>' + esc(label) + '</span><div class="pe-annual-track" aria-hidden="true"><div class="pe-annual-fill' +
        (value < 0 ? ' negative' : '') + '" style="left:' + ((Math.min(0, value) - min) / range * 100) +
        '%;width:' + (Math.abs(value) / range * 100) + '%"></div></div><span class="pe-annual-amount">' + esc(currency.format(value)) + '</span></div>';
    }).join('');
  }
  function render(kpiId, chartId, scope) {
    const host = document.getElementById(kpiId);
    if (!host) return;
    style();
    const s = snapshot(scope);
    const note = year + ' · Invoices by due date · Collections by payment date · Pending approval by invoice date';
    let cards = labels.map(([label, key]) => [label, s.totals[key], key === 'collected' ? 'Payment date' : key === 'pending' ? 'Invoice date · awaiting approval' : 'Invoice due date', false]);
    const moneyCard = (label, value, basis = 'Invoice due date') => [label, value, basis, false];
    const countCard = (label, value, basis = 'Activity in current year') => [label, value, basis, true];
    const poBasis = 'PO date · undated POs excluded';
    const profile = scope?.profile;
    if (profile === 'customers') cards = [
      moneyCard('Purchase Order Value', s.poValue, poBasis), moneyCard('Purchase Order Balance', s.remaining, poBasis),
      moneyCard('Billing', s.totals.total), moneyCard('Paid', s.paid),
      moneyCard('Collected', s.totals.collected, 'Payment date'), moneyCard('Outstanding Balance', s.totals.balance + s.totals.retention),
      moneyCard('Pending Approval', s.totals.pending, 'Invoice date · awaiting approval'), moneyCard('Overdue Balance', s.totals.overdue),
      moneyCard('Not Yet Due', Math.max(0, s.totals.balance - s.totals.overdue)), moneyCard('Retention', s.totals.retention)
    ];
    if (profile === 'projects') cards = [
      countCard('Projects', s.activityIds.size), countCard('Purchase Orders', s.orders.length, poBasis),
      moneyCard('PO Value', s.poValue, poBasis), moneyCard('Invoiced', s.totals.net),
      moneyCard('Collected', s.totals.collected, 'Payment date'), moneyCard('Open Balance', s.totals.balance),
      moneyCard('Overdue', s.totals.overdue), moneyCard('Retention', s.totals.retention)
    ];
    if (profile === 'orders') cards = [
      countCard('Purchase Orders', s.orders.length, poBasis), moneyCard('PO Value', s.poValue, poBasis),
      moneyCard('Invoiced', s.totals.net), moneyCard('Remaining PO Value', s.remaining, poBasis),
      countCard('Open POs', s.orders.filter(order => !order.archive && !/closed/i.test(order.status || '')).length, poBasis),
      moneyCard('Advance Received', s.advance, poBasis)
    ];
    if (profile === 'invoices') cards = [countCard('Invoices', s.annual.length, 'Invoice due date'), ...cards.filter(card => !['Pending Approval'].includes(card[0]))].slice(0, 8);
    if (profile === 'collections') {
      const amounts = s.collections.map(collection => number(collection.amount));
      const methodCount = new Set(s.collections.map(collection => collection.payment_method).filter(Boolean)).size;
      const invoiceIds = new Set(s.collections.map(collection => String(collection.invoice_id)));
      const customerNames = new Set(data.invoices.filter(invoice => invoiceIds.has(String(invoice.id))).map(invoice => s.orderMap.get(String(invoice.po_no))?.company).filter(Boolean));
      cards = [moneyCard('Total Collected', s.totals.collected, 'Payment date'),
        countCard('Transactions', s.collections.length, 'Payment date'), countCard('Invoices With Collections', invoiceIds.size, 'Payment date'),
        countCard('Customers', customerNames.size, 'Payment date'), countCard('Payment Methods', methodCount, 'Payment date'),
        moneyCard('Average Collection', amounts.length ? s.totals.collected / amounts.length : 0, 'Payment date'),
        moneyCard('Largest Collection', Math.max(0, ...amounts), 'Payment date'),
        ['Latest Collection', s.collections.map(collection => date(collection.collection_date)).sort().at(-1) || '—', 'Payment date', 'date']];
    }
    host.innerHTML = '<p class="pe-annual-note">' + note + '</p>' + cards.map(([label, value, basis, kind]) =>
      '<article class="kpi"><div class="label">' + label + '</div><div class="value">' + esc(kind === 'date' ? value : kind ? Number(value).toLocaleString('en-SA') : currency.format(value)) +
      '</div><div class="sub">' + year + ' · ' + basis + '</div></article>'
    ).join('');
    host.style.setProperty('--kpi-columns', String(Math.ceil(cards.length / 2)));
    if (chartId) chart(chartId, cards.filter(card => !card[3]).map(([label, value]) => [label, value]));
    return s;
  }
  global.PEAnnual = {load, render, chart, snapshot, year, inYear, due, metrics, records: () => data};
})(window);
