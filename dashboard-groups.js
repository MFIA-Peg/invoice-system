(function(global){
'use strict';
const metrics=[['Billing Incl VAT','billed','#2563eb'],['Collections','collections','#16a34a'],['Advances Received','advances','#d97706'],['Net Collectible','collectible','#dc2626'],['Pending Approval','pending','#d97706'],['Retention','retention','#7c3aed'],['Draft','draft','#64748b'],['Overdue','overdue','#dc2626'],['Draft and Pending Approval','unissued','#d97706']];
let host,last,currentKey='billed';const str=v=>String(v??''),num=v=>Number(v||0),money=v=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',minimumFractionDigits:2,maximumFractionDigits:2}).format(num(v));
function el(tag,text){const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;}
function groups(s,key){
 const d=PEAnnual.records(),im=new Map(d.invoices.map(i=>[str(i.id),i])),om=new Map(d.orders.map(p=>[str(p.id),p])),pm=new Map(d.projects.map(p=>[str(p.id),p])),result=[new Map(),new Map(),new Map()];
 let entries=[];
 if(key==='collections')entries=s.collections.map(c=>({invoice:im.get(str(c.invoice_id)),amount:num(c.amount)}));
 else if(key==='advances')entries=s.advances.map(a=>({order:om.get(str(a.po_id)),amount:num(a.amount)}));
 else{const rows=key==='billed'?s.billed:key==='collectible'?s.collectibleInvoices:key==='pending'?s.waiting:key==='retention'?s.retentionInvoices:key==='overdue'?s.scoped.filter(i=>PEAnnual.isIssued(i)&&PEAnnual.metrics(i).overdue>.005):key==='unissued'?s.draft.concat(s.waiting):s.draft;entries=rows.map(i=>({invoice:i,amount:(key==='collectible'||key==='overdue')?PEAnnual.metrics(i).balance:key==='retention'?PEAnnual.metrics(i).retention:PEAnnual.metrics(i).total}));}
 for(const entry of entries){const i=entry.invoice,p=entry.order||(i&&PEAnnual.orderFor(i)),pr=pm.get(str(p?.project_id??i?.project_id)),labels=[p?.department??pr?.department??i?.department,p?.company??pr?.company??i?.company,pr?.project_name??p?.project_name??i?.project_name];for(let k=0;k<3;k++){const name=str(labels[k]).trim()||'Unassigned';result[k].set(name,(result[k].get(name)||0)+entry.amount);}}
 return result.map(map=>[...map].map(([name,value])=>({name,value:PEAnnual.round(value)})).filter(r=>Math.abs(r.value)>.005).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name)));
}
function mount(){
 if(host)return;host=document.getElementById('dashboardGroupedTotals');if(!host){host=el('section');host.id='dashboardGroupedTotals';host.className='panel';const report=document.getElementById('dashboardInvoices');if(!report)return;report.before(host);}
 const style=el('style');style.textContent='#dashboardGroupedTotals .dg-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}#dashboardGroupedTotals h2{font-size:18px;margin:0}#dashboardGroupedTotals .dg-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}#dashboardGroupedTotals .dg-chart{min-width:0;border:1px solid #e2e8f0;border-radius:8px;padding:10px}#dashboardGroupedTotals h3{font-size:14px;margin:0 0 6px}#dashboardGroupedTotals .dg-list{max-height:420px;overflow-y:auto}#dashboardGroupedTotals .dg-row{display:grid;grid-template-columns:minmax(85px,40%) minmax(20px,1fr) max-content;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:10px}#dashboardGroupedTotals .dg-name{overflow-wrap:anywhere}#dashboardGroupedTotals .dg-track{height:12px;background:#edf2f7;border-radius:3px;overflow:hidden}#dashboardGroupedTotals .dg-fill{height:100%;background:var(--dg-color);min-width:1px;border-radius:3px}#dashboardGroupedTotals .dg-value{font-variant-numeric:tabular-nums;white-space:nowrap}#dashboardGroupedTotals .dg-total,#dashboardGroupedTotals .dg-note{font-size:11px;color:#64748b;margin:6px 0}@media(max-width:1100px){#dashboardGroupedTotals .dg-grid{grid-template-columns:1fr}}';document.head.append(style);
 const heading=el('div');heading.className='dg-head';heading.append(el('h2','Grouped Totals'));host.append(heading);const note=el('p');note.className='dg-note';host.append(note);const grid=el('div');grid.className='dg-grid';host.append(grid);
}
function draw(){
 if(!last)return;mount();if(!host)return;const [label,key,color]=metrics.find(m=>m[1]===currentKey)||metrics[0],data=groups(last,key),grid=host.querySelector('.dg-grid');host.querySelector('.dg-note').textContent='Matches the upper filters and selected financial total. Current total: '+label+'. All matching groups are included.';grid.replaceChildren();
 for(const [index,title]of ['Departments','Customers','Projects'].entries()){const box=el('article');box.className='dg-chart';box.style.setProperty('--dg-color',color);box.append(el('h3',title));const rows=data[index],total=PEAnnual.round(rows.reduce((n,r)=>n+r.value,0)),sub=el('p',money(total)+' · '+rows.length+' groups');sub.className='dg-total';box.append(sub);const list=el('div');list.className='dg-list';list.setAttribute('role','img');list.setAttribute('aria-label',title+' · '+metrics.find(m=>m[1]===key)[0]+' · '+money(total));const max=Math.max(1,...rows.map(r=>Math.abs(r.value)));for(const row of rows){const line=el('div');line.className='dg-row';const name=el('span',row.name);name.className='dg-name';name.title=row.name;const track=el('div');track.className='dg-track';const fill=el('div');fill.className='dg-fill';fill.style.width=Math.abs(row.value)/max*100+'%';track.append(fill);const value=el('span',money(row.value));value.className='dg-value';line.append(name,track,value);list.append(line);}if(!rows.length)list.append(el('p','No amounts match the selected criteria.'));box.append(list);grid.append(box);}
}
function totalFor(filters={}){
 const active=global.PEKPIFilter?.active()?.label,match=metrics.find(m=>m[0]===active);if(match)return match[1];
 if(filters.attention==='overdue')return 'overdue';
 const workflow=PEAnnual.workflow({status:filters.invoiceStatus});
 if(filters.attention==='draftDue'||filters.attention==='draft'||workflow==='draft')return 'draft';
 if(filters.attention==='waiting'||workflow==='waiting')return 'pending';
 if(String(filters.invoiceStatus||'').trim().toLowerCase()==='retention'||filters.paymentStatus==='Retention Only')return 'retention';
 if(filters.paymentStatus==='Not Issued')return 'unissued';
 if(filters.paymentStatus==='Overdue')return 'collectible';
 return 'billed';
}
function render(snapshot,filters={}){last=snapshot;currentKey=totalFor(filters);draw();}
global.PEDashboardGroups={render,groups,totalFor};
})(window);
