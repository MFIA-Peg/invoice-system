(function(global){
'use strict';let orders=[],requestVersion=0;
const el=id=>document.getElementById(id),str=v=>String(v??'');
async function prepare(selected={}){
 const version=++requestVersion;
 const save=document.querySelector('#invoiceModalContent button[onclick="saveNewInvoice()"]');if(save)save.disabled=true;
 const box=document.querySelector('#invoiceModalContent .invoice-fields');if(!box)return;
 const group=document.createElement('div');group.id='invoiceEntryChoices';group.className='invoice-entry-choices';group.innerHTML='<div class="invoice-field"><label for="entryInvoiceDepartment">Department</label><select id="entryInvoiceDepartment"></select></div><div class="invoice-field"><label for="entryInvoiceCustomer">Customer</label><select id="entryInvoiceCustomer"></select></div><div class="invoice-field"><label for="entryInvoiceProject">Project</label><select id="entryInvoiceProject"></select></div><div class="invoice-field"><label for="entryInvoicePO">Purchase Order *</label><select id="entryInvoicePO" required></select></div>';box.before(group);
 const {data,error}=await supabaseClient.from('pos').select('*').order('po_no');if(error)throw error;if(version!==requestVersion)return;
 orders=(data||[]).filter(p=>p.project_id&&!p.archive&&!/^(closed|cancelled|canceled)$/i.test(p.status||'')&&PEAccess.can('invoices','add',p.department));
 const populate=(id,rows,placeholder,current='',key=null)=>{const node=el(id);node.replaceChildren(new Option(placeholder,''));for(const row of rows)node.add(new Option(key?row[key]:row,key?str(row.id):str(row)));node.value=str(current);};
 const unique=rows=>[...new Set(rows.filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 populate('entryInvoiceDepartment',unique(orders.map(p=>p.department)),'All departments',selected.department);
 populate('entryInvoiceCustomer',unique(orders.map(p=>p.company)),'All customers',selected.company);
 function refresh(){const dept=el('entryInvoiceDepartment').value,customer=el('entryInvoiceCustomer').value;const matching=orders.filter(p=>(!dept||p.department===dept)&&(!customer||p.company===customer));const old=el('entryInvoiceProject').value||str(selected.project_id);const projects=[...new Map(matching.map(p=>[str(p.project_id),{id:p.project_id,project_name:p.project_name}])).values()];populate('entryInvoiceProject',projects,'All projects',projects.some(p=>str(p.id)===old)?old:'','project_name');refreshOrders();}
 function refreshOrders(){const dept=el('entryInvoiceDepartment').value,customer=el('entryInvoiceCustomer').value,project=el('entryInvoiceProject').value;const matching=orders.filter(p=>(!dept||p.department===dept)&&(!customer||p.company===customer)&&(!project||str(p.project_id)===project));const old=el('entryInvoicePO').value||str(selected.id);populate('entryInvoicePO',matching,'Select purchase order',matching.some(p=>str(p.id)===old)?old:'','po_no');apply().catch(error=>alert('Could not load purchase order: '+error.message));global.PESearchableSelects?.refresh();}
 async function apply(){const selection=++requestVersion;const po=orders.find(p=>str(p.id)===el('entryInvoicePO').value);if(save)save.disabled=true;if(!po){currentInvoicePoNo=null;currentProjectId=null;window.currentPOForInvoice={};window.currentAdvanceAvailable=0;currentInvoiceVat=false;updateNewInvoiceTotals();return;}
  currentInvoicePoNo=po.po_no;currentProjectId=po.project_id;currentInvoiceVat=po.vat===true;window.currentPOForInvoice=po;
  const availability=await getAdvanceAvailability(po);if(selection!==requestVersion)return;window.currentAdvanceAvailable=availability.available;
  document.getElementById('invoiceModalContent').dataset.accessDepartment=po.department||'';
  updateNewInvoiceTotals();if(save)save.disabled=false;
 }
 el('entryInvoiceDepartment').onchange=refresh;el('entryInvoiceCustomer').onchange=refresh;el('entryInvoiceProject').onchange=refreshOrders;el('entryInvoicePO').onchange=()=>apply().catch(error=>alert(error.message));refresh();
}
global.PEInvoiceEntry={prepare};
})(window);