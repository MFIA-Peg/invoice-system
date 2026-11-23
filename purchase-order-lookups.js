(function(global){
'use strict';
const el=id=>document.getElementById(id);let projects=[],current={},action='edit',readOnly=false;
function options(select,rows,placeholder,value,key='name'){
 select.replaceChildren(new Option(placeholder,''));
 for(const r of rows)select.add(new Option(r[key],String(key==='name'?r.name:r.id)));
 select.value=value==null?'':String(value);
}
function departments(){return PEProjectLookups.state.departments.filter(d=>readOnly||PEAccess.can('orders',action,d.name));}
function customers(){const s=PEProjectLookups.state,d=s.departments.find(d=>d.name===el('poe_department').value),ids=new Set(s.links.filter(l=>Number(l.department_id)===Number(d?.id)).map(l=>Number(l.customer_company_id)));return s.customers.filter(c=>ids.has(Number(c.id)));}
function fillProjects(allowCurrent=false){
 const dept=el('poe_department').value,customer=el('poe_company').value,old=el('poe_project').value||current.project_id;
 let rows=projects.filter(p=>p.company===customer&&p.department===dept);
 if(allowCurrent&&!rows.some(p=>Number(p.id)===Number(current.project_id))){const original=projects.find(p=>Number(p.id)===Number(current.project_id));if(original)rows=[...rows,original];}
 options(el('poe_project'),rows,'Select a project',rows.some(p=>String(p.id)===String(old))?old:rows.length===1?rows[0].id:'','project_name');
 global.PESearchableSelects?.refresh();
}
function departmentChanged(){
 const old=el('poe_company').value,rows=customers();options(el('poe_company'),rows,'Select an existing customer',rows.some(c=>c.name===old)?old:rows.length===1?rows[0].name:'');fillProjects();
 el('invoiceModalContent').dataset.accessDepartment=el('poe_department').value;
}
async function prepare(record={},operation='edit',viewOnly=false){
 current=record;action=operation;readOnly=viewOnly;const button=el('savePOButton');if(button)button.disabled=true;
 const [,r]=await Promise.all([PEProjectLookups.load(),supabaseClient.from('projects').select('id,project_name,company,department').order('project_name')]);if(r.error)throw r.error;projects=r.data||[];
 options(el('poe_department'),departments(),'Select a department',record.department||'');options(el('poe_company'),customers(),'Select an existing customer',record.company||'');
 fillProjects(true);el('poe_department').onchange=departmentChanged;el('poe_company').onchange=()=>fillProjects();
 for(const id of ['poe_department','poe_company','poe_project'])el(id).disabled=readOnly;
 if(button)button.disabled=readOnly;global.PESearchableSelects?.refresh();
}
function validate(){
 const s=PEProjectLookups.state,c=s.customers.find(c=>c.name===el('poe_company').value),d=s.departments.find(d=>d.name===el('poe_department').value),p=projects.find(p=>String(p.id)===el('poe_project').value);
 if(!c||!d||!p)return 'Choose the customer, department and project from their registered lists.';
 if(!s.links.some(l=>Number(l.customer_company_id)===Number(c.id)&&Number(l.department_id)===Number(d.id)))return 'The customer must be linked to the selected department.';
 const moved=current.company!==c.name||current.department!==d.name||Number(current.project_id)!==Number(p.id);
 if(moved&&(p.company!==c.name||p.department!==d.name))return 'Choose a project belonging to the selected customer and department.';
 return '';
}
global.PEOrderLookups={prepare,validate};
})(window);