(function (global) {
  'use strict';
  let year = Number(new Intl.DateTimeFormat('en', {timeZone: 'Asia/Riyadh', year: 'numeric'}).format(new Date()));
  let today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  function refreshClock(){today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());year=Number(today.slice(0,4));}
  const currency = new Intl.NumberFormat('en-SA', {style: 'currency', currency: 'SAR', maximumFractionDigits: 2});
  const number = value => Number(value || 0);
  const date = value => String(value || '').slice(0, 10);
  const inYear = value => /^\d{4}-\d{2}-\d{2}$/.test(date(value)) && Number(date(value).slice(0, 4)) === year;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  let data = {invoices: [], orders: [], projects: [], collections: [], advances: []};
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
    refreshClock();
    if (loading) return loading;
    loading = Promise.all(['invoices', 'pos', 'projects', 'invoice_collections', 'po_advance_payments'].map(table => table === 'invoices' && options.invoices ? Promise.resolve(options.invoices) : rows(client, table)))
      .then(([invoices, orders, projects, collections, advances]) => { data = {invoices, orders, projects, collections, advances, loaded:true}; })
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
  const isRetainedInvoice=invoice=>isIssued(invoice)&&String(invoice.invoice_no||'').trim()&&/^(approved|3-approved|partially paid|completed|paid|retention|bad debit)$/i.test(String(invoice.status||'').trim());
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
    refreshClock();
    const orderMap=new Map(data.orders.map(p=>[String(p.po_no),p])),projectMap=new Map(data.projects.map(p=>[String(p.id),p]));
    const set=values=>values&&new Set(values.map(String));
    const invoiceIds=set(scope.invoiceIds),orderNos=set(scope.orderNos),projectIds=set(scope.projectIds),companies=set(scope.companies),departments=set(scope.departments),collectionIds=set(scope.collectionIds),orderScopeIds=set(scope.orderScopeIds);
    function dimension(row,order) {
      const project=projectMap.get(String(row.project_id??order?.project_id));
      return (!orderNos||orderNos.has(String(order?.po_no??row.po_no)))&&(!projectIds||projectIds.has(String(project?.id)))&&(!companies||companies.has(String(order?.company??project?.company??row.company)))&&(!departments||departments.has(String(order?.department??project?.department??row.department)));
    }
    const scoped=unique(data.invoices).filter(i=>workflow(i)!=='cancelled'&&(!invoiceIds||invoiceIds.has(String(i.id)))&&dimension(i,orderFor(i)));
    const periodFrom=scope.periodFrom??scope.dueFrom??scope.collectionFrom??'',periodTo=scope.periodTo??scope.dueTo??scope.collectionTo??'';
    const period=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&(!periodFrom&&!periodTo?(scope.allPeriods||inYear(d)):(!periodFrom||d>=periodFrom)&&(!periodTo||d<=periodTo));
    const reportDate=scope.reportDate||scope.periodTo||global.document?.getElementById?.('peReportDate')?.value||today;
    const issued=scoped.filter(isIssued),billed=issued.filter(i=>period(date(i.approval_date)));
    const collectibleInvoices=issued.filter(i=>period(due(i))),retentionInvoices=['dashboard','reports'].includes(scope.profile)?issued.filter(isRetainedInvoice):billed;
    const retentionDue=i=>{if(i.retention_due_date)return date(i.retention_due_date);const p=orderFor(i);if(!p?.retention_applicable||p.retention_period_days==null||!i.approval_date)return '';const d=new Date(date(i.approval_date)+'T12:00:00Z');if(!Number.isFinite(d.getTime()))return '';d.setUTCDate(d.getUTCDate()+number(p.retention_period_days));return d.toISOString().slice(0,10);};
    const overdueRetentionInvoices=retentionInvoices.filter(i=>retentionDue(i)&&retentionDue(i)<reportDate&&metrics(i).retention>.005);
    const undatedRetentionCount=retentionInvoices.filter(i=>metrics(i).retention>.005&&!retentionDue(i)).length;
    const undatedDraft=scoped.filter(i=>workflow(i)==='draft'&&!/^\d{4}-\d{2}-\d{2}$/.test(date(i.start_date)));
    const draft=scoped.filter(i=>workflow(i)==='draft'&&/^\d{4}-\d{2}-\d{2}$/.test(date(i.start_date))&&date(i.start_date)<=today),waiting=scoped.filter(i=>workflow(i)==='waiting');
    const scopedIds=new Set(scoped.map(i=>String(i.id)));
    const collections=unique(data.collections).filter(c=>scopedIds.has(String(c.invoice_id))&&(!collectionIds||collectionIds.has(String(c.id)))&&period(date(c.collection_date)));
    const orderIdsByInvoices=new Set(scoped.map(i=>String(orderFor(i)?.id)));
    const advancesInScope=unique(data.advances||[]).filter(a=>{const po=data.orders.find(p=>String(p.id)===String(a.po_id));return po&&(!orderScopeIds||orderScopeIds.has(String(po.id)))&&dimension(po,po)&&(!scope.advancePoIds||scope.advancePoIds.map(String).includes(String(po.id)))&&(!invoiceIds||scope.advanceScopeIndependent||orderIdsByInvoices.has(String(po.id)));});
    const advances=advancesInScope.filter(a=>period(date(a.payment_date))),undatedAdvances=advancesInScope.filter(a=>!a.payment_date);
    const overdueInvoices=issued.filter(i=>due(i)&&due(i)<reportDate&&(!periodFrom||due(i)>=periodFrom)&&(!periodTo||due(i)<=periodTo)&&(!i.approval_date||date(i.approval_date)<=reportDate));
    const overdueToDate=round(overdueInvoices.reduce((v,i)=>v+metrics(i).balance,0));
    const totals={overdueToDate,billed:0,billedNet:0,billedVat:0,collections:0,advances:0,collectible:0,pending:0,retention:0,draft:0};
    for(const i of billed){const m=metrics(i);totals.billed+=m.total;totals.billedNet+=m.net;totals.billedVat+=m.vat;}
    totals.collectible=collectibleInvoices.reduce((v,i)=>v+metrics(i).balance,0);
    totals.retention=retentionInvoices.reduce((v,i)=>v+metrics(i).retention,0);
    totals.overdueRetention=overdueRetentionInvoices.reduce((v,i)=>v+metrics(i).retention,0);
    totals.pending=waiting.reduce((v,i)=>v+metrics(i).total,0);
    totals.draft=draft.reduce((v,i)=>v+metrics(i).total,0);
    totals.collections=collections.reduce((v,c)=>v+number(c.amount),0);
    totals.advances=advances.reduce((v,a)=>v+number(a.amount),0);
    for(const key of Object.keys(totals))totals[key]=round(totals[key]);
    // Compatibility aliases for operational charts and detailed registers.
    Object.assign(totals,{total:totals.billed,net:totals.billedNet,vat:totals.billedVat,collected:totals.collections,balance:totals.collectible,
      settled:round(billed.reduce((v,i)=>v+metrics(i).collected,0)),advanceApplied:round(billed.reduce((v,i)=>v+metrics(i).advance,0)),
      notDue:round(collectibleInvoices.reduce((v,i)=>v+metrics(i).notDue,0)),overdue:overdueToDate});
    const orders=unique(data.orders).filter(p=>(!orderScopeIds||orderScopeIds.has(String(p.id)))&&dimension(p,p)&&(!p.po_date||date(p.po_date)<=reportDate));
    const billedByOrder=new Map();
    for(const i of unique(data.invoices)){if(!isIssued(i)||!i.approval_date||date(i.approval_date)>reportDate)continue;const po=orderFor(i);if(!po)continue;const key=String(po.id);billedByOrder.set(key,(billedByOrder.get(key)||0)+metrics(i,po).total);}
    const poValue=round(orders.reduce((v,p)=>v+orderGross(p),0));
    const remaining=round(orders.reduce((v,p)=>v+Math.max(0,orderGross(p)-(billedByOrder.get(String(p.id))||0)),0));
    const poInvoiced=round(orders.reduce((v,p)=>v+(billedByOrder.get(String(p.id))||0),0));
    const periodOrders=orders.filter(p=>period(date(p.po_date)));
    const periodPoValue=round(periodOrders.reduce((v,p)=>v+orderGross(p),0));
    const periodPoInvoiced=totals.billed;
    const periodPoRemaining=round(periodOrders.reduce((v,p)=>v+Math.max(0,orderGross(p)-(billedByOrder.get(String(p.id))||0)),0));
    const activityIds=new Set([...billed.map(i=>String(i.project_id)),...orders.map(p=>String(p.project_id))]);
    return {periodOrders,periodPoValue,periodPoInvoiced,periodPoRemaining,overdueRetentionInvoices,undatedRetentionCount,openOrders:orders.filter(p=>orderGross(p)-(billedByOrder.get(String(p.id))||0)>.005),reportDate,overdueInvoices,totals,annual:billed,billed,collectibleInvoices,retentionInvoices,draft,undatedDraft,waiting,collections,advances,undatedAdvances,orders,orderMap,poValue,remaining,poInvoiced,activityIds,scoped,periodFrom,periodTo,asOf:today,advance:totals.advances};
  }
  function style() {
    if (document.getElementById('peAnnualStyle')) return;
    const element = document.createElement('style');
    element.id = 'peAnnualStyle';
    element.textContent = '.pe-annual-note{font-size:13px;color:#64748b;margin:0 0 12px;grid-column:1/-1}.pe-annual-chart{display:grid;gap:12px;width:100%;height:auto!important;max-height:none!important;padding:12px 0}.pe-annual-row{display:grid;grid-template-columns:minmax(120px,175px) minmax(15px,1fr) minmax(90px,auto);gap:10px;align-items:center;font:15px/1.5 Inter,Segoe UI,Arial,sans-serif}.pe-annual-track{height:16px;background:#e2e8f0;border-radius:5px;position:relative;overflow:hidden}.pe-annual-fill{position:absolute;height:100%;background:#0f766e;border-radius:5px}.pe-annual-fill.negative{background:#b45309}.pe-annual-amount{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:#14263d}.pe-annual-chart-wrap{height:auto!important;min-height:0!important}.pe-annual-chart-wrap canvas{display:none}@media(max-width:650px){.pe-annual-row{grid-template-columns:minmax(90px,110px) 1fr minmax(65px,auto);font-size:13px}}';
    element.textContent += '.pe-billing-split{font-size:10px;line-height:1.35;color:#64748b;margin-top:4px}';
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
    if(['orders','projects'].includes(scope?.profile)&&!document.getElementById('peReportDate')){const label=document.createElement('label');label.style.cssText='display:flex;gap:8px;align-items:center;font-size:12px;margin-bottom:8px';label.textContent='Report Date';const input=document.createElement('input');input.id='peReportDate';input.type='date';input.value=today;input.setAttribute('aria-label','Report date');input.onchange=()=>document.dispatchEvent(new CustomEvent('pe-kpi-filter'));label.append(input);host.parentElement.insertBefore(label,host);}
    const s = snapshot(scope);
    const period=s.periodFrom||s.periodTo?(s.periodFrom||'Beginning')+' to '+(s.periodTo||'No end date'):scope?.allPeriods?'All activity dates':String(year);
    const note='Totals include open and closed records within the selected dimensions. Pending Approval ignores the period. Draft includes invoice dates through '+s.asOf+'.';
    let cards=[
      ['Billing Incl VAT',s.totals.billed,'Approval date',s.billed.length,'Ex VAT '+currency.format(s.totals.billedNet)+' · VAT '+currency.format(s.totals.billedVat)],
      ['Collections',s.totals.collections,'Collection date · excludes advances',new Set(s.collections.map(c=>String(c.invoice_id))).size,''],
      ['Advances Received',s.totals.advances,'Payment date',s.advances.length,s.undatedAdvances.length?s.undatedAdvances.length+' undated payments excluded':''],
      ['Net Collectible',s.totals.collectible,'Due date · excludes retention and allocated advances',s.collectibleInvoices.filter(i=>metrics(i).balance>.005).length,''],
      ['Pending Approval',s.totals.pending,'Current waiting invoices · all dates',s.waiting.length,''],
      ['Retention',s.totals.retention,['dashboard','reports'].includes(scope?.profile)?'All issued and approved invoices · no date restriction':'Approval date · unreleased balance',s.retentionInvoices.filter(i=>metrics(i).retention>.005).length,['dashboard','reports'].includes(scope?.profile)?'Overdue Retention '+currency.format(s.totals.overdueRetention)+(s.undatedRetentionCount?' · '+s.undatedRetentionCount+' missing retention due dates':''):''],
      ['Draft',s.totals.draft,'Invoice date through '+s.asOf+' · ignores period',s.draft.length,s.undatedDraft.length?s.undatedDraft.length+' undated draft invoices excluded':'']
    ];
    if(scope?.profile==='invoices')cards.push(['Overdue to Report Date',s.totals.overdueToDate,'Current unpaid balance · due before '+s.reportDate,s.overdueInvoices.filter(i=>metrics(i).balance>.005).length,'Includes previous years; excludes retention']);
    if(['orders','projects'].includes(scope?.profile))cards=[
      ['PO Value Incl VAT',s.poValue,'Through '+s.reportDate,s.orders.length,''],
      ['Invoiced Incl VAT',s.poInvoiced,'Approval date through '+s.reportDate,unique(data.invoices).filter(i=>isIssued(i)&&i.approval_date&&date(i.approval_date)<=s.reportDate&&s.orders.some(p=>String(p.id)===String(orderFor(i)?.id))).length,''],
      ['Open PO Balance Incl VAT',s.remaining,'Uninvoiced balance through '+s.reportDate,s.openOrders.length,'']
    ];
    host.innerHTML='<p class="pe-annual-note">'+esc(note)+'</p>'+cards.map(([label,value,basis,count,detail])=>
      '<article class="kpi"><div class="label">'+label+'</div><div class="value">'+esc(currency.format(value))+'</div>'+
      (detail?'<div class="pe-billing-split">'+esc(detail)+'</div>':'')+
      '<div class="sub">'+esc(label==='Pending Approval'||label==='Draft'||(label==='Retention'&&['dashboard','reports'].includes(scope?.profile))?basis:period+' · '+basis)+'<br><span class="pe-invoice-count">'+count+(label==='Advances Received'?' payments':' invoices')+'</span></div></article>').join('');
    host.style.setProperty('--kpi-columns', String(Math.ceil(cards.length / 2)));
    if (chartId) chart(chartId, cards.map(([label, value]) => [label, value]));
    global.PEKPIFilter?.bind(host,s,scope);
    return s;
  }
  global.PEAnnual = {load, render, chart, snapshot, get year(){return year;}, inYear, due, metrics,workflow,isIssued,isRetainedInvoice,orderGross,orderFor,round,records: () => data};
})(window);

