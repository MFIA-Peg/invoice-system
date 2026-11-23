(function(global){
'use strict';
let catalog={customers:[],departments:[],projects:[],orders:[],links:[]};
const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const actions=['add','edit','delete'];
let state;
const customerId=name=>catalog.customers.find(c=>c.name===name)?.id;
const deptCustomers=id=>catalog.customers.filter(c=>catalog.links.some(l=>Number(l.department_id)===Number(id)&&Number(l.customer_company_id)===Number(c.id)));
const deptProjects=id=>{const d=catalog.departments.find(d=>Number(d.id)===Number(id));return catalog.projects.filter(p=>p.department===d?.name&&deptCustomers(id).some(c=>c.name===p.company));};
function newRule(id){return {id:Number(id),add:false,edit:false,delete:false,customers:new Set(deptCustomers(id).map(c=>Number(c.id))),projects:new Set(deptProjects(id).filter(p=>deptCustomers(id).some(c=>c.name===p.company)).map(p=>Number(p.id)))};}
function setup(context){
 state={mode:'editor',viewerType:'departments',selected:new Set(),rules:new Map(),filters:{},legacy:false};
 if(!context)return;
 const perm=context.permissions||{},profile=perm.access_profile;
 const writable=Object.values(perm.module_permissions||{}).some(m=>m.add||m.edit||m.delete)||perm.can_add||perm.can_edit||perm.can_delete;
 state.mode=profile?.mode||(writable?'editor':'viewer');state.viewerType=profile?.viewer_type||'departments';state.legacy=!profile;
 const dids=catalog.departments.filter(d=>(context.departmentNames||[]).includes(d.name)).map(d=>Number(d.id));
 const globalFlags=Object.fromEntries(actions.map(a=>[a,Object.values(perm.module_permissions||{}).some(m=>m[a])||perm['can_'+a]===true]));
 for(const id of dids){
  const rule=newRule(id),row=(context.departmentRules||[]).find(r=>Number(r.department_id)===id);
  for(const a of actions)rule[a]=profile?row?.['can_'+a]===true:globalFlags[a];
  const selectedCustomers=profile?(context.pairs||[]).filter(p=>Number(p.department_id)===id).map(p=>Number(p.customer_company_id)):(context.customerIds||[]).map(Number);
  rule.customers=new Set(deptCustomers(id).filter(c=>selectedCustomers.includes(Number(c.id))).map(c=>Number(c.id)));
  rule.projects=new Set(deptProjects(id).filter(p=>(context.projectIds||[]).map(Number).includes(Number(p.id))&&rule.customers.has(Number(customerId(p.company)))).map(p=>Number(p.id)));
  state.rules.set(id,rule);
 }
 state.selected=new Set((state.viewerType==='customers'?context.customerIds:state.viewerType==='projects'?context.projectIds:state.viewerType==='orders'?context.orderIds:dids)||[]);
 state.selected=new Set([...state.selected].map(Number));
}
function badges(rule){return actions.map(a=>'<span class="sa-badge '+(rule[a]?'enabled':'')+'">'+(rule[a]?'✓ ':'— ')+a[0].toUpperCase()+a.slice(1)+'</span>').join('');}
function markup(context){
 setup(context);
 return '<section class="sa-access"><h3>Access profile</h3><label for="accessMode">User type</label><select id="accessMode"><option value="viewer" '+(state.mode==='viewer'?'selected':'')+'>Viewer — Dashboard and Reports only</option><option value="editor" '+(state.mode==='editor'?'selected':'')+'>Editor — Department permission tree</option></select>'+(state.legacy?'<p class="muted">Existing access has been loaded. Save to apply the inherited department rules shown below.</p>':'')+'<div id="accessModeBody"></div></section>';
}
function mount(){
 el('accessMode').onchange=()=>{state.mode=el('accessMode').value;renderMode();};
 renderMode();
}
function viewerRows(){return catalog[state.viewerType]||[];}
function recordLabel(row,type){
 if(type==='projects')return row.project_name+' · '+(row.company||'')+' · '+(row.department||'');
 if(type==='orders')return (row.po_no||'Unnumbered PO')+' · '+(row.company||'')+' · '+(row.project_name||'');
 return row.name;
}
function renderMode(){
 if(state.mode==='viewer'){
  el('accessModeBody').innerHTML='<p class="sa-hint">Viewer can open only Dashboard and Reports. No add, edit or delete operations are allowed.</p><label for="viewerType">Monitoring type</label><select id="viewerType">'+[['customers','Customers'],['departments','Departments'],['projects','Projects'],['orders','Purchase Orders']].map(([key,label])=>'<option value="'+key+'" '+(state.viewerType===key?'selected':'')+'>'+label+'</option>').join('')+'</select><div class="sa-tools"><input type="search" id="viewerSearch" placeholder="Search monitoring records"><button type="button" id="viewerSelectAll">Select matching</button><button type="button" id="viewerClear">Clear all</button></div><div id="viewerRecords" class="sa-check-list"></div><p id="viewerSelectedCount" class="muted"></p>';
  el('viewerType').onchange=()=>{state.viewerType=el('viewerType').value;state.selected.clear();renderMode();};
  el('viewerSearch').oninput=renderViewer;
  el('viewerSelectAll').onclick=()=>{const q=el('viewerSearch').value.trim().toLowerCase();viewerRows().filter(r=>recordLabel(r,state.viewerType).toLowerCase().includes(q)).forEach(r=>state.selected.add(Number(r.id)));renderViewer();};
  el('viewerClear').onclick=()=>{state.selected.clear();renderViewer();};renderViewer();return;
 }
 el('accessModeBody').innerHTML='<h3>1. Departments and operations</h3><p class="muted">Choose one or more departments. Add, Edit and Delete are inherited by the selected customers, projects, purchase orders, invoices and collections in each department.</p><div class="sa-tools"><button type="button" id="treeSelectAll">Select all departments</button><button type="button" id="treeClearAll">Clear departments</button></div><div id="departmentTreeSelector"></div><h3>2. Customers and projects</h3><p class="muted">Newly selected departments include all their customers and projects. Clear individual choices below to restrict access.</p><div id="departmentChildren"></div><h3>3. Inherited financial permissions</h3><div id="financialInheritance"></div>';
 el('treeSelectAll').onclick=()=>{for(const d of catalog.departments)if(!state.rules.has(Number(d.id)))state.rules.set(Number(d.id),newRule(d.id));renderDepartments();renderChildren();};
 el('treeClearAll').onclick=()=>{state.rules.clear();renderDepartments();renderChildren();};
 renderDepartments();renderChildren();
}
function renderViewer(){
 const q=el('viewerSearch').value.trim().toLowerCase(),rows=viewerRows().filter(r=>recordLabel(r,state.viewerType).toLowerCase().includes(q));
 el('viewerRecords').innerHTML=rows.map(r=>'<label><input type="checkbox" data-viewer-id="'+r.id+'" '+(state.selected.has(Number(r.id))?'checked':'')+'><span>'+esc(recordLabel(r,state.viewerType))+'</span></label>').join('')||'<p>No matching records.</p>';
 el('viewerRecords').querySelectorAll('[data-viewer-id]').forEach(cb=>cb.onchange=()=>{const id=Number(cb.dataset.viewerId);if(cb.checked)state.selected.add(id);else state.selected.delete(id);el('viewerSelectedCount').textContent=state.selected.size+' selected';});
 el('viewerSelectedCount').textContent=state.selected.size+' selected';
}
function renderDepartments(){
 el('departmentTreeSelector').innerHTML='<table class="sa-rules"><thead><tr><th>Department</th><th>Add</th><th>Edit</th><th>Delete</th></tr></thead><tbody>'+catalog.departments.map(d=>{const r=state.rules.get(Number(d.id));return '<tr><td><label><input type="checkbox" data-department-id="'+d.id+'" '+(r?'checked':'')+'> '+esc(d.name)+'</label></td>'+actions.map(a=>'<td><input type="checkbox" aria-label="'+esc(d.name)+' '+a+'" data-department-operation="'+a+'" data-department="'+d.id+'" '+(r?.[a]?'checked':'')+' '+(!r?'disabled':'')+'></td>').join('')+'</tr>';}).join('')+'</tbody></table>';
 el('departmentTreeSelector').querySelectorAll('[data-department-id]').forEach(cb=>cb.onchange=()=>{const id=Number(cb.dataset.departmentId);if(cb.checked)state.rules.set(id,newRule(id));else state.rules.delete(id);renderDepartments();renderChildren();});
 el('departmentTreeSelector').querySelectorAll('[data-department-operation]').forEach(cb=>cb.onchange=()=>{const rule=state.rules.get(Number(cb.dataset.department));if(rule){rule[cb.dataset.departmentOperation]=cb.checked;renderChildren();}});
}
function renderChildren(){
 const rules=[...state.rules.values()];
 el('departmentChildren').innerHTML=rules.map(rule=>{
  const dep=catalog.departments.find(d=>Number(d.id)===rule.id),cs=deptCustomers(rule.id),ps=deptProjects(rule.id);
  return '<details class="sa-department" open><summary>'+esc(dep?.name)+' <span>'+badges(rule)+'</span></summary><div class="sa-child-columns">'+['customers','projects'].map(type=>{
   const rows=type==='customers'?cs:ps;
   return '<section><h4>'+ (type==='customers'?'Customers':'Projects')+'</h4><div class="sa-tools"><input type="search" data-child-search="'+rule.id+'-'+type+'" placeholder="Search '+type+'" value="'+esc(state.filters[rule.id+'-'+type]||'')+'"><button type="button" data-child-bulk="all" data-dept="'+rule.id+'" data-kind="'+type+'">All</button><button type="button" data-child-bulk="none" data-dept="'+rule.id+'" data-kind="'+type+'">None</button></div><div class="sa-check-list">'+rows.map(row=>'<label data-child-label="'+rule.id+'-'+type+'" data-search-label="'+esc(recordLabel(row,type).toLowerCase())+'"><input type="checkbox" data-child-id="'+row.id+'" data-dept="'+rule.id+'" data-kind="'+type+'" '+(rule[type].has(Number(row.id))?'checked':'')+'><span>'+esc(type==='customers'?row.name:row.project_name)+'</span></label>').join('')+'</div></section>';
  }).join('')+'</div></details>';
 }).join('')||'<p class="sa-hint">Choose a department above to open its customer and project tree.</p>';
 const filter=(key,q)=>{el('departmentChildren').querySelectorAll('[data-child-label="'+key+'"]').forEach(label=>label.hidden=!label.dataset.searchLabel.includes(q));};
 el('departmentChildren').querySelectorAll('[data-child-search]').forEach(input=>{const key=input.dataset.childSearch;input.oninput=()=>{state.filters[key]=input.value;filter(key,input.value.trim().toLowerCase());};filter(key,input.value.trim().toLowerCase());});
 el('departmentChildren').querySelectorAll('[data-child-id]').forEach(cb=>cb.onchange=()=>{
  const rule=state.rules.get(Number(cb.dataset.dept)),id=Number(cb.dataset.childId),type=cb.dataset.kind;
  if(cb.checked){rule[type].add(id);if(type==='projects'){const project=catalog.projects.find(p=>Number(p.id)===id);const cid=customerId(project?.company);if(cid!=null)rule.customers.add(Number(cid));}}
  else{rule[type].delete(id);if(type==='customers')for(const p of deptProjects(rule.id))if(Number(customerId(p.company))===id)rule.projects.delete(Number(p.id));}
  renderChildren();
 });
 el('departmentChildren').querySelectorAll('[data-child-bulk]').forEach(button=>button.onclick=()=>{
  const rule=state.rules.get(Number(button.dataset.dept)),type=button.dataset.kind;
  if(button.dataset.childBulk==='none'){rule[type].clear();if(type==='customers')rule.projects.clear();}
  else if(type==='customers')rule.customers=new Set(deptCustomers(rule.id).map(c=>Number(c.id)));
  else{rule.projects=new Set(deptProjects(rule.id).map(p=>Number(p.id)));for(const p of deptProjects(rule.id)){const cid=customerId(p.company);if(cid!=null)rule.customers.add(Number(cid));}}
  renderChildren();
 });
 el('financialInheritance').innerHTML=rules.length?'<table class="sa-rules"><thead><tr><th>Department</th><th>Purchase Orders</th><th>Invoices</th><th>Collections</th></tr></thead><tbody>'+rules.map(r=>'<tr><th>'+esc(catalog.departments.find(d=>Number(d.id)===r.id)?.name)+'</th>'+[1,2,3].map(()=>'<td>'+badges(r)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p class="muted">Financial permissions follow the selected departments.</p>';
}
function payload(){
 let config,add=false,edit=false,remove=false;
 if(state.mode==='viewer'){
  if(!state.selected.size)throw Error('Select at least one monitoring record.');
  config={mode:'viewer',viewer_type:state.viewerType,selected_ids:[...state.selected].sort((a,b)=>a-b)};
 }else{
  if(!state.rules.size)throw Error('Select at least one department.');
  config={mode:'editor',departments:[...state.rules.values()].sort((a,b)=>a.id-b.id).map(r=>({department_id:r.id,add:r.add,edit:r.edit,delete:r.delete,customer_ids:[...r.customers].sort((a,b)=>a-b),project_ids:[...r.projects].sort((a,b)=>a-b)}))};
  add=config.departments.some(r=>r.add);edit=config.departments.some(r=>r.edit);remove=config.departments.some(r=>r.delete);
 }
 const modules=Object.fromEntries(['customers','departments','projects','orders','invoices','collections'].map(m=>[m,{view:true,add,edit,delete:remove}]));
 return {can_view:true,can_add:add,can_edit:edit,can_delete:remove,modules,customer_ids:[],access_tree:config};
}
global.PEAdminAccess={markup,mount,payload,setCatalog:data=>{catalog=data;}};

let systemEnabled=false,mergeKind='customers',preview=null,mergeBusy=false;
function mountSystem(){
 const main=document.querySelector('main');if(!main||el('systemTabs'))return;
 const nav=document.createElement('nav');nav.id='systemTabs';nav.className='sa-system-tabs';nav.hidden=!systemEnabled;nav.setAttribute('aria-label','System administration sections');nav.innerHTML='<button type="button" id="systemUsersTab">User Management</button><button type="button" id="systemDataTab">Data Management</button>';main.prepend(nav);
 const userPanel=document.createElement('div');userPanel.id='systemUserPanel';const list=el('listView'),editor=el('editorView');list.before(userPanel);userPanel.append(list,editor);
 const dataPanel=document.createElement('section');dataPanel.id='systemDataPanel';dataPanel.className='panel';dataPanel.hidden=true;dataPanel.innerHTML='<div class="toolbar"><h2>Data Management</h2></div><div class="content"><p class="sa-hint">Merge a source customer, project or department into a destination. All linked records move together; financial values, invoice IDs and payment IDs are preserved.</p><div class="sa-merge-tabs">'+[['customers','Merge Customers'],['projects','Merge Projects'],['departments','Merge Departments']].map(([type,label])=>'<button type="button" data-merge-kind="'+type+'">'+label+'</button>').join('')+'</div><div class="sa-merge-fields"><div class="field"><label for="mergeSource">Transfer from</label><select id="mergeSource"><option value="">Select source</option></select></div><div class="field"><label for="mergeTarget">Transfer to</label><select id="mergeTarget"><option value="">Select destination</option></select></div></div><button type="button" id="previewMerge">Preview Transfer</button><div id="mergeStatus" role="status" aria-live="polite"></div><div id="mergePreview"></div><div id="mergeConfirmation" hidden><label class="sa-confirm"><input type="checkbox" id="confirmMergeCheck"> I confirm transferring all linked records and removing the source record.</label><button class="danger" type="button" id="executeMerge" disabled>Confirm Merge</button></div><h3>Recent merges</h3><div id="mergeHistory" class="sa-history"></div></div>';main.append(dataPanel);
 el('systemUsersTab').onclick=()=>selectSystemTab('users');el('systemDataTab').onclick=()=>{selectSystemTab('data');loadHistory();};
 document.querySelectorAll('[data-merge-kind]').forEach(button=>button.onclick=()=>{if(mergeBusy)return;mergeKind=button.dataset.mergeKind;refreshMergeOptions();});
 el('mergeSource').onchange=invalidatePreview;el('mergeTarget').onchange=invalidatePreview;
 el('previewMerge').onclick=previewMerge;el('executeMerge').onclick=executeMerge;el('confirmMergeCheck').onchange=()=>el('executeMerge').disabled=!el('confirmMergeCheck').checked||!preview?.can_merge;
 refreshMergeOptions();selectSystemTab(new URLSearchParams(location.search).get('tab')==='data'?'data':'users');
}
function selectSystemTab(tab){
 if(tab==='data'&&!systemEnabled)return;
 el('systemUserPanel').hidden=tab!=='users';el('systemDataPanel').hidden=tab!=='data';
 el('systemUsersTab').classList.toggle('selected',tab==='users');el('systemDataTab').classList.toggle('selected',tab==='data');
}
function status(message,bad=false){if(el('mergeStatus')){el('mergeStatus').textContent=message;el('mergeStatus').className=bad?'sa-error':'sa-success';}}
function invalidatePreview(){
 preview=null;if(!el('mergePreview'))return;el('mergePreview').replaceChildren();el('mergeConfirmation').hidden=true;el('confirmMergeCheck').checked=false;el('executeMerge').disabled=true;status('');
 el('previewMerge').disabled=mergeBusy||!el('mergeSource').value||!el('mergeTarget').value||el('mergeSource').value===el('mergeTarget').value;
}
function refreshMergeOptions(){
 if(!el('mergeSource'))return;
 document.querySelectorAll('[data-merge-kind]').forEach(button=>button.classList.toggle('selected',button.dataset.mergeKind===mergeKind));
 const rows=catalog[mergeKind]||[];
 for(const [id,label]of [['mergeSource','Select source'],['mergeTarget','Select destination']]){
  const select=el(id),previous=select.value;
  select.innerHTML='<option value="">'+label+'</option>'+rows.map(r=>'<option value="'+r.id+'">'+esc(recordLabel(r,mergeKind))+'</option>').join('');
  if(rows.some(r=>String(r.id)===previous))select.value=previous;
 }
 invalidatePreview();
}
function busy(value){mergeBusy=value;for(const id of ['mergeSource','mergeTarget','previewMerge','executeMerge','confirmMergeCheck'])el(id).disabled=value;if(!value){el('previewMerge').disabled=!el('mergeSource').value||!el('mergeTarget').value||el('mergeSource').value===el('mergeTarget').value;}if(!value)el('executeMerge').disabled=!el('confirmMergeCheck').checked||!preview?.can_merge;}
async function previewMerge(){
 if(mergeBusy)return;const source=Number(el('mergeSource').value),target=Number(el('mergeTarget').value);if(!source||!target||source===target)return status('Choose different source and destination records.',true);
 busy(true);status('Checking linked records…');
 try{
  const r=await client.rpc('merge_business_entity',{p_kind:mergeKind,p_source_id:source,p_target_id:target,p_preview:true});if(r.error)throw r.error;
  preview=r.data;if(!preview)throw Error('No preview was returned.');
  el('mergePreview').innerHTML='<h3>'+esc(preview.source)+' → '+esc(preview.destination)+'</h3><div class="sa-merge-counts">'+Object.entries(preview.counts||{}).map(([key,value])=>'<div><strong>'+esc(value)+'</strong><span>'+esc(key)+'</span></div>').join('')+'</div>'+ (preview.warnings||[]).map(w=>'<p class="sa-hint">'+esc(w)+'</p>').join('')+(preview.conflicts||[]).map(c=>'<p class="sa-error">'+esc(c)+'</p>').join('');
  el('mergeConfirmation').hidden=!preview.can_merge;el('confirmMergeCheck').checked=false;status(preview.can_merge?'Preview ready. Review the transfer before confirming.':'Merge blocked. Resolve the listed conflicts first.',!preview.can_merge);
 }catch(error){preview=null;el('mergeConfirmation').hidden=true;status(error.message||String(error),true);}
 finally{busy(false);}
}
async function executeMerge(){
 if(mergeBusy||!preview?.can_merge||!el('confirmMergeCheck').checked)return;
 const data=preview;busy(true);status('Merging linked records…');
 try{
  const r=await client.rpc('merge_business_entity',{p_kind:mergeKind,p_source_id:data.source_id,p_target_id:data.target_id,p_preview:false,p_expected_token:data.token});if(r.error)throw r.error;
  if(!r.data?.merged)throw Error('The server did not confirm the merge.');
  const result=r.data;await loadManagementData();refreshMergeOptions();status('Merge completed: '+result.source+' → '+result.destination+'. Financial values are unchanged. Reference '+result.audit_id+'.');await loadHistory();
 }catch(error){el('mergeConfirmation').hidden=true;preview=null;status('Merge failed: '+(error.message||String(error))+'. Preview again before retrying.',true);}
 finally{busy(false);}
}
async function loadHistory(){
 if(!systemEnabled||!el('mergeHistory'))return;
 try{const r=await client.from('data_merge_audit').select('id,created_at,entity_kind,source_name,target_name').order('id',{ascending:false}).limit(10);if(r.error)throw r.error;
 el('mergeHistory').innerHTML=(r.data||[]).map(row=>'<p><strong>#'+esc(row.id)+'</strong> '+esc(row.source_name)+' → '+esc(row.target_name)+' <span class="muted">'+esc(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'}).format(new Date(row.created_at)))+'</span></p>').join('')||'<p class="muted">No merges have been performed.</p>';
 }catch(error){el('mergeHistory').textContent='Unable to load merge history: '+(error.message||error);}
}
global.PEAdminData={enable:()=>{systemEnabled=true;if(el('systemTabs'))el('systemTabs').hidden=false;},setCatalog:data=>{catalog=data;refreshMergeOptions();}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountSystem);else mountSystem();
})(window);