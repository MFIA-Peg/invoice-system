(function(global){
'use strict';
let state={manager:false,user_id:null,modules:{}},loading,loadedAt=0,loadedClient;
const routes={'companies.html':'customers','departments.html':'departments','projects.html':'projects','purchase-orders.html':'orders','invoices.html':'invoices','collections.html':'collections'};
function pageModule(){
 const p=new URLSearchParams(location.search),file=location.pathname.split('/').pop();
 if(file==='companies.html'){
  if(p.has('project_action')||p.get('create')==='project')return 'projects';
  const kind=p.get('record')||p.get('create');
  if(['po','purchase-order'].includes(kind))return 'orders';
  if(kind==='invoice')return 'invoices';
 }
 return routes[file]||null;
}
function can(module,action,department){
 if(!state.user_id)return false;if(state.manager===true)return true;
 if(state.mode==='viewer'&&action!=='view')return false;
 if(!(state.modules?.[module]?.view===true&&state.modules?.[module]?.[action]===true))return false;
 if(state.tree&&action!=='view'&&department){const rule=(state.department_rules||[]).find(d=>d.name===department);return rule?.[action]===true;}
 return true;
}
function canCustomer(action,id){if(state.manager)return true;if(id==null||!state.tree)return can('customers',action);return can('customers',action)&&state.customer_operations?.[String(id)]?.[action]===true;}
async function load(client,module=pageModule()){
 if(!loading&&(loadedClient!==client||Date.now()-loadedAt>5000))loading=client.rpc('get_my_module_access').then(r=>{if(r.error)throw r.error;state=r.data||{};if(!state.user_id)throw new Error('An active account with a completed password change is required.');loadedAt=Date.now();loadedClient=client;return state;}).finally(()=>loading=null);
 await loading;
 if((module&&!can(module,'view'))||(state.mode==='viewer'&&!['dashboard.html','dashboard-trial.html','reports.html'].includes(location.pathname.split('/').pop()))){document.body.classList.add('pe-access-denied');let banner=document.getElementById('peAccessMessage');if(!banner){banner=document.createElement('div');banner.id='peAccessMessage';banner.setAttribute('role','alert');banner.style.cssText='margin:30px;padding:24px;background:white;border:1px solid #cbd5e1;border-radius:12px';document.body.prepend(banner);}banner.textContent='You do not have permission to open this screen. Contact your Finance Manager.';throw new Error('You do not have View permission for this screen.');}
 document.body.classList.remove('pe-access-denied');document.getElementById('peAccessMessage')?.remove();document.dispatchEvent(new Event('pe-access-ready'));schedule();return state;
}
async function requirePermission(client,module,action,department){
 const r=await client.rpc('can_module',{p_module:module,p_action:action});if(r.error)throw r.error;
 if(r.data!==true)throw new Error('You do not have '+action+' permission for '+module+'.');
 if(department&&action!=='view'){const d=await client.rpc('department_operation',{p_department:department,p_action:action});if(d.error)throw d.error;if(d.data!==true)throw new Error('You do not have '+action+' permission for this department.');}
}
function actionFor(element){
 if(element.dataset.accessModule)return [element.dataset.accessModule,element.dataset.accessAction||'view'];
 const onclick=element.getAttribute('onclick')||'',href=element.getAttribute('href')||'';
 const patterns=[
 [/deleteInvoice/,'invoices','delete'],[/saveNewInvoice|addInvoice/,'invoices','add'],[/saveInvoiceChanges|enableInvoiceEdit/,'invoices','edit'],
 [/deleteProject/,'projects','delete'],[/addProject/,'projects','add'],[/editProject|changeStatus/,'projects','edit'],
 [/deletePO/,'orders','delete'],[/directAddPO/,'orders','add'],[/editPO/,'orders','edit']
 ];
 for(const [pattern,module,action]of patterns)if(pattern.test(onclick))return [module,action];
 if(href.includes('project_action=edit'))return ['projects','edit'];
 if(href.includes('create=')){const p=new URL(href,location.href).searchParams;return [p.get('create')==='project'?'projects':p.get('create')==='invoice'?'invoices':'orders','add'];}
 const id=element.id,mod=pageModule();
 const ids={openCreate:[mod,'add'],cmAdd:['customers','add'],addDepartment:['departments','add'],invoiceEditButton:['invoices','edit'],newInvoiceComment:['invoices','add']};
 if(ids[id])return ids[id];
 if(element.hasAttribute('data-project-delete'))return ['projects','delete'];
 if(element.hasAttribute('data-received-payments'))return ['collections','view'];
 if(element.hasAttribute('data-invoice-delete'))return ['invoices','delete'];
 if(element.hasAttribute('data-po-delete'))return ['orders','delete'];
 if(element.hasAttribute('data-payment-edit'))return ['collections','edit'];
 if(element.hasAttribute('data-payment-delete'))return ['collections','delete'];
 if(element.hasAttribute('data-collection-edit'))return ['collections','edit'];
 if(element.hasAttribute('data-collection-delete'))return ['collections','delete'];
 return null;
}
let reportInitialized=false;
let scheduled=false;
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;apply();});}
function apply(){
 document.querySelectorAll('a[href]').forEach(a=>{
  if(state.mode==='viewer'&&a.getAttribute('href')?.split('?')[0]==='closed-records.html'){a.setAttribute('href','reports.html?view=closed');a.textContent='Historical Reports';}
  const href=a.getAttribute('href'),target=href.split('?')[0];let module=routes[target];if(target==='companies.html'&&href.includes('?')){const p=new URL(href,location.href).searchParams,kind=p.get('record')||p.get('create');if(p.has('project_action')||kind==='project')module='projects';else if(['po','purchase-order'].includes(kind))module='orders';else if(kind==='invoice')module='invoices';}if(module&&state.user_id)a.classList.toggle('pe-denied',state.mode==='viewer'||!can(module,'view'));
 });
 document.querySelectorAll('button,a.btn,.project-action,[data-access-module]').forEach(element=>{
  const action=actionFor(element);if(!action||!action[0]||!state.user_id)return;
  const department=element.dataset.accessDepartment||element.closest('[data-access-department]')?.dataset.accessDepartment;const denied=!can(action[0],action[1],department);element.classList.toggle('pe-denied',denied);
  if(denied)element.setAttribute('aria-disabled','true');else element.removeAttribute('aria-disabled');
 });
 if(location.pathname.endsWith('/reports.html')&&state.user_id){
  const tabs=[...document.querySelectorAll('[data-tab]')];
  for(const tab of tabs){const allowed=can(tab.dataset.tab==='pos'?'orders':tab.dataset.tab,'view');tab.classList.toggle('pe-denied',!allowed);}
  const selected=tabs.find(t=>t.classList.contains('active')),requested=new URLSearchParams(location.search).get('report');
  if(!reportInitialized||!selected||selected.classList.contains('pe-denied')){
   const next=(!reportInitialized&&tabs.find(t=>t.dataset.tab===requested&&!t.classList.contains('pe-denied')))||tabs.find(t=>!t.classList.contains('pe-denied'));
   if(next)next.click();reportInitialized=true;
  }
 }
 const comment=document.getElementById('invoiceComment');if(comment&&state.user_id&&!can('invoices','add'))comment.disabled=true;
}
document.addEventListener('click',event=>{const denied=event.target.closest('.pe-denied');if(denied){event.preventDefault();event.stopImmediatePropagation();}},true);
function installGuards(client){
 const guards={addProject:['projects','add'],addProjectForCompany:['projects','add'],deleteProject:['projects','delete'],editProject:['projects','edit'],changeStatus:['projects','edit'],directAddPO:['orders','add'],deletePO:['orders','delete'],addInvoice:['invoices','add'],saveNewInvoice:['invoices','add'],enableInvoiceEdit:['invoices','edit'],saveInvoiceChanges:['invoices','edit'],deleteInvoice:['invoices','delete']};
 for(const [name,[module,action]]of Object.entries(guards)){
  const original=global[name];if(typeof original!=='function'||original.peGuarded)continue;
  const wrapped=async function(...args){try{await requirePermission(client,module,action);return await original.apply(this,args);}catch(error){alert(error.message||String(error));}};
  wrapped.peGuarded=true;global[name]=wrapped;
 }
}
document.addEventListener('DOMContentLoaded',()=>{new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});schedule();});
global.PEAccess={load,can,require:requirePermission,pageModule,installGuards,canCustomer,get state(){return state;}};
})(window);