(function(global){
'use strict';
let active=null;const str=v=>String(v??''),num=v=>Number(v||0),positive=v=>Math.abs(num(v))>.005;
function selection(s,label,profile){
 const A=PEAnnual,records=A.records(),str=v=>String(v??'');
 let invoices=[],collections=[],advances=[];
 if(label==='Overdue to Report Date')invoices=s.overdueInvoices.filter(i=>A.metrics(i).balance>.005);
 else if(['PO Value Incl VAT','Invoiced Incl VAT','Open PO Balance Incl VAT'].includes(label)){
  const bill=p=>records.invoices.filter(i=>A.isIssued(i)&&i.approval_date&&String(i.approval_date).slice(0,10)<=s.reportDate&&str(A.orderFor(i)?.id)===str(p.id));
  const chosen=s.orders.filter(p=>label==='PO Value Incl VAT'?A.orderGross(p)!==0:label==='Invoiced Incl VAT'?bill(p).length>0:A.orderGross(p)-bill(p).reduce((n,i)=>n+A.metrics(i).total,0)>.005);
  invoices=records.invoices.filter(i=>chosen.some(p=>str(p.id)===str(A.orderFor(i)?.id))&&A.isIssued(i)&&i.approval_date&&String(i.approval_date).slice(0,10)<=s.reportDate);
  s={...s,_chosen:chosen};
 }
 else if(label==='Billing Incl VAT')invoices=s.billed;
 else if(label==='Collections'){collections=s.collections;const ids=new Set(collections.map(c=>str(c.invoice_id)));invoices=s.scoped.filter(i=>ids.has(str(i.id)));}
 else if(label==='Advances Received'){advances=s.advances;const ids=new Set(advances.map(a=>str(a.po_id)));invoices=s.scoped.filter(i=>ids.has(str(A.orderFor(i)?.id)));}
 else if(label==='Net Collectible')invoices=s.collectibleInvoices.filter(i=>A.metrics(i).balance>.005);
 else if(label==='Pending Approval')invoices=s.waiting;
 else if(label==='Retention')invoices=s.retentionInvoices.filter(i=>A.metrics(i).retention>.005);
 else if(label==='Draft')invoices=s.draft;
 const invoiceIds=new Set(invoices.map(i=>str(i.id))),orderIds=new Set([...advances.map(a=>str(a.po_id)),...(s._chosen||[]).map(p=>str(p.id))]),projectIds=new Set();
 for(const i of invoices){const p=A.orderFor(i);if(p)orderIds.add(str(p.id));if(i.project_id!=null)projectIds.add(str(i.project_id));}
 const companies=new Set(),departments=new Set();
 for(const p of records.orders)if(orderIds.has(str(p.id))){projectIds.add(str(p.project_id));companies.add(str(p.company));departments.add(str(p.department));}
 for(const i of invoices)if(!A.orderFor(i)){const p=records.projects.find(p=>str(p.id)===str(i.project_id));companies.add(str(p?.company??i.company));departments.add(str(p?.department??i.department));}
 return {invoiceIds,orderIds,projectIds,companies,departments,collectionIds:new Set(collections.map(c=>str(c.id))),advanceIds:new Set(advances.map(a=>str(a.id)))};
}
function matches(row,type,pick){return type==='invoice'?pick.invoiceIds.has(str(row.id)):type==='order'?pick.orderIds.has(str(row.id)):type==='project'?pick.projectIds.has(str(row.id)):type==='collection'?pick.collectionIds.has(str(row.id)):type==='customer'?pick.companies.has(str(row.name)):type==='department'?pick.departments.has(str(row.name)):false;}
function filter(rows,type,scope){if(!active||active.custom)return rows;const pick=selection(PEAnnual.snapshot(scope),active.label,active.profile);return rows.filter(row=>matches(row,type,pick));}
function changed(){document.dispatchEvent(new CustomEvent('pe-kpi-filter'));}
function clear(notify=true){active=null;if(notify)changed();}
function decorate(node,label,activate){node.setAttribute('role','button');node.tabIndex=0;node.style.cursor='pointer';node.setAttribute('aria-pressed',String(active?.label===label));node.classList.toggle('pe-kpi-selected',active?.label===label);node.title=(active?.label===label?'Clear total filter: ':'Filter records: ')+label;node.onclick=activate;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};}
function toolbar(host){
 let bar=document.getElementById('peKpiFilterBar');if(!bar){bar=document.createElement('div');bar.id='peKpiFilterBar';bar.style.cssText='display:flex;align-items:center;gap:12px;margin:6px 0;font-size:12px';host.parentElement.insertBefore(bar,host);}
 bar.replaceChildren();bar.hidden=!active;bar.style.display=active?'flex':'none';if(active){const text=document.createElement('span');text.textContent='Filter: '+active.label;const b=document.createElement('button');b.type='button';b.textContent='×';b.title='Clear total filter';b.setAttribute('aria-label','Clear total filter');b.onclick=clear;bar.append(text,b);}
 if(!document.getElementById('peKpiFilterStyle')){const style=document.createElement('style');style.id='peKpiFilterStyle';style.textContent='.pe-kpi-selected{outline:2px solid #2563eb;outline-offset:-2px;background:#eff6ff!important}.kpi[role=button]:focus-visible{outline:3px solid #60a5fa}';document.head.append(style);}
}
function bind(host,s,scope={}){
 if(!host)return;toolbar(host);
 host.querySelectorAll('.kpi').forEach(node=>{const label=node.querySelector('.label')?.textContent.trim();if(!label)return;decorate(node,label,()=>{active=active?.label===label?null:{label,profile:scope.profile};changed();if(active&&label==='Advances Received')global.PEAdvancePayments?.open({paymentIds:s.advances.map(a=>a.id)});});});
}
function bindDonuts(host,s){
 toolbar(host);host.querySelectorAll('.pe-donut-legend>div,.pe-donut-legend>button').forEach(node=>{const label=node.querySelector('.pe-donut-key')?.textContent.trim();if(!label)return;decorate(node,label,()=>{active=active?.label===label?null:{label,profile:label==='Pending Approval'?'dashboard-waiting':undefined};changed();});});
}
function filterOrders(rows,metrics){if(!active?.custom)return rows;return rows.filter(p=>positive(/^PO Value/.test(active.label)?p.po_value_ex_vat:metrics(p)[/Balance|Remaining/.test(active.label)?'remaining':'invoiced']));}
function bindOrders(host){toolbar(host);host.querySelectorAll('.kpi').forEach(node=>{const label=node.querySelector('.label').textContent.trim();decorate(node,label,()=>{active=active?.label===label?null:{label,custom:true};changed();});});}
global.PEKPIFilter={selection,filter,filterOrders,bind,bindOrders,bindDonuts,clear,set:(label,profile='reports',notify=true)=>{active=label?{label,profile}:null;if(notify)changed();},active:()=>active,matches};
document.addEventListener('click',event=>{if(event.target.closest?.('#clear,#clearFilters,#customerClear,[onclick="clearFilters()"],[onclick="resetFilters()"]'))active=null;},true);
})(window);



