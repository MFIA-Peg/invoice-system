(function(global){
  'use strict';
  const el=id=>document.getElementById(id),str=v=>String(v??''),norm=v=>str(v).trim().toLowerCase();
  const esc=v=>str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount=v=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(Number(v||0));
  const date=v=>str(v).slice(0,10);
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let shown=[],activeAttention='';
  function buildRows(records,asOf=today()){
    const orders=new Map(records.orders.map(p=>[str(p.po_no),p])),ordersById=new Map(records.orders.map(p=>[str(p.id),p])),projects=new Map(records.projects.map(p=>[str(p.id),p]));
    return records.invoices.map(i=>{
      const po=ordersById.get(str(i.pos_id))||orders.get(str(i.po_no)),p=projects.get(str(i.project_id??po?.project_id));
      const m=PEAnnual.metrics(i,po),due=PEAnnual.due(i),status=norm(i.status),cancelled=/^(cancelled|canceled|void)$/.test(status);
      const draft=status==='draft',waiting=!cancelled&&!draft&&!i.approval_date&&(/^(submitted|pending|pending approval|awaiting approval|waiting approval|waiting for approval)$/.test(status));
      const overdue=!cancelled&&!!due&&due<asOf&&m.balance>0.005;
      let payment='Unpaid';
      if(cancelled)payment='Cancelled';
      else if(m.total>0&&m.balance<=0.005)payment=m.retention>0.005?'Retention Only':'Paid';
      else if(Number(i.paid_amount||0)>0)payment='Partially Paid';
      return {i,po,p,m,due,payment,overdue,cancelled,draftDue:!cancelled&&draft&&!!i.start_date&&date(i.start_date)<=asOf,waiting,
        customer:i.company||po?.company||p?.company||'Unassigned',department:i.department||po?.department||p?.department||'Unassigned',project:i.project_name||p?.project_name||po?.project_name||'Unassigned'};
    });
  }
  function matches(row,f,{period=true,attention=true}={}){
    if(f.company&&row.customer!==f.company||f.department&&row.department!==f.department||f.project&&row.project!==f.project)return false;
    if(f.invoiceStatus&&norm(row.i.status)!==norm(f.invoiceStatus))return false;
    if(f.paymentStatus==='Overdue'?!row.overdue:f.paymentStatus&&row.payment!==f.paymentStatus)return false;
    if(attention&&f.attention&&!row[f.attention])return false;
    if(!period)return true;
    const d=row.due||date(row.i.start_date);
    if(f.from||f.to)return !!d&&(!f.from||d>=f.from)&&(!f.to||d<=f.to);
    return f.attention?true:PEAnnual.inYear(d);
  }
  function filters(){return {company:el('company').value,department:el('department').value,project:el('project').value,invoiceStatus:el('invoiceStatus').value,paymentStatus:el('paymentStatus').value,from:el('fromDate').value,to:el('toDate').value,attention:activeAttention};}
  function statusOptions(rows){
    const select=el('invoiceStatus'),old=select.value;
    select.innerHTML='<option value="">All invoice statuses</option>'+[...new Set(rows.map(r=>str(r.i.status).trim()).filter(Boolean))].sort().map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');select.value=old;
  }
  function renderAlerts(rows,f){
    const base=rows.filter(r=>matches(r,f,{attention:false}));
    // Without a period, operational alerts include older unresolved invoices.
    const operational=(f.from||f.to)?base:rows.filter(r=>matches(r,f,{period:false,attention:false}));
    const specs=[['draftDue','Drafts due for issue','Invoice date is today or earlier; status remains Draft.'],['waiting','Awaiting approval','Submitted / pending approval without an approval date.'],['overdue','Overdue collection','Unpaid due balance past its due date.']];
    el('invoiceAlerts').innerHTML=specs.map(([key,title,note])=>{
      const group=operational.filter(r=>r[key]),total=group.reduce((n,r)=>n+(key==='overdue'?r.m.balance:r.m.total),0);
      return '<button type="button" class="invoice-alert '+(activeAttention===key?'selected':'')+'" data-attention="'+key+'" aria-pressed="'+(activeAttention===key)+'"><strong>'+esc(title)+'</strong><span>'+group.length+' invoices · '+esc(amount(total))+'</span><small>'+esc(note)+'</small></button>';
    }).join('');
    el('invoiceAlerts').querySelectorAll('[data-attention]').forEach(b=>b.addEventListener('click',()=>{activeAttention=activeAttention===b.dataset.attention?'':b.dataset.attention;renderKPIs();el('dashboardInvoices').scrollIntoView({behavior:'smooth',block:'start'});}));
  }
  const columns=['Invoice Number','Customer','Department','Project','Purchase Order','Invoice Date','Due Date','Invoice Status','Payment Status','Total Incl VAT','Paid','Open Collection Balance','Retention Balance'];
  function values(r){return [r.i.invoice_no||'—',r.customer,r.department,r.project,r.i.po_no||r.po?.po_no||'—',date(r.i.start_date)||'—',r.due||'—',r.i.status||'—',r.payment,r.m.total,Number(r.i.paid_amount||0),r.m.balance,r.m.retention];}
  function renderTable(rows,f){
    shown=rows.filter(r=>matches(r,f)).sort((a,b)=>(a.due||date(a.i.start_date)).localeCompare(b.due||date(b.i.start_date))||str(a.i.invoice_no).localeCompare(str(b.i.invoice_no)));
    const total=shown.reduce((n,r)=>n+r.m.total,0),overdue=shown.filter(r=>r.overdue).reduce((n,r)=>n+r.m.balance,0);
    el('dashboardInvoiceSummary').textContent=shown.length+' invoices · Total '+amount(total)+' · Overdue '+amount(overdue)+(f.from||f.to?' · Selected due-date period (invoice date when no due date)':activeAttention?' · All years requiring attention':' · '+PEAnnual.year+' due dates / invoice dates for pending invoices');
    el('dashboardInvoiceTable').innerHTML=shown.length?'<table><thead><tr>'+columns.map(c=>'<th>'+c+'</th>').join('')+'<th>Collection Alert</th></tr></thead><tbody>'+shown.map(r=>'<tr>'+values(r).map((v,k)=>'<td'+(k>=9?' class="num"':'')+'>'+esc(k>=9?amount(v):v)+'</td>').join('')+'<td>'+(r.overdue?'<span class="dashboard-overdue">Overdue</span>':'—')+'</td></tr>').join('')+'</tbody></table>':'<p class="muted">No invoices match these filters.</p>';
  }
  global.renderKPIs=function(){
    const rows=buildRows(PEAnnual.records());statusOptions(rows);const f=filters();
    if(f.from&&f.to&&f.from>f.to){el('dashboardFilterError').textContent='The start date must be on or before the end date.';return;}
    el('dashboardFilterError').textContent='';
    const dimensionRows=rows.filter(r=>matches(r,f,{period:false}));
    const scope={invoiceIds:dimensionRows.map(r=>r.i.id),dueFrom:f.from,dueTo:f.to,
      companies:f.company?[f.company]:undefined,departments:f.department?[f.department]:undefined,
      projectIds:f.project?data.projects.filter(p=>p.project_name===f.project).map(p=>p.id):undefined};
    const s=PEAnnual.render('kpis',null,scope);
    PEAnnual.chart('collectionChart',[['Collected',s.totals.collected],['Open Balance',s.totals.balance]]);
    PEAnnual.chart('overdueChart',[['Overdue',s.totals.overdue],['Not Yet Due',Math.max(0,s.totals.balance-s.totals.overdue)]]);
    PEAnnual.chart('poChart',[['PO Value',s.poValue],['Invoiced',s.totals.net]]);
    PEWorkspace.monthly(scope);renderAlerts(rows,f);renderTable(rows,f);
    el('status').textContent=PEAnnual.year+' · Current-year KPIs · Invoice due dates / collection payment dates';
    el('clearAttention').hidden=!activeAttention;
  };
  global.exportToExcel=function(){
    const safe=v=>'"'+str(v).replace(/^[\s]*[=+@-]/,s=>"'"+s).replace(/"/g,'""')+'"';
    const csv='\uFEFF'+[columns,...shown.map(values)].map(r=>r.map(safe).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download='dashboard-invoices-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const nativeClear=global.clearFilters;
  global.clearFilters=function(){activeAttention='';el('invoiceStatus').value='';el('paymentStatus').value='';nativeClear();};
  el('clearAttention').addEventListener('click',()=>{activeAttention='';renderKPIs();});
  ['invoiceStatus','paymentStatus'].forEach(id=>el(id).addEventListener('change',()=>{activeAttention='';renderKPIs();}));
  global.PEDashboard={buildRows,matches,values};
})(window);

