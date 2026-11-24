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
  async function load(client, options = {}) {
    if (loading) return loading;
    loading = Promise.all(['invoices', 'pos', 'projects', 'invoice_collections'].map(table => table === 'invoices' && options.invoices ? Promise.resolve(options.invoices) : rows(client, table)))
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
  const round = value => Math.round((number(value)+Number.EPSILON)*100)/100;
  function workflow(invoice) {
    const status=String(invoice.status||'').trim().toLowerCase();
    if (/^(cancelled|canceled|void)$/.test(status)) return 'cancelled';
    if (status==='draft') return 'draft';
    if (/^(?:[12]-)?(?:submitted|pending|pending approval|awaiting approval|waiting approval|waiting for approval)$/.test(status)) return 'waiting';
    return 'issued';
  }
  const isIssued=invoice=>workflow(invoice)==='issued';
  let indexedOrders,byOrderId,byOrderNo;
  function orderFor(invoice) {
    if(indexedOrders!==data.orders){indexedOrders=data.orders;byOrderId=new Map(data.orders.map(p=>[String(p.id),p]));byOrderNo=new Map(data.orders.map(p=>[String(p.po_no),p]));}
    return (invoice.pos_id!=null&&byOrderId.get(String(invoice.pos_id)))||byOrderNo.get(String(invoice.po_no));
  }
  function orderGross(order) {return round(number(order?.po_value_ex_vat)*(order?.vat?1.15:1));}
  function metrics(invoice, order=orderFor(invoice)) {
    const net=round(Math.max(0,number(invoice.invoice_amount)));
    const taxable=order?.vat ?? invoice.vat_applicable;
    const vat=round(taxable!=null?(taxable?net*.15:0):Math.max(0,number(invoice.vat_amount??invoice.vat_after_advance)));
    const total=round(net+vat),advanceEx=Math.min(net,Math.max(0,number(invoice.advance_amortisation)));
    const payableNet=round(net-advanceEx),payableVat=round(taxable!=null?(taxable?payableNet*.15:0):net?vat*payableNet/net:0);
    const payableTotal=round(payableNet+payableVat),advance=round(total-payableTotal);
    const released=Math.max(0,number(invoice.retention_released_amount));
    const collected=round(Math.min(payableTotal,Math.max(0,number(invoice.paid_amount))+released));
    const remaining=round(Math.max(0,payableTotal-collected));
    const recordedRetention=round(Math.max(0,number(invoice.retention_amount)+number(invoice.retention_vat)-released));
    const retention=String(invoice.status||'').trim().toUpperCase()==='RETENTION'?remaining:Math.min(recordedRetention,remaining);
    const balance=round(remaining-retention),d=due(invoice),overdue=d&&d<today?balance:0,notDue=round(balance-overdue);
    return {net,vat,total,payableTotal,advance,advanceEx,collected,remaining,retention,balance,overdue,notDue};
  }
  function unique(rows) {const seen=new Set();return rows.filter(row=>row.id==null||!seen.has(String(row.id))&&seen.add(String(row.id)));}
  function snapshot(scope = {}) {
    const orderMap=new Map(data.orders.map(p=>[String(p.po_no),p])),projectMap=new Map(data.projects.map(p=>[String(p.id),p]));
    const set=values=>values&&new Set(values.map(String));
    const invoiceIds=set(scope.invoiceIds),orderNos=set(scope.orderNos),projectIds=set(scope.projectIds),companies=set(scope.companies),departments=set(scope.departments),collectionIds=set(scope.collectionIds);
    function dimension(row,order) {
      const project=projectMap.get(String(row.project_id??order?.project_id));
      return (!orderNos||orderNos.has(String(order?.po_no??row.po_no)))&&(!projectIds||projectIds.has(String(project?.id)))&&(!companies||companies.has(String(order?.company??project?.company??row.company)))&&(!departments||departments.has(String(order?.department??project?.department??row.department)));
    }
    const scoped=unique(data.invoices).filter(i=>workflow(i)!=='cancelled'&&(!invoiceIds||invoiceIds.has(String(i.id)))&&dimension(i,orderFor(i)));
    const period=(d,from,to)=>inYear(d)&&(!from||d>=from)&&(!to||d<=to);
    const annual=scoped.filter(i=>isIssued(i)&&period(due(i)||date(i.start_date),scope.dueFrom,scope.dueTo));
    const draft=scoped.filter(i=>workflow(i)==='draft'&&period(date(i.start_date),scope.dueFrom,scope.dueTo));
    const waiting=scoped.filter(i=>workflow(i)==='waiting'&&period(date(i.start_date),scope.dueFrom,scope.dueTo));
    const scopedIds=new Set(scoped.map(i=>String(i.id)));
    const collections=unique(data.collections).filter(c=>scopedIds.has(String(c.invoice_id))&&(!collectionIds||collectionIds.has(String(c.id)))&&period(date(c.collection_date),scope.collectionFrom,scope.collectionTo));
    const totals={net:0,vat:0,total:0,collected:0,settled:0,advanceApplied:0,balance:0,notDue:0,overdue:0,pending:0,draft:0,retention:0};
    for(const invoice of annual){const m=metrics(invoice,orderFor(invoice));for(const key of ['net','vat','total','balance','notDue','overdue','retention'])totals[key]+=m[key];totals.settled+=m.collected;totals.advanceApplied+=m.advance;}
    totals.draft=draft.reduce((v,i)=>v+metrics(i,orderFor(i)).total,0);
    totals.pending=waiting.reduce((v,i)=>v+metrics(i,orderFor(i)).total,0);
    totals.collected=collections.reduce((v,c)=>v+number(c.amount),0);
    for(const key of Object.keys(totals))totals[key]=round(totals[key]);
    const orders=unique(data.orders).filter(p=>dimension(p,p)&&period(date(p.po_date),scope.orderFrom,scope.orderTo));
    const billedByOrder=new Map();
    for(const i of unique(data.invoices)){if(!isIssued(i))continue;const po=orderFor(i);if(!po)continue;const key=String(po.id);billedByOrder.set(key,(billedByOrder.get(key)||0)+metrics(i,po).total);}
    const poValue=round(orders.reduce((v,p)=>v+orderGross(p),0));
    const remaining=round(orders.reduce((v,p)=>v+Math.max(0,orderGross(p)-(billedByOrder.get(String(p.id))||0)),0));
    const poInvoiced=round(orders.reduce((v,p)=>v+(billedByOrder.get(String(p.id))||0),0));
    const activityIds=new Set([...annual.map(i=>String(i.project_id)),...orders.map(p=>String(p.project_id))]);
    const collectedIds=new Set(collections.map(c=>String(c.invoice_id)));
    for(const i of scoped)if(collectedIds.has(String(i.id)))activityIds.add(String(i.project_id));
    const paid=annual.filter(i=>metrics(i,orderFor(i)).remaining<=.005).reduce((v,i)=>v+metrics(i,orderFor(i)).total,0);
    return {totals,annual,draft,waiting,collections,orders,orderMap,poValue,remaining,poInvoiced,activityIds,paid,scoped,advance:orders.reduce((v,p)=>v+number(p.advance_received_amount),0)};
  }
  const labels = [
    ['Invoice Total Incl VAT','total'],['Settled Against Invoices','settled'],['Advance Applied Incl VAT','advanceApplied'],
    ['Not Yet Due','notDue'],['Overdue','overdue'],['Retention','retention'],
    ['Draft','draft'],['Waiting For approval','pending'],['Cash Received (period)','collected']
  ];
  function style() {
    if (document.getElementById('peAnnualStyle')) return;
    const element = document.createElement('style');
    element.id = 'peAnnualStyle';
    element.textContent = '.pe-annual-note{font-size:13px;color:#64748b;margin:0 0 12px;grid-column:1/-1}.pe-annual-chart{display:grid;gap:12px;width:100%;height:auto!important;max-height:none!important;padding:12px 0}.pe-annual-row{display:grid;grid-template-columns:minmax(120px,175px) minmax(15px,1fr) minmax(90px,auto);gap:10px;align-items:center;font:15px/1.5 Inter,Segoe UI,Arial,sans-serif}.pe-annual-track{height:16px;background:#e2e8f0;border-radius:5px;position:relative;overflow:hidden}.pe-annual-fill{position:absolute;height:100%;background:#0f766e;border-radius:5px}.pe-annual-fill.negative{background:#b45309}.pe-annual-amount{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:#14263d}.pe-annual-chart-wrap{height:auto!important;min-height:0!important}.pe-annual-chart-wrap canvas{display:none}@media(max-width:650px){.pe-annual-row{grid-template-columns:minmax(90px,110px) 1fr minmax(65px,auto);font-size:13px}}';
    document.head.appendChild(element);
  }
  function chart(id, items) {
    if(!location.pathname.endsWith('/dashboard.html'))return;
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
    const note=year+' · All financial totals include VAT · Issued invoices by due date (issue date if undated); draft/waiting by issue date; cash by payment date. Invoice Total is a control total: settled + allocated advance + not yet due + overdue + retention. Cash received is a separate period flow. Current register filters apply.';
    const profile=scope?.profile;
    const moneyCard=(label,value,basis='Incl VAT')=>[label,value,basis,false];
    const countCard=(label,value,basis='Current-year activity')=>[label,value,basis,true];
    const countMetric=key=>s.annual.filter(i=>Math.abs(metrics(i,orderFor(i))[key])>.005).length;
    const counts={total:s.annual.length,settled:countMetric('collected'),advanceApplied:countMetric('advance'),notDue:countMetric('notDue'),overdue:countMetric('overdue'),retention:countMetric('retention'),draft:s.draft.length,pending:s.waiting.length,collected:new Set(s.collections.map(c=>String(c.invoice_id))).size};
    let cards=labels.map(([label,key])=>[label,s.totals[key],key==='collected'?'Payment date · separate cash flow':key==='draft'||key==='pending'?'Invoice date · outside issued total':key==='total'?'Control total · Incl VAT':'Due-date invoice cohort · Incl VAT',false,counts[key]]);
    const poBasis='PO date · Incl VAT · separate contract totals';
    if(profile==='customers')cards=[moneyCard('Purchase Order Value Incl VAT',s.poValue,poBasis),moneyCard('Purchase Order Balance Incl VAT',s.remaining,poBasis),...cards];
    if(profile==='projects')cards=[countCard('Projects',s.activityIds.size),countCard('Purchase Orders',s.orders.length,poBasis),moneyCard('PO Value Incl VAT',s.poValue,poBasis),...cards];
    if(profile==='orders')cards=[countCard('Purchase Orders',s.orders.length,poBasis),moneyCard('PO Value Incl VAT',s.poValue,poBasis),moneyCard('PO Invoiced Incl VAT',s.poInvoiced,poBasis),moneyCard('Remaining PO Value Incl VAT',s.remaining,poBasis)];
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
    host.innerHTML = '<p class="pe-annual-note">' + note + '</p>' + cards.map(([label, value, basis, kind, invoiceCount]) =>
      '<article class="kpi"><div class="label">' + label + '</div><div class="value">' + esc(kind === 'date' ? value : kind ? Number(value).toLocaleString('en-SA') : currency.format(value)) +
      '</div><div class="sub">' + year + ' · ' + basis + (invoiceCount == null ? '' : '<br><span class="pe-invoice-count">' + invoiceCount + ' invoices</span>') + '</div></article>'
    ).join('');
    host.style.setProperty('--kpi-columns', String(Math.ceil(cards.length / 2)));
    if (chartId) chart(chartId, cards.filter(card => !card[3]).map(([label, value]) => [label, value]));
    global.PEKPIFilter?.bind(host,s,scope);
    return s;
  }
  global.PEAnnual = {load, render, chart, snapshot, year, inYear, due, metrics,workflow,isIssued,orderGross,orderFor,round,records: () => data};
})(window);

