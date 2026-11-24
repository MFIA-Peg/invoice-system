(function(global){
  'use strict';
  const el=id=>document.getElementById(id),str=v=>String(v??''),norm=v=>str(v).trim().toLowerCase();
  const esc=v=>str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount=v=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(Number(v||0));
  const date=v=>str(v).slice(0,10);
  const tableNumber=new Intl.NumberFormat('en',{minimumFractionDigits:2,maximumFractionDigits:2});
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let shown=[],activeAttention='',kpiScope={};
  const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d),dimensionValue=(...values)=>values.map(v=>str(v).trim()).find(Boolean)||'Unassigned';
  function orderDimensions(po,projects){const p=projects.get(str(po.project_id));return {po,p,customer:dimensionValue(po.company,p?.company),department:dimensionValue(po.department,p?.department),project:dimensionValue(p?.project_name,po.project_name)};}
  function dimensionMatch(row,f){return (!f.company||row.customer===f.company)&&(!f.department||row.department===f.department)&&(!f.project||row.project===f.project);}
  function setOptions(id,values,label){const select=el(id),old=select.value,vals=[...new Set(values.map(str).map(v=>v.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));const html='<option value="">All '+label+'</option>'+vals.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');if(select.innerHTML!==html)select.innerHTML=html;select.value=vals.includes(old)?old:'';}
  function syncDimensions(rows,changed){const records=PEAnnual.records(),projects=new Map(records.projects.map(p=>[str(p.id),p])),linked=new Set(records.orders.map(p=>str(p.project_id)));const choices=rows.concat(records.orders.map(p=>orderDimensions(p,projects)),records.projects.filter(p=>!linked.has(str(p.id))).map(p=>({customer:dimensionValue(p.company),department:dimensionValue(p.department),project:dimensionValue(p.project_name)})));
    if(changed==='company'||changed==='department'){const other=changed==='company'?'department':'company',key=changed==='company'?'customer':'department',otherKey=other==='company'?'customer':'department';if(el(other).value&&!choices.some(r=>(!el(changed).value||r[key]===el(changed).value)&&r[otherKey]===el(other).value))el(other).value='';}
    const company=el('company').value,department=el('department').value;
    setOptions('company',choices.map(r=>r.customer),'customers');setOptions('department',choices.filter(r=>!company||r.customer===company).map(r=>r.department),'departments');setOptions('project',choices.filter(r=>(!el('company').value||r.customer===el('company').value)&&(!el('department').value||r.department===el('department').value)).map(r=>r.project),'projects');
  }
  function buildRows(records,asOf=today()){
    const orders=new Map(records.orders.map(p=>[str(p.po_no),p])),ordersById=new Map(records.orders.map(p=>[str(p.id),p])),projects=new Map(records.projects.map(p=>[str(p.id),p]));
    return records.invoices.map(i=>{
      const po=ordersById.get(str(i.pos_id))||orders.get(str(i.po_no)),p=projects.get(str(po?.project_id??i.project_id));
      const m=PEAnnual.metrics(i,po),due=PEAnnual.due(i),status=norm(i.status),cancelled=/^(cancelled|canceled|void)$/.test(status);
      const workflow=PEAnnual.workflow(i),draft=workflow==='draft',waiting=workflow==='waiting',issued=workflow==='issued';
      const overdue=issued&&!!due&&due<asOf&&m.balance>0.005;
      let payment=issued?'Unpaid':'Not Issued';
      if(cancelled)payment='Cancelled';
      else if(issued&&m.balance<=0.005)payment=m.retention>0.005?'Retention Only':'Paid';
      else if(issued&&m.collected>0)payment='Partially Paid';
      return {i,po,p,m,due,payment,overdue,cancelled,draft,draftDue:!cancelled&&draft&&!!i.start_date&&date(i.start_date)<=asOf,waiting,
        customer:dimensionValue(po?.company,p?.company,i.company),department:dimensionValue(po?.department,p?.department,i.department),project:dimensionValue(p?.project_name,po?.project_name,i.project_name)};
    });
  }
  function matches(row,f,{period=true,attention=true}={}){
    if(!dimensionMatch(row,f))return false;
    if((f.dueFrom||f.dueTo)&&(!validDate(row.due)||(f.dueFrom&&row.due<f.dueFrom)||(f.dueTo&&row.due>f.dueTo)))return false;
    if(f.invoiceStatus&&norm(row.i.status)!==norm(f.invoiceStatus))return false;
    if(f.paymentStatus==='Overdue'?!row.overdue:f.paymentStatus&&row.payment!==f.paymentStatus)return false;
    if(attention&&f.attention&&!row[f.attention])return false;
    if(!period||f.attention)return true;
    // The general period list follows approval for issued invoices. Operational
    // queues remain current as-of lists; selected cards supply exact membership.
    if(row.draft)return row.draftDue;
    if(row.waiting||row.cancelled)return true;
    const d=date(row.i.approval_date);
    if(f.from||f.to)return !!d&&(!f.from||d>=f.from)&&(!f.to||d<=f.to);
    return f.dueFrom||f.dueTo?true:PEAnnual.inYear(d);
  }
  function filters(){return {company:el('company').value,department:el('department').value,project:el('project').value,invoiceStatus:el('invoiceStatus').value,paymentStatus:el('paymentStatus').value,from:el('fromDate').value,to:el('toDate').value,dueFrom:el('dueFromDate').value,dueTo:el('dueToDate').value,attention:activeAttention};}
  function statusOptions(rows){
    const select=el('invoiceStatus'),old=select.value;
    const html='<option value="">All invoice statuses</option>'+[...new Set(rows.map(r=>str(r.i.status).trim()).filter(Boolean))].sort().map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');if(select.innerHTML!==html)select.innerHTML=html;select.value=old;
  }
  function renderAlerts(rows,f){
    // Operational alerts are as-of queues. A financial period never hides an
    // older unresolved draft, approval request or overdue receivable.
    const operational=rows.filter(r=>matches(r,f,{period:false,attention:false}));
    const specs=[['draftDue','Drafts due for issue','Invoice date is today or earlier; status remains Draft.'],['waiting','Awaiting approval','Invoice workflow remains Waiting For approval.'],['overdue','Overdue collection','Issued invoice cash balance past its due date; excludes retention.']];
    el('invoiceAlerts').innerHTML=specs.map(([key,title,note])=>{
      const group=operational.filter(r=>r[key]),total=group.reduce((n,r)=>n+(key==='overdue'?r.m.balance:r.m.total),0);
      return '<button type="button" class="invoice-alert '+(activeAttention===key?'selected':'')+'" data-attention="'+key+'" aria-pressed="'+(activeAttention===key)+'"><strong>'+esc(title)+'</strong><span>'+group.length+' invoices · '+esc(amount(total))+'</span><small>'+esc(note)+'</small></button>';
    }).join('');
    el('invoiceAlerts').querySelectorAll('[data-attention]').forEach(b=>b.addEventListener('click',()=>{PEKPIFilter.clear(false);activeAttention=activeAttention===b.dataset.attention?'':b.dataset.attention;renderKPIs();el('dashboardInvoices').scrollIntoView({behavior:'smooth',block:'start'});}));
  }
  const columns=['Invoice Number','Customer','Department','Project','Purchase Order','Invoice Date','Due Date','Invoice Status','Payment Status','Invoice Total Incl VAT','Settled Against Invoices','Advance Applied Incl VAT','Not Yet Due Incl VAT','Overdue Incl VAT','Retention Balance Incl VAT'];
  function values(r){return [r.i.invoice_no||'—',r.customer,r.department,r.project,r.i.po_no||r.po?.po_no||'—',date(r.i.start_date)||'—',r.due||'—',r.i.status||'—',r.payment,r.m.total,PEKPIFilter.active()?.label==='Collections'?(r.periodCollected||0):r.m.collected,r.m.advance,r.m.notDue,r.m.overdue,r.m.retention];}
  function reportColumns(){return columns.map((c,k)=>k===10&&PEKPIFilter.active()?.label==='Collections'?'Collections in Period':c).concat('Collection Alert');}
  function reportValues(row){return values(row).concat(row.overdue?'Overdue':'—');}
  function renderTable(rows,f,s){
    el('dashboardInvoices').hidden=!PEKPIFilter.active()&&!Object.values(f).some(Boolean);
    const base=rows.filter(r=>matches(r,f,{period:!PEKPIFilter.active()})),ids=new Set(PEKPIFilter.filter(base.map(r=>r.i),'invoice',kpiScope).map(i=>str(i.id)));
    shown=base.filter(r=>ids.has(str(r.i.id))).sort((a,b)=>(a.due||date(a.i.start_date)).localeCompare(b.due||date(b.i.start_date))||str(a.i.invoice_no).localeCompare(str(b.i.invoice_no)));
    const receipts=new Map();for(const c of s.collections)receipts.set(str(c.invoice_id),(receipts.get(str(c.invoice_id))||0)+Number(c.amount||0));for(const r of shown)r.periodCollected=receipts.get(str(r.i.id))||0;
    const total=shown.filter(r=>!r.cancelled&&!r.draft&&!r.waiting).reduce((n,r)=>n+r.m.total,0),overdue=shown.filter(r=>r.overdue).reduce((n,r)=>n+r.m.balance,0),selected=PEKPIFilter.active()?.label,keys={'Billing Incl VAT':'billed','Collections':'collections','Advances Received':'advances','Net Collectible':'collectible','Pending Approval':'pending','Retention':'retention','Draft':'draft'};
    const summary=selected&&keys[selected]?selected+' '+amount(s.totals[keys[selected]]):activeAttention?'Alert value '+amount(shown.reduce((n,r)=>n+(activeAttention==='overdue'?r.m.balance:r.m.total),0)):'Issued Total Incl VAT '+amount(total);
    el('dashboardInvoiceSummary').textContent=shown.length+' invoices · '+summary+' · Overdue '+amount(overdue)+(activeAttention?' · Current unresolved queue, all years':f.dueFrom||f.dueTo?' · Due-date criteria with all selected conditions':' · Approval-date period; draft and approval queues are current as of today');
    el('dashboardInvoiceTable').innerHTML=shown.length?'<table><colgroup>'+reportColumns().map((c,i)=>'<col style="width:'+([5,8,5,9,7,5.5,5.5,6,6,6.5,6.5,6.5,6.5,6.5,6.5,4][i]||5)+'%">').join('')+'</colgroup><thead><tr>'+reportColumns().map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+shown.map(r=>'<tr>'+reportValues(r).map((v,k)=>'<td'+(k>=9&&k<=14?' class="num"':'')+'>'+esc(k>=9&&k<=14?tableNumber.format(Number(v||0)):v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p class="muted">No invoices match these filters.</p>';
  }
  function rangeError(f){
    const pairs=[['fromDate','toDate',f.from,f.to,'Period'],['dueFromDate','dueToDate',f.dueFrom,f.dueTo,'Due Date']];let message='';
    for(const [fromId,toId,from,to,label]of pairs){const invalid=!!(from&&to&&from>to),note=invalid?label+' From must be on or before '+label+' To.':'';for(const id of [fromId,toId]){el(id).setCustomValidity(note);el(id).setAttribute('aria-invalid',String(invalid));}if(note)message+=(message?' ':'')+note;}return message;
  }
  global.renderKPIs=function(changed=''){
    const records=PEAnnual.records(),rows=buildRows(records);syncDimensions(rows,changed);statusOptions(rows);const f=filters(),error=rangeError(f);
    el('dashboardFilterError').textContent=error;el('dashboardExport').disabled=!!error;
    if(error){shown=[];for(const id of ['kpis','invoiceAlerts','monthlyComparison','collectionChart','overdueChart','poChart','dashboardInvoiceTable'])el(id).replaceChildren();el('kpis').textContent='Correct the date ranges to display financial results.';el('dashboardInvoices').hidden=true;if(el('dashboardGroupedTotals'))el('dashboardGroupedTotals').hidden=true;el('status').textContent='No results are displayed for an invalid date range.';return;}
    const dimensionRows=rows.filter(r=>matches(r,f,{period:false})),projects=new Map(records.projects.map(p=>[str(p.id),p]));
    const invoiceCriteria=!!(f.invoiceStatus||f.paymentStatus||f.attention||f.dueFrom||f.dueTo),relatedOrders=new Set(dimensionRows.filter(r=>!r.cancelled&&r.po).map(r=>str(r.po.id)));
    const orders=records.orders.filter(po=>dimensionMatch(orderDimensions(po,projects),f)&&(!invoiceCriteria||relatedOrders.has(str(po.id))));
    const scope={singleInvoiceReport:true,profile:'dashboard',invoiceIds:dimensionRows.map(r=>r.i.id),periodFrom:f.from,periodTo:f.to,
      allPeriods:!!((f.dueFrom||f.dueTo)&&!f.from&&!f.to),orderScopeIds:orders.map(p=>p.id),advancePoIds:orders.map(p=>p.id),advanceScopeIndependent:true};
    kpiScope=scope;
    const s=PEAnnual.render('kpis',null,scope);
    global.PEDashboardGroups?.render(s,f);if(el('dashboardGroupedTotals'))el('dashboardGroupedTotals').hidden=false;
    PEAnnual.chart('collectionChart',[['Collections',s.totals.collections],['Advances Received',s.totals.advances]]);
    PEAnnual.chart('overdueChart',[['Net Collectible',s.totals.collectible],['Retention',s.totals.retention]]);
    PEAnnual.chart('poChart',[['PO Value Incl VAT · PO date',s.periodPoValue],['Invoiced Incl VAT · approval date',s.periodPoInvoiced],['Open PO Balance Incl VAT · POs in period',s.periodPoRemaining]]);
    PEWorkspace.monthly(scope);renderAlerts(rows,f);renderTable(rows,f,s);
    const undated=(s.undatedAdvances||[]).length,period=f.from||f.to?(f.from||'Beginning')+' — '+(f.to||'No end date'):scope.allPeriods?'All activity dates for due-date matches':str(PEAnnual.year);
    el('status').textContent=period+' · Billing: approval date · Collections and advances: payment date · Net collectible: due date · Retention: all issued and approved invoices · Pending approval and draft: current as of '+today()+(f.dueFrom||f.dueTo?' · Invoice Due Date: '+(f.dueFrom||'Beginning')+' — '+(f.dueTo||'No end date'):'')+(undated?' · '+undated+' advance payment(s) need a payment date':'');
    el('clearAttention').hidden=!activeAttention;global.PESearchableSelects?.refresh();
  };
  global.exportToExcel=function(){
    if(el('dashboardFilterError').textContent)return;
    const safe=v=>'"'+str(v).replace(/^[\s]*[=+@-]/,s=>"'"+s).replace(/"/g,'""')+'"';
    const csv='\uFEFF'+[reportColumns(),...shown.map(reportValues)].map(r=>r.map(safe).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download='dashboard-invoices-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  global.clearFilters=function(){activeAttention='';PEKPIFilter.clear(false);for(const id of ['company','department','project','invoiceStatus','paymentStatus','fromDate','toDate','dueFromDate','dueToDate'])el(id).value='';renderKPIs();};
  el('clearAttention').addEventListener('click',()=>{activeAttention='';renderKPIs();});
  let filterFrame=0,lastChanged='';
  function scheduleFilterRender(event){lastChanged=event.target.id;if(filterFrame)return;filterFrame=requestAnimationFrame(()=>{filterFrame=0;renderKPIs(lastChanged);lastChanged='';});}
  ['company','department','project','invoiceStatus','paymentStatus','fromDate','toDate','dueFromDate','dueToDate'].forEach(id=>{
    el(id).addEventListener('input',scheduleFilterRender);el(id).addEventListener('change',scheduleFilterRender);
  });
  function selectWorkflow(kind,currentYear=false){
    if(currentYear&&!el('fromDate').value&&!el('toDate').value){el('fromDate').value=PEAnnual.year+'-01-01';el('toDate').value=PEAnnual.year+'-12-31';}
    PEKPIFilter.clear(false);activeAttention=kind==='draft'?'draftDue':'waiting';
    el('invoiceStatus').value='';el('paymentStatus').value='';renderKPIs();
    el('dashboardInvoices').scrollIntoView({behavior:'smooth',block:'start'});
  }
  document.addEventListener('pe-kpi-filter',()=>{activeAttention='';renderKPIs();el('dashboardInvoices').scrollIntoView({behavior:'smooth',block:'start'});});
  global.PEDashboard={buildRows,matches,values,selectWorkflow,filters,scope:()=>kpiScope};
})(window);








