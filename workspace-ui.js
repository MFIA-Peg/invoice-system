(function(global){
  'use strict';
  const closedView=new URLSearchParams(location.search).get('view')==='closed';
  const page=location.pathname.split('/').pop()||'dashboard.html';
  const text=value=>String(value??'');
  const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>Number(value||0);
  const money=value=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(num(value));
  const explicit=row=>row?.archive===true||/^(closed|completed|cancelled|canceled|void)$/i.test(text(row?.status).trim());
  let billingSource,billingIndex;
  function billing(){
    const rows=PEAnnual.records().invoices;
    if(rows!==billingSource){billingSource=rows;billingIndex=new Map();for(const i of rows){if(/draft|cancelled|canceled|void/i.test(text(i.status)))continue;const key=text(i.po_no);let m=billingIndex.get(key);if(!m){m={invoiced:0,gross:0,amort:0,count:0};billingIndex.set(key,m);}m.invoiced+=num(i.invoice_amount);m.gross+=num(i.invoice_total_after_advance??i.invoice_total);m.amort+=num(i.advance_amortisation);m.count++;}}
    return billingIndex;
  }
  function orderState(row,asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
    const m=billing().get(text(row.po_no))||{invoiced:0,gross:0,amort:0,count:0},value=num(row.po_value_ex_vat),invoiced=Math.round(m.invoiced*100)/100,remaining=Math.round((value-invoiced)*100)/100;
    const completed=value>0&&invoiced>=value-.005,start=text(row.po_date).slice(0,10),end=text(row.expiry_date).slice(0,10),raw=text(row.status).trim();
    let status='Open';
    if(/cancelled|canceled|void/i.test(raw))status='Cancelled';
    else if(completed||/^completed$/i.test(raw))status='Completed';
    else if(row.archive===true||/^closed$/i.test(raw))status='Closed';
    else if(start&&end&&start>end)status='Invalid Dates';
    else if(start&&start>asOf)status='Not Yet Active';
    else if(end&&end<asOf)status='Expired';
    return {...m,invoiced,remaining,completed,status,closed:explicit(row)||completed};
  }
  function invoiceClosed(row){
    if(/^(cancelled|canceled|void)$/i.test(text(row?.status).trim()))return true;
    const records=PEAnnual.records();
    const po=records.orders.find(p=>String(p.id)===String(row.pos_id))||records.orders.find(p=>text(p.po_no)===text(row.po_no));
    const m=PEAnnual.metrics(row,po);
    return m.total>0&&num(row.paid_amount)+num(row.retention_released_amount)+0.005>=m.total&&m.retention<=0.005;
  }
  function customerClosed(name){
    const d=PEAnnual.records(),ps=d.projects.filter(p=>text(p.company)===text(name)),os=d.orders.filter(p=>text(p.company)===text(name));
    const ids=new Set(ps.map(p=>text(p.id))),nos=new Set(os.map(p=>text(p.po_no)));
    const iv=d.invoices.filter(i=>ids.has(text(i.project_id))||nos.has(text(i.po_no)));
    return (ps.length+os.length+iv.length)>0&&ps.every(explicit)&&os.every(po=>orderState(po).closed)&&iv.every(invoiceClosed);
  }
  function matches(type,row){
    let closed=false;
    if(type==='invoice')closed=invoiceClosed(row);
    else if(type==='project')closed=explicit(row);
    else if(type==='order')closed=orderState(row).closed;
    else if(type==='customer'){
      if(closedView){
        const d=PEAnnual.records(),ps=d.projects.filter(p=>p.company===row.name),os=d.orders.filter(p=>p.company===row.name);
        const ids=new Set(ps.map(p=>text(p.id))),nos=new Set(os.map(p=>text(p.po_no)));
        return ps.some(explicit)||os.some(po=>orderState(po).closed)||d.invoices.some(i=>(ids.has(text(i.project_id))||nos.has(text(i.po_no)))&&invoiceClosed(i));
      }
      closed=customerClosed(row.name);
    }
    else if(type==='collection'){
      const invoice=PEAnnual.records().invoices.find(i=>text(i.id)===text(row.invoice_id));
      closed=invoice?invoiceClosed(invoice):false;
    }
    return closedView===closed;
  }
  function mount(){
    const links=document.querySelector('#pe-global-nav .pe-nav-links');
    if(links&&!links.querySelector('[data-closed-records]')){
      const link=document.createElement('a');link.href='closed-records.html';link.textContent='Closed Records';link.dataset.closedRecords='true';links.append(link);
    }
    if(page==='dashboard.html'||page==='closed-records.html')return;
    const main=document.querySelector('main,.container.page,.container');
    if(!main||document.getElementById('peWorkspaceStrip'))return;
    const strip=document.createElement('section');strip.id='peWorkspaceStrip';strip.className='pe-workspace-strip';
    const params=new URLSearchParams(location.search);params.delete('view');params.delete('record');params.delete('id');params.delete('invoice_no');
    const open=page+(params.size?'?'+params:'');
    params.set('view','closed');
    strip.innerHTML='<span>'+ (closedView?'Closed records · historical details and actions':'Open records · current work') +'</span><nav><a href="'+esc(open)+'"'+(!closedView?' aria-current="page"':'')+'>Open</a><a href="'+esc(page+'?'+params)+'"'+(closedView?' aria-current="page"':'')+'>Closed</a></nav>';
    main.prepend(strip);
    if(closedView){const h=main.querySelector('h1');if(h)h.textContent='Closed '+h.textContent;document.title='Closed · '+document.title;}
  }
  function monthly(scope){
    const host=document.getElementById('monthlyComparison');if(!host)return;
    const s=PEAnnual.snapshot(scope),y=PEAnnual.year,series=Array.from({length:4},()=>Array(13).fill(0));
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const from=scope?.dueFrom||'',to=scope?.dueTo||'',filtered=!!(from||to),overdueRows=[];
    const inPeriod=date=>!!date&&(!from||date>=from)&&(!to||date<=to);
    const records=PEAnnual.records(),projects=new Map(records.projects.map(p=>[text(p.id),p]));
    function add(values,date,value){if(PEAnnual.inYear(date)&&inPeriod(String(date).slice(0,10))){const m=Number(String(date).slice(5,7));if(m>=1&&m<=12)values[m]+=value;}}
    for(const invoice of s.scoped){
      const m=PEAnnual.metrics(invoice,s.orderMap.get(text(invoice.po_no))),due=PEAnnual.due(invoice);
      add(series[0],invoice.start_date,m.total);add(series[1],due,m.total);
      if(due&&due<today&&m.balance>0.005&&inPeriod(due)&&!/^(cancelled|canceled|void)$/i.test(text(invoice.status).trim())){
        if(Number(due.slice(0,4))<y)series[3][0]+=m.balance;
        else add(series[3],due,m.balance);
        const order=s.orderMap.get(text(invoice.po_no)),project=projects.get(text(invoice.project_id??order?.project_id));
        overdueRows.push({customer:order?.company||project?.company||invoice.company||'—',department:order?.department||project?.department||invoice.department||'—',po:invoice.po_no||order?.po_no||'—',invoice:invoice.invoice_no||'—',due,amount:m.balance});
      }
    }
    for(const c of s.collections)add(series[2],c.collection_date,num(c.amount));
    const labels=['Previous years','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],colors=['#2563eb','#d97706','#0f766e','#dc2626'];
    const max=Math.max(1,...series.flat()),width=1100,height=310,left=85,top=24,bottom=258,plotW=990,plotH=bottom-top,step=plotW/13;
    let svg='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Monthly invoice, expected collection, actual collection and current overdue balance comparison for '+y+'">';
    for(let i=0;i<=4;i++){const v=max*i/4,yy=bottom-plotH*i/4;svg+='<line x1="'+left+'" y1="'+yy+'" x2="1080" y2="'+yy+'" stroke="#e2e8f0"/><text x="75" y="'+(yy+4)+'" text-anchor="end" font-size="11" fill="#64748b">'+esc(new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(v))+'</text>';}
    for(let m=0;m<13;m++){for(let j=0;j<4;j++){if(m===0&&j!==3)continue;const v=series[j][m],h=v/max*plotH,x=left+m*step+4+j*17;svg+='<rect x="'+x+'" y="'+(bottom-h)+'" width="14" height="'+h+'" rx="3" fill="'+colors[j]+'"><title>'+labels[m]+' '+(m===0?'before '+y:y)+' · '+['Invoiced','Expected collection','Actual collection','Current overdue balance'][j]+': '+esc(money(v))+'</title></rect>';}svg+='<text x="'+(left+m*step+36)+'" y="281" text-anchor="middle" font-size="'+(m===0?9:12)+'" fill="#475569">'+labels[m]+'</text>';}
    svg+='</svg>';
    host.innerHTML='<div class="pe-monthly-legend"><span style="--series:#2563eb">Invoiced · invoice date</span><span style="--series:#d97706">Expected · due date</span><span style="--series:#0f766e">Actual · collection date</span><span style="--series:#dc2626">Overdue now · due month</span></div><p class="muted" style="font-size:12px">Overdue as of '+esc(today)+': previous years combined first, then current-year due months; excluding unreleased retention. This is not a historical month-end balance. '+(filtered?'Selected period: '+esc(from||'Beginning')+' to '+esc(to||'Today')+'. Each series follows its own date.':'Select a due-date period above to show the overdue invoice statement.')+'</p><div class="pe-monthly-wrap">'+svg+'</div>';
    if(filtered){
      overdueRows.sort((a,b)=>a.due.localeCompare(b.due)||text(a.invoice).localeCompare(text(b.invoice)));
      const total=overdueRows.reduce((n,r)=>n+r.amount,0);
      host.innerHTML+='<section aria-label="Overdue invoice statement" style="margin-top:20px"><h2>Overdue invoice statement</h2><p class="muted" style="font-size:12px">Due-date period: '+esc(from||'Beginning')+' to '+esc(to||'Today')+' · '+overdueRows.length+' invoices · Total overdue: '+esc(money(total))+' · Includes previous years in the selected period.</p>'+((from&&to&&from>to)?'<p role="alert">The start date must be on or before the end date.</p>':'<div style="overflow:auto"><table style="width:100%;min-width:800px;border-collapse:collapse;font-size:13px"><thead><tr>'+['Customer','Department','Purchase Order','Invoice Number','Due Date','Overdue Amount'].map(h=>'<th style="padding:10px;text-align:left;background:#14263d;color:white">'+h+'</th>').join('')+'</tr></thead><tbody>'+overdueRows.map(r=>'<tr>'+[r.customer,r.department,r.po,r.invoice,r.due,money(r.amount)].map(v=>'<td style="padding:10px;border-bottom:1px solid #e2e8f0">'+esc(v)+'</td>').join('')+'</tr>').join('')+(overdueRows.length?'':'<tr><td colspan="6" style="padding:15px">No overdue invoices in this period.</td></tr>')+'</tbody><tfoot><tr><th colspan="5" style="padding:10px;text-align:left">Total overdue</th><th style="padding:10px;text-align:left">'+esc(money(total))+'</th></tr></tfoot></table></div>')+'</section>';
    }
  }
  let drillState={company:null,project:null,order:null};
  function button(label,handler,secondary=false){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=secondary?'pe-secondary':'';b.onclick=handler;return b;}
  function drillHost(){
    let host=document.getElementById('customerWorkspace');
    if(!host){host=document.createElement('section');host.id='customerWorkspace';host.className='pe-drill';const anchor=document.getElementById('customerOverview');(anchor?.parentElement||document.querySelector('main,.container')).append(host);}
    host.hidden=false;return host;
  }
  function table(host,headers,rows,actions){
    const wrap=document.createElement('div');wrap.className='pe-table-wrap';const t=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
    for(const label of headers){const th=document.createElement('th');th.textContent=label;tr.append(th);}thead.append(tr);t.append(thead);
    const body=document.createElement('tbody');for(const row of rows){const line=document.createElement('tr');for(const value of row.cells){const td=document.createElement('td');td.textContent=value;line.append(td);}const td=document.createElement('td');td.className='pe-row-actions';actions(td,row.record);line.append(td);body.append(line);}t.append(body);wrap.append(t);host.append(wrap);
    if(!rows.length){const p=document.createElement('p');p.textContent='No '+(closedView?'closed':'open')+' records in this group.';host.append(p);}
  }
  function openCustomer(name){
    drillState={company:name,project:null,order:null};renderDrill();drillHost().scrollIntoView({behavior:'smooth',block:'start'});
  }
  function renderDrill(){
    const host=drillHost(),d=PEAnnual.records();host.replaceChildren();
    const nav=document.createElement('div');nav.className='pe-breadcrumb';
    nav.append(button('Customers',()=>{host.hidden=true;document.getElementById('customerOverview')?.scrollIntoView({behavior:'smooth'});},true),
      button(drillState.company,()=>{drillState.project=null;drillState.order=null;renderDrill();},true));
    if(drillState.project)nav.append(button(drillState.project.project_name,()=>{drillState.order=null;renderDrill();},true));
    if(drillState.order)nav.append(button(drillState.order.po_no,()=>renderDrill(),true));
    const alternate=new URLSearchParams({customer:drillState.company});
    if(!closedView)alternate.set('view','closed');
    if(drillState.project)alternate.set('project_id',drillState.project.id);
    if(drillState.order)alternate.set('po_id',drillState.order.id);
    const switcher=document.createElement('a');switcher.href='companies.html?'+alternate;switcher.textContent=closedView?'Open records in this group':'Closed records in this group';nav.append(switcher);
    host.append(nav);
    const title=document.createElement('h2');title.textContent=drillState.order?'Invoices · '+drillState.order.po_no:drillState.project?'Purchase Orders · '+drillState.project.project_name:'Projects · '+drillState.company;host.append(title);
    const manager=typeof cmManager==='function'&&cmManager();
    if(!drillState.project){
      const customer=typeof cmState!=='undefined'?cmState.customers.find(c=>c.name===drillState.company):null;
      if(manager&&customer){host.append(button('Edit Customer',()=>cmOpenRename(customer.id)),button('Departments',()=>cmOpenLinks(customer.id)));}
      if(manager&&!closedView)host.append(button('Add Project',()=>addProjectForCompany(drillState.company)));
      const rows=d.projects.filter(p=>p.company===drillState.company&&(matches('project',p)||(closedView&&d.invoices.some(i=>text(i.project_id)===text(p.id)&&invoiceClosed(i)))));
      table(host,['Project','Department','Status','Actions'],rows.map(p=>({record:p,cells:[p.project_name,p.department||'—',p.status||'—']})),(td,p)=>{
        td.append(button('Open Purchase Orders',()=>{drillState.project=p;renderDrill();}));
        if(manager){td.append(button('Edit',()=>editProject(p.id),true));td.append(button('Delete',()=>deleteProject(p.id),true));}
      });
    }else if(!drillState.order){
      const p=drillState.project;if(manager){host.append(button('Edit Project',()=>editProject(p.id)));if(!closedView)host.append(button('Add Purchase Order',()=>directAddPO(p.id,p.project_name)));}
      const rows=d.orders.filter(po=>text(po.project_id)===text(p.id)&&(matches('order',po)||(closedView&&d.invoices.some(i=>text(i.po_no)===text(po.po_no)&&invoiceClosed(i)))));
      table(host,['PO Number','PO Value','Status','Actions'],rows.map(po=>({record:po,cells:[po.po_no,money(po.po_value_ex_vat),po.status||'Open']})),(td,po)=>{
        td.append(button('Open Invoices',()=>{drillState.order=po;renderDrill();}));
        if(manager)td.append(button('Edit',()=>editPO(po.id),true));
        td.append(button('Attachments',()=>manageAttachments('po',po.id),true));
      });
    }else{
      const po=drillState.order;
      if(manager&&!closedView)host.append(button('Add Invoice',()=>addInvoice(po.po_no,po.project_id)));
      const rows=d.invoices.filter(i=>(text(i.pos_id)===text(po.id)||text(i.po_no)===text(po.po_no))&&matches('invoice',i));
      table(host,['Invoice','Status','Total Incl. VAT','Paid','Retention Balance','Actions'],rows.map(i=>{const m=PEAnnual.metrics(i,po);return{record:i,cells:[i.invoice_no,i.status||'—',money(m.total),money(i.paid_amount),money(m.retention)]};}),(td,i)=>{
        td.append(button('Open / Edit',()=>{if(typeof showRegisterInvoice==='function')showRegisterInvoice(i.id);else showInvoiceDetails(i.id);}));
        td.append(button('Attachments',()=>manageAttachments('invoice',i.id),true));
      });
    }
  }
  let requested=false;
  function openFromQuery(){
    const params=new URLSearchParams(location.search),name=params.get('customer');
    if(requested||!name||!PEAnnual.records().projects.length)return;
    requested=true;drillState.company=name;
    drillState.project=PEAnnual.records().projects.find(p=>text(p.id)===params.get('project_id'))||null;
    drillState.order=PEAnnual.records().orders.find(p=>text(p.id)===params.get('po_id'))||null;
    renderDrill();
  }
  function refreshDrill(){
    const host=document.getElementById('customerWorkspace');
    if(!host||host.hidden||!drillState.company)return;
    const d=PEAnnual.records();
    if(drillState.project)drillState.project=d.projects.find(p=>text(p.id)===text(drillState.project.id))||null;
    if(drillState.order)drillState.order=d.orders.find(p=>text(p.id)===text(drillState.order.id))||null;
    renderDrill();
  }
  global.PEWorkspace={orderState,matches,invoiceClosed,explicit,customerClosed,monthly,openCustomer,renderDrill,refreshDrill,closedView,mount,openFromQuery};
  document.addEventListener('DOMContentLoaded',mount);
})(window);