(function(global){
'use strict';
let active=null;const str=v=>String(v??''),num=v=>Number(v||0),positive=v=>Math.abs(num(v))>.005;
function selection(s,label,profile){
 const A=PEAnnual,records=A.records(),metric=i=>A.metrics(i,A.orderFor(i)),norm=label.toLowerCase();
 let invoices=[],orders=[],collections=[],projects=[];
 if(profile==='collections'||/^(collected|total collected|cash received \(period\))$/.test(norm)){
  collections=s.collections;
  if(norm==='largest collection'){const max=Math.max(0,...collections.map(c=>num(c.amount)));collections=collections.filter(c=>num(c.amount)===max);}
  if(norm==='latest collection'){const latest=collections.map(c=>str(c.collection_date)).sort().at(-1);collections=collections.filter(c=>str(c.collection_date)===latest);}
  const ids=new Set(collections.map(c=>str(c.invoice_id)));invoices=s.scoped.filter(i=>ids.has(str(i.id)));
 }else if(/purchase order|^po |^open pos$|^advance received$|^remaining po value/.test(norm)){
  orders=s.orders;
  const issuedFor=p=>records.invoices.filter(i=>A.isIssued(i)&&str(A.orderFor(i)?.id)===str(p.id));
  if(/balance|remaining/.test(norm))orders=orders.filter(p=>A.orderGross(p)-issuedFor(p).reduce((v,i)=>v+A.metrics(i,p).total,0)>.005);
  else if(/invoiced/.test(norm))orders=orders.filter(p=>issuedFor(p).length>0);
  else if(norm==='open pos')orders=orders.filter(p=>!p.archive&&!/closed/i.test(p.status||''));
  else if(norm==='advance received')orders=orders.filter(p=>positive(p.advance_received_amount));
  else if(!/purchase orders/.test(norm))orders=orders.filter(p=>positive(p.po_value_ex_vat));
 }else if(norm==='projects')projects=records.projects.filter(p=>s.activityIds.has(str(p.id)));
 else if(norm==='draft'||norm==='waiting for approval'||norm==='pending approval'){
  invoices=norm==='draft'?s.draft:s.waiting;
 }else{
  invoices=s.annual.filter(i=>{
   const m=metric(i),due=A.due(i),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   if(norm==='settled against invoices')return m.collected>.005;
   if(/advance applied/.test(norm))return m.advance>.005;
   if(norm==='paid')return m.remaining<=.005;
   if(/not yet due/.test(norm))return m.notDue>.005;
   if(/overdue/.test(norm))return m.overdue>.005;
   if(/outstanding/.test(norm))return m.balance+m.retention>.005;
   if(/balance/.test(norm))return m.balance>.005;
   if(/retention/.test(norm))return m.retention>.005;
   if(norm==='vat')return positive(m.vat);
   return true;
  });
 }
 const invoiceIds=new Set(invoices.map(i=>str(i.id))),orderIds=new Set(orders.map(p=>str(p.id))),projectIds=new Set(projects.map(p=>str(p.id)));
 for(const i of invoices){const po=A.orderFor(i);if(po)orderIds.add(str(po.id));if(i.project_id!=null)projectIds.add(str(i.project_id));}
 for(const p of records.orders)if(orderIds.has(str(p.id))&&p.project_id!=null)projectIds.add(str(p.project_id));
 const companies=new Set(),departments=new Set();
 for(const p of records.orders)if(orderIds.has(str(p.id))){companies.add(str(p.company));departments.add(str(p.department));}
 for(const p of projects){companies.add(str(p.company));departments.add(str(p.department));}
 for(const i of invoices)if(!A.orderFor(i)){const p=records.projects.find(p=>str(p.id)===str(i.project_id));companies.add(str(p?.company??i.company));departments.add(str(p?.department??i.department));}
 return {invoiceIds,orderIds,projectIds,companies,departments,collectionIds:new Set(collections.map(c=>str(c.id)))};
}
function matches(row,type,pick){return type==='invoice'?pick.invoiceIds.has(str(row.id)):type==='order'?pick.orderIds.has(str(row.id)):type==='project'?pick.projectIds.has(str(row.id)):type==='collection'?pick.collectionIds.has(str(row.id)):type==='customer'?pick.companies.has(str(row.name)):type==='department'?pick.departments.has(str(row.name)):false;}
function filter(rows,type,scope){if(!active||active.custom)return rows;const pick=selection(PEAnnual.snapshot(scope),active.label,active.profile);return rows.filter(row=>matches(row,type,pick));}
function changed(){document.dispatchEvent(new CustomEvent('pe-kpi-filter'));}
function clear(){active=null;changed();}
function decorate(node,label,activate){node.setAttribute('role','button');node.tabIndex=0;node.style.cursor='pointer';node.setAttribute('aria-pressed',String(active?.label===label));node.classList.toggle('pe-kpi-selected',active?.label===label);node.title='Filter records: '+label;node.onclick=activate;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};}
function toolbar(host){
 let bar=document.getElementById('peKpiFilterBar');if(!bar){bar=document.createElement('div');bar.id='peKpiFilterBar';bar.style.cssText='display:flex;align-items:center;gap:12px;margin:6px 0;font-size:12px';host.parentElement.insertBefore(bar,host);}
 bar.replaceChildren();bar.hidden=!active;bar.style.display=active?'flex':'none';if(active){const text=document.createElement('span');text.textContent='Filter / فلتر: '+active.label;const b=document.createElement('button');b.type='button';b.textContent='Clear total filter / إلغاء فلتر المجموع';b.onclick=clear;bar.append(text,b);}
 if(!document.getElementById('peKpiFilterStyle')){const style=document.createElement('style');style.id='peKpiFilterStyle';style.textContent='.pe-kpi-selected{outline:2px solid #2563eb;outline-offset:-2px;background:#eff6ff!important}.kpi[role=button]:focus-visible{outline:3px solid #60a5fa}';document.head.append(style);}
}
function bind(host,s,scope={}){
 if(!host)return;toolbar(host);
 host.querySelectorAll('.kpi').forEach(node=>{const label=node.querySelector('.label')?.textContent.trim();if(!label)return;decorate(node,label,()=>{active=active?.label===label?null:{label,profile:scope.profile};changed();});});
}
function bindDonuts(host,s){
 toolbar(host);host.querySelectorAll('.pe-donut-legend>div,.pe-donut-legend>button').forEach(node=>{const label=node.querySelector('.pe-donut-key')?.textContent.trim();if(!label)return;decorate(node,label,()=>{active=active?.label===label?null:{label,profile:label==='Pending Approval'?'dashboard-waiting':undefined};changed();});});
}
function filterOrders(rows,metrics){if(!active?.custom)return rows;return rows.filter(p=>positive(/^PO Value/.test(active.label)?p.po_value_ex_vat:metrics(p)[/Balance|Remaining/.test(active.label)?'remaining':'invoiced']));}
function bindOrders(host){toolbar(host);host.querySelectorAll('.kpi').forEach(node=>{const label=node.querySelector('.label').textContent.trim();decorate(node,label,()=>{active=active?.label===label?null:{label,custom:true};changed();});});}
global.PEKPIFilter={selection,filter,filterOrders,bind,bindOrders,bindDonuts,clear,active:()=>active,matches};
document.addEventListener('click',event=>{if(event.target.closest?.('#clear,#clearFilters,#customerClear,[onclick="clearFilters()"],[onclick="resetFilters()"]'))active=null;},true);
})(window);
