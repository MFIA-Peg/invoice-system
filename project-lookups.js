(function(global){
 'use strict';
 const state={departments:[],customers:[],links:[],loaded:false},str=v=>String(v??'');
 const byId=id=>document.getElementById(id);
 function choices(select,rows,placeholder,current=''){
  select.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent=placeholder;select.append(blank);
  for(const row of rows){const o=document.createElement('option');o.value=row.name;o.textContent=row.name;select.append(o);}
  if(current&&!rows.some(r=>r.name===current)){const legacy=document.createElement('option');legacy.value=current;legacy.textContent=current+' (review required)';legacy.disabled=true;select.append(legacy);}
  select.value=current;
 }
 async function load(){
  if(state.loaded)return;
  const rs=await Promise.all([supabaseClient.from('departments').select('id,name').order('name'),supabaseClient.from('customer_companies').select('id,name').order('name'),supabaseClient.from('department_customer_companies').select('id,department_id,customer_company_id')]);
  const bad=rs.find(r=>r.error);if(bad)throw bad.error;
  [state.departments,state.customers,state.links]=rs.map(r=>r.data||[]);state.loaded=true;
 }
 function customerChanged(){
  const customer=state.customers.find(c=>c.name===byId('new_company').value),dept=byId('new_department'),old=dept.value;
  const ids=new Set(state.links.filter(l=>str(l.customer_company_id)===str(customer?.id)).map(l=>str(l.department_id)));
  const rows=customer?state.departments.filter(d=>ids.has(str(d.id))):state.departments;
  choices(dept,rows,'Select a department',rows.some(r=>r.name===old)?old:rows.length===1?rows[0].name:'');
  global.PESearchableSelects?.refresh();
 }
 function departmentChanged(){
  const dept=state.departments.find(d=>d.name===byId('new_department').value),customer=byId('new_company'),old=customer.value;
  const ids=new Set(state.links.filter(l=>str(l.department_id)===str(dept?.id)).map(l=>str(l.customer_company_id)));
  const rows=dept?state.customers.filter(c=>ids.has(str(c.id))):state.customers;
  choices(customer,rows,'Select an existing customer',rows.some(r=>r.name===old)?old:'');global.PESearchableSelects?.refresh();
 }
 async function prepare(record={}){
  await load();const customer=byId('new_company'),dept=byId('new_department');
  choices(customer,state.customers,'Select an existing customer',record.company||'');choices(dept,state.departments,'Select a department',record.department||'');
  if(!customer.dataset.lookupBound){customer.addEventListener('change',customerChanged);dept.addEventListener('change',departmentChanged);customer.dataset.lookupBound='true';}
  let note=byId('projectLookupNote');if(!note){note=document.createElement('p');note.id='projectLookupNote';note.className='cm-muted';dept.parentElement.insertBefore(note,dept.nextSibling);}
  note.textContent='Choose a registered customer and a linked department. Manage customer links on Customers or Departments.';
  global.PESearchableSelects?.refresh();
 }
 function validate(){
  const c=state.customers.find(r=>r.name===byId('new_company').value),d=state.departments.find(r=>r.name===byId('new_department').value);
  if(!c||!d)return 'Choose the customer and department from their registered lists.';
  if(!state.links.some(l=>str(l.customer_company_id)===str(c.id)&&str(l.department_id)===str(d.id)))return 'This customer is not linked to the selected department. Link them on Customers or Departments first.';
  return '';
 }
 function selectCustomer(name){byId('new_company').value=name;customerChanged();}
 global.PEProjectLookups={prepare,validate,selectCustomer,state};
})(window);

