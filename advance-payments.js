(function(global){
'use strict';
let client,onSaved,dialog,form,list,status,addButton,refreshButton,scopePoId=null,scopePaymentIds=null,scopeFrom='',scopeTo='',current=null,busy=false,request=0,records=[];
const str=v=>String(v??''),money=v=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
const orders=()=>global.PEAnnual?.records().orders||[];
const orderFor=row=>orders().find(p=>str(p.id)===str(row.po_id));
const allowed=(op,po)=>!!po&&!!global.PEAccess?.can('collections',op,po.department);
function element(tag,options={}){const e=document.createElement(tag);if(options.text!=null)e.textContent=options.text;if(options.className)e.className=options.className;return e;}
function icon(symbol,title,handler){const b=element('button',{text:symbol});b.type='button';b.title=title;b.setAttribute('aria-label',title);if(handler)b.onclick=handler;return b;}
function field(label,id,type='text'){const wrap=element('label',{className:'pe-advance-field'});wrap.append(element('span',{text:label}));const input=element(type==='select'?'select':type==='textarea'?'textarea':'input');if(input.tagName==='INPUT')input.type=type;input.id=id;wrap.append(input);return {wrap,input};}
function message(text,error=false){status.textContent=text;status.classList.toggle('pe-advance-error',error);}
function setBusy(value){busy=value;dialog.querySelectorAll('button').forEach(b=>b.disabled=value);form.querySelectorAll('input,textarea,select').forEach(n=>n.disabled=value);if(!value&&current)form.elements.po_id.disabled=true;global.PESearchableSelects?.refresh();}
function ensure(){
 if(dialog)return;
 const style=element('style');style.textContent='#peAdvancePayments{width:min(1050px,95vw);max-height:90vh;border:1px solid #cbd5e1;border-radius:12px;padding:18px;color:#172033}#peAdvancePayments::backdrop{background:#14263d80}.pe-advance-head,.pe-advance-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.pe-advance-head h2{margin:0;font-size:19px}.pe-advance-actions{justify-content:flex-end;flex-wrap:wrap}.pe-advance-actions button,#peAdvancePayments td button{min-width:28px;padding:4px 8px;border-radius:5px;cursor:pointer}.pe-advance-form{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;padding:12px 0}.pe-advance-form[hidden]{display:none}.pe-advance-field{display:grid;gap:4px;font-size:12px}.pe-advance-field input,.pe-advance-field select,.pe-advance-field textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font:14px Segoe UI,Arial}.pe-advance-field textarea{resize:vertical;min-height:55px}.pe-advance-table{overflow:auto;margin-top:10px}.pe-advance-table table{width:100%;min-width:690px;border-collapse:collapse;font-size:12px}.pe-advance-table th,.pe-advance-table td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left;white-space:normal}.pe-advance-table th{background:#14263d;color:white}.pe-advance-table .num{text-align:right;font-variant-numeric:tabular-nums}.pe-advance-error{color:#b42318}.pe-advance-note{font-size:12px;color:#64748b;margin:10px 0}.pe-advance-undated{color:#b45309;font-weight:600}@media(max-width:650px){.pe-advance-form{grid-template-columns:1fr 1fr}.pe-advance-field:first-child{grid-column:1/-1}}';document.head.append(style);
 dialog=element('dialog');dialog.id='peAdvancePayments';dialog.setAttribute('aria-labelledby','peAdvanceTitle');
 const heading=element('header',{className:'pe-advance-head'}),title=element('h2',{text:'Advance Payments'});title.id='peAdvanceTitle';
 const actions=element('div',{className:'pe-advance-actions'});addButton=icon('+','Add advance payment',()=>edit());refreshButton=icon('↻','Refresh advance payments',()=>load());const close=icon('×','Close advance payments',()=>{if(!busy)dialog.close();});actions.append(addButton,refreshButton,close);heading.append(title,actions);
 const note=element('p',{text:'Payment-date totals include dated advance payments only. Existing payments without dates remain visible for review.',className:'pe-advance-note'});
 status=element('p');status.id='peAdvanceStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 form=element('form',{className:'pe-advance-form'});form.hidden=true;
 const po=field('Purchase order *','peAdvancePO','select');po.input.name='po_id';po.input.required=true;po.input.setAttribute('aria-label','Purchase order');
 const date=field('Payment date *','peAdvanceDate','date');date.input.name='payment_date';date.input.required=true;
 const amount=field('Amount (SAR) *','peAdvanceAmount','number');amount.input.name='amount';amount.input.min='0.01';amount.input.step='0.01';amount.input.required=true;
 const reference=field('Reference','peAdvanceReference');reference.input.name='reference_no';const notes=field('Notes','peAdvanceNotes','textarea');notes.input.name='notes';
 const formActions=element('div',{className:'pe-advance-actions'});const saveButton=icon('✓','Save advance payment');saveButton.type='submit';formActions.append(saveButton,icon('×','Cancel advance payment entry',()=>{if(!busy){current=null;form.hidden=true;message('');}}));form.append(po.wrap,date.wrap,amount.wrap,reference.wrap,notes.wrap,formActions);form.onsubmit=save;
 list=element('div',{className:'pe-advance-table'});dialog.append(heading,note,status,form,list);document.body.append(dialog);
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('close',()=>{current=null;form.hidden=true;});
}
function draw(){
 const visible=records.filter(row=>(scopePoId==null||str(row.po_id)===str(scopePoId))&&(!scopePaymentIds||scopePaymentIds.has(str(row.id)))&&(!scopeFrom||row.payment_date&&row.payment_date>=scopeFrom)&&(!scopeTo||row.payment_date&&row.payment_date<=scopeTo));
 addButton.hidden=!orders().some(po=>(scopePoId==null||str(po.id)===str(scopePoId))&&allowed('add',po));
 const table=element('table'),head=element('thead'),hr=element('tr');for(const label of ['Purchase Order','Customer','Payment Date','Amount (SAR)','Reference','Notes','Actions'])hr.append(element('th',{text:label}));head.append(hr);table.append(head);const body=element('tbody');
 for(const row of visible){const po=orderFor(row),tr=element('tr');tr.dataset.advanceId=str(row.id);const fields=[po?.po_no||'Unavailable purchase order',po?.company||'—',row.payment_date||'Date required',money(row.amount),row.reference_no||'—',row.notes||'—'];for(const [idx,text]of fields.entries()){const td=element('td',{text});if(idx===3)td.className='num';if(idx===2&&!row.payment_date)td.className='pe-advance-undated';tr.append(td);}const td=element('td'),bar=element('div',{className:'pe-advance-actions'});if(allowed('edit',po))bar.append(icon('✎','Edit advance payment',()=>edit(row)));if(allowed('delete',po))bar.append(icon('⌫','Delete advance payment',()=>remove(row)));td.append(bar);tr.append(td);body.append(tr);}
 if(!visible.length){const tr=element('tr'),td=element('td',{text:'No advance payments match these filters.'});td.colSpan=7;tr.append(td);body.append(tr);}table.append(body);list.replaceChildren(table);
}
async function load(){
 if(!client){message('Advance payments are not connected yet.',true);return;}
 const token=++request;setBusy(true);message('Loading advance payments…');list.replaceChildren(element('p',{text:'Loading advance payments…'}));
 try{const loaded=[];for(let from=0;;from+=1000){let q=client.from('po_advance_payments').select('*').order('id',{ascending:false}).range(from,from+999);if(scopePoId!=null)q=q.eq('po_id',scopePoId);const r=await q;if(r.error)throw r.error;loaded.push(...(r.data||[]));if(!r.data||r.data.length<1000)break;if(from>=100000)throw Error('Advance payment record limit exceeded.');}if(token!==request)return;records=loaded;draw();message('');}
 catch(error){if(token===request){list.replaceChildren();message(error.message||'Unable to load advance payments.',true);}}
 finally{if(token===request)setBusy(false);}
}
function edit(row=null){
 if(busy)return;const po=row&&orderFor(row);if(row&&!allowed('edit',po))return;
 current=row;form.reset();const select=form.elements.po_id;select.replaceChildren(new Option('Select purchase order',''));
 const candidates=row?orders().filter(p=>str(p.id)===str(row.po_id)):orders().filter(p=>(scopePoId==null||str(p.id)===str(scopePoId))&&allowed('add',p));
 for(const p of candidates)select.add(new Option([p.po_no,p.company,p.project_name].filter(Boolean).join(' · '),str(p.id)));
 select.value=row?str(row.po_id):scopePoId!=null?str(scopePoId):'';select.disabled=!!row;
 form.elements.payment_date.value=row?.payment_date||'';form.elements.amount.value=row?.amount??'';form.elements.reference_no.value=row?.reference_no||'';form.elements.notes.value=row?.notes||'';
 form.hidden=false;message(row&&!row.payment_date?'Enter the actual payment date for this existing advance.':'');global.PESearchableSelects?.refresh();form.elements.payment_date.focus();
}
function expected(q,row){q=q.eq('id',row.id).eq('amount',row.amount);return row.payment_date?q.eq('payment_date',row.payment_date):q.is('payment_date',null);}
async function save(event){
 event.preventDefault();if(busy||!client)return;
 const row=current,po=orders().find(p=>str(p.id)===form.elements.po_id.value);if(!allowed(row?'edit':'add',po)){message('You do not have permission for this purchase order.',true);return;}
 const paymentDate=form.elements.payment_date.value,amount=Number(form.elements.amount.value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)||!Number.isFinite(amount)||amount<=0){message('Enter an actual payment date and a positive amount.',true);return;}
 const payload={payment_date:paymentDate,amount,reference_no:form.elements.reference_no.value.trim()||null,notes:form.elements.notes.value.trim()||null};
 setBusy(true);message('Saving advance payment…');
 try{let q;if(row)q=expected(client.from('po_advance_payments').update(payload),row);else q=client.from('po_advance_payments').insert({...payload,po_id:po.id});const result=await q.select('id');if(result.error)throw result.error;if(result.data?.length!==1)throw Error('The payment changed or is no longer accessible. Refresh and try again.');current=null;form.hidden=true;await refreshSaved();message('Advance payment saved.');}
 catch(error){message(error.message||'Unable to save the advance payment.',true);}
 finally{setBusy(false);}
}
async function remove(row){
 if(busy||!client||!allowed('delete',orderFor(row)))return;
 if(!global.confirm('Delete this advance payment of '+money(row.amount)+'?'))return;
 setBusy(true);message('Deleting advance payment…');
 try{const result=await expected(client.from('po_advance_payments').delete(),row).select('id');if(result.error)throw result.error;if(result.data?.length!==1)throw Error('The payment changed or is no longer accessible. Refresh and try again.');if(current?.id===row.id){current=null;form.hidden=true;}await refreshSaved();message('Advance payment deleted.');}
 catch(error){message(error.message||'Unable to delete the advance payment.',true);}
 finally{setBusy(false);}
}
async function refreshSaved(){
 if(onSaved)await onSaved();else await global.PEAnnual?.load(client);
 // Reload through the same RLS-bound client so receipt dates and synchronized
 // PO amounts reflect the committed transaction, including deletions.
 await load();
}
async function open(options={}){
 ensure();if(global.PEPopups?.isMinimized(dialog)){global.PEPopups.restore(dialog);return;}if(busy)return;scopePoId=options.poId??null;scopePaymentIds=Array.isArray(options.paymentIds)?new Set(options.paymentIds.map(str)):null;scopeFrom=options.from||'';scopeTo=options.to||'';current=null;form.hidden=true;
 if(!dialog.open)dialog.showModal();
 await load();
}
function setClient(value,saved){client=value;onSaved=typeof saved==='function'?saved:null;}
function mount(target,options={}){const host=typeof target==='string'?document.querySelector(target):target;if(!host)return null;const b=icon('¤','Advance payments',()=>open(options));b.className='pe-icon-action';host.append(b);return b;}
global.PEAdvancePayments={setClient,open,mount};
})(window);
