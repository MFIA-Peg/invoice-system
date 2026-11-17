(function(global){
  'use strict';
  const closedView=new URLSearchParams(location.search).get('view')==='closed';
  const page=location.pathname.split('/').pop()||'dashboard.html';
  const text=value=>String(value??'');
  const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>Number(value||0);
  const money=value=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(num(value));
  const explicit=row=>row?.archive===true||/^(closed|completed|cancelled|canceled|void)$/i.test(text(row?.status).trim());
  function invoiceClosed(row){
    if(/^(cancelled|canceled|void)$/i.test(text(row?.status).trim()))return true;
    const records=PEAnnual.records();
    const po=records.orders.find(p=>String(p.id)===String(row.pos_id))||records.orders.find(p=>text(p.po_no)===text(row.po_no));
    const m=PEAnnual.metrics(row,po);
    return m.total>0&&num(row.paid_amount)+0.005>=m.total&&m.retention<=0.005;
  }
  function customerClosed(name){
    const d=PEAnnual.records(),ps=d.projects.filter(p=>text(p.company)===text(name)),os=d.orders.filter(p=>text(p.company)===text(name));
    const ids=new Set(ps.map(p=>text(p.id))),nos=new Set(os.map(p=>text(p.po_no)));
    const iv=d.invoices.filter(i=>ids.has(text(i.project_id))||nos.has(text(i.po_no)));
    return (ps.length+os.length+iv.length)>0&&ps.every(explicit)&&os.every(explicit)&&iv.every(invoiceClosed);
  }
  function matches(type,row){
    let closed=false;
    if(type==='invoice')closed=invoiceClosed(row);
    else if(type==='project'||type==='order')closed=explicit(row);
    else if(type==='customer'){
      if(closedView){
        const d=PEAnnual.records(),ps=d.projects.filter(p=>p.company===row.name),os=d.orders.filter(p=>p.company===row.name);
        const ids=new Set(ps.map(p=>text(p.id))),nos=new Set(os.map(p=>text(p.po_no)));
        return ps.some(explicit)||os.some(explicit)||d.invoices.some(i=>(ids.has(text(i.project_id))||nos.has(text(i.po_no)))&&invoiceClosed(i));
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
    const s=PEAnnual.snapshot(scope),y=PEAnnual.year,series=[Array(12).fill(0),Array(12).fill(0),Array(12).fill(0)];
    function add(values,date,value){if(PEAnnual.inYear(date)){const m=Number(String(date).slice(5,7))-1;if(m>=0&&m<12)values[m]+=value;}}
    for(const invoice of s.scoped){const m=PEAnnual.metrics(invoice,s.orderMap.get(text(invoice.po_no)));add(series[0],invoice.start_date,m.total);add(series[1],PEAnnual.due(invoice),m.total);}
    for(const c of s.collections)add(series[2],c.collection_date,num(c.amount));
    const labels=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],colors=['#2563eb','#d97706','#0f766e'];
    const max=Math.max(1,...series.flat()),width=1100,height=310,left=85,top=24,bottom=258,plotW=990,plotH=bottom-top,step=plotW/12;
    let svg='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Monthly invoice, expected collection and actual collection comparison for '+y+'">';
    for(let i=0;i<=4;i++){const v=max*i/4,yy=bottom-plotH*i/4;svg+='<line x1="'+left+'" y1="'+yy+'" x2="1080" y2="'+yy+'" stroke="#e2e8f0"/><text x="75" y="'+(yy+4)+'" text-anchor="end" font-size="11" fill="#64748b">'+esc(new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(v))+'</text>';}
    for(let m=0;m<12;m++){for(let j=0;j<3;j++){const v=series[j][m],h=v/max*plotH,x=left+m*step+9+j*19;svg+='<rect x="'+x+'" y="'+(bottom-h)+'" width="16" height="'+h+'" rx="3" fill="'+colors[j]+'"><title>'+labels[m]+' '+y+' · '+['Invoiced','Expected collection','Actual collection'][j]+': '+esc(money(v))+'</title></rect>';}svg+='<text x="'+(left+m*step+35)+'" y="281" text-anchor="middle" font-size="12" fill="#475569">'+labels[m]+'</text>';}
    svg+='</svg>';
    host.innerHTML='<div class="pe-monthly-legend"><span style="--series:#2563eb">Invoiced · invoice date</span><span style="--series:#d97706">Expected · due date</span><span style="--series:#0f766e">Actual · collection date</span></div><div class="pe-monthly-wrap">'+svg+'</div>';
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
        if(manager)td.append(button('Edit',()=>editProject(p.id),true));
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
  global.PEWorkspace={matches,invoiceClosed,explicit,customerClosed,monthly,openCustomer,renderDrill,refreshDrill,closedView,mount,openFromQuery};
  document.addEventListener('DOMContentLoaded',mount);
})(window);
