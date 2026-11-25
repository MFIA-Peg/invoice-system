/* Existing invoice follow-ups and a compact linked-invoice summary for POs. */
(function(global){
  'use strict';
  let client,dialog,host,heading,form,input,status,saveButton,backButton,closeButton,paymentsButton,request=0,currentInvoice=null,originPO=null,saving=false;
  const drafts=new Map();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function timestamp(value){
    if(!value)return 'Undated';
    const raw=String(value),date=new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)?raw:raw+'Z');
    return Number.isFinite(+date)?new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)+' · Riyadh':raw;
  }
  function mount(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='reportComments';dialog.setAttribute('aria-labelledby','reportCommentsTitle');
    dialog.innerHTML='<header class="report-comments-heading"><h2 id="reportCommentsTitle"></h2><button type="button" class="report-icon-button" title="Close comments" aria-label="Close comments"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div id="reportCommentsContent" aria-live="polite"></div>';
    document.body.append(dialog);host=dialog.querySelector('#reportCommentsContent');heading=dialog.querySelector('h2');closeButton=dialog.querySelector('button');closeButton.onclick=()=>{if(!saving)dialog.close();};dialog.addEventListener('close',()=>{remember();request++;});
    backButton=document.createElement('button');backButton.type='button';backButton.className='report-icon-button';backButton.title='Back to purchase order';backButton.setAttribute('aria-label',backButton.title);backButton.textContent='←';backButton.hidden=true;backButton.onclick=()=>{remember();open('po',originPO.id,originPO.label);};heading.before(backButton);
    paymentsButton=document.createElement('button');paymentsButton.type='button';paymentsButton.className='report-icon-button';paymentsButton.title='Received Payments';paymentsButton.setAttribute('aria-label',paymentsButton.title);paymentsButton.hidden=true;paymentsButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>';paymentsButton.onclick=()=>{if(currentInvoice&&!saving)global.PEEntry.payments(currentInvoice);};closeButton.before(paymentsButton);
    form=document.createElement('form');form.id='reportCommentForm';form.hidden=true;form.innerHTML='<label for="reportNewComment">New comment</label><textarea id="reportNewComment" rows="3" placeholder="Write a new comment…" required></textarea><div class="report-comment-tools"><span id="reportCommentStatus" role="status" aria-live="polite"></span><button type="submit" class="report-icon-button" title="Save comment" aria-label="Save comment"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8"/></svg></button></div>';
    host.before(form);input=form.querySelector('textarea');status=form.querySelector('[role=status]');saveButton=form.querySelector('button');input.oninput=remember;form.onsubmit=save;
  }
  function remember(){if(currentInvoice&&input)drafts.set(String(currentInvoice.id),input.value);}
  async function save(event){
    event.preventDefault();if(saving||!currentInvoice)return;
    const note=input.value.trim(),invoice=currentInvoice;if(!note)return;
    saving=true;input.disabled=saveButton.disabled=closeButton.disabled=backButton.disabled=true;status.textContent='Saving…';
    try{
      const department=global.PEAnnual.orderFor(invoice)?.department||invoice.department;
      await global.PEAccess.require(client,'invoices','add',department);
      const {data,error}=await client.from('invoice_followups').insert({invoice_no:invoice.invoice_no,followup_note:note,followup_by:sessionStorage.getItem('pe_full_name')||sessionStorage.getItem('pe_username')||'User'}).select('id,invoice_no,followup_date,followup_note,followup_by').single();
      if(error)throw error;if(!data)throw Error('The saved comment was not returned.');
      input.value='';drafts.delete(String(invoice.id));const article=document.createElement('div');article.innerHTML=entry(data);if(!host.querySelector('.report-comment'))host.replaceChildren();host.prepend(article.firstElementChild);status.textContent='Saved · '+timestamp(data.followup_date);
    }catch(error){status.textContent='Not saved: '+(error.message||error)+'. Your text is still here.';remember();}
    finally{saving=false;input.disabled=saveButton.disabled=closeButton.disabled=backButton.disabled=false;}
  }
  function entry(c){return '<article class="report-comment"><header><strong>'+esc(timestamp(c.followup_date))+'</strong><span>'+esc(c.followup_by||'—')+'</span></header><p>'+esc(c.followup_note||'No comment text')+'</p>'+(c.collection_action?'<p>Collection action: '+esc(c.collection_action)+'</p>':'')+(c.next_followup_date?'<p>Next follow-up: '+esc(c.next_followup_date)+'</p>':'')+(c.promised_payment_date?'<p>Promised payment: '+esc(c.promised_payment_date)+'</p>':'')+'</article>';}
  function purchaseOrder(records,id,label){
    const A=global.PEAnnual,order=records.orders.find(p=>String(p.id)===id);if(!order)throw Error('The purchase order is not available.');
    const invoices=records.invoices.filter(i=>String(A.orderFor(i)?.id)===id);
    const money=v=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0)),date=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(5,7)+'/'+s.slice(8,10)+'/'+s.slice(0,4):'—';};
    const rows=invoices.map(i=>{const m=A.metrics(i,order);return '<tr><td><button type="button" class="report-history-link" data-report-comments="invoice" data-record-id="'+esc(i.id)+'" data-record-label="'+esc(i.invoice_no)+'" data-related-po="'+esc(id)+'">'+esc(i.invoice_no||'—')+'</button></td><td>'+esc(date(i.start_date))+'</td><td>'+esc(date(A.due(i)))+'</td><td class="num">'+money(m.total)+'</td><td class="num">'+money(m.collected)+'</td><td class="num">'+money(m.balance)+'</td><td>'+esc(i.status||'—')+'</td><td>'+esc(m.paymentStatus|| (m.balance<=.005?'Paid':m.collected>.005?'Partially Paid':'Unpaid'))+'</td></tr>';});
    const table=global.PEReportTotals.render(['Invoice No.','Invoice Date','Due Date','Invoice Total Incl VAT','Collected Incl VAT','Open Balance','Invoice Status','Payment Status'],rows);
    heading.textContent='Purchase Order — '+label;host.innerHTML='<div class="report-po-meta"><span><strong>Department</strong>'+esc(order.department||'—')+'</span><span><strong>ERP Code</strong>'+esc(order.erp_code||'—')+'</span><span><strong>Invoices</strong>'+invoices.length+'</span></div><p class="report-comments-note">All linked invoices accessible to your account. Select an invoice number for its historical comments.</p><div class="report-po-table">'+table+'</div>';
  }
  async function open(kind,id,label,fromPO=null){
    if(saving)return;mount();remember();originPO=fromPO;currentInvoice=null;form.hidden=paymentsButton.hidden=true;backButton.hidden=!originPO;dialog.classList.toggle('report-po-summary',kind==='po');const token=++request;heading.textContent=(kind==='invoice'?'Invoice comments — ':'Purchase Order — ')+label;host.textContent='Loading…';
    if(global.PEPopups?.isMinimized(dialog))global.PEPopups.restore(dialog);else if(!dialog.open)dialog.showModal();
    try{
      if(!client)throw Error('The report connection is not ready.');
      const A=global.PEAnnual,records=A.records();
      if(kind==='po'){purchaseOrder(records,id,label);return;}
      let invoices;
      if(kind==='invoice')invoices=records.invoices.filter(i=>String(i.id)===id);
      else throw Error('Unsupported comment item.');
      const numbers=[...new Set(invoices.map(i=>String(i.invoice_no||'')).filter(value=>value.trim()))];
      if(!numbers.length){host.textContent='No numbered invoices are linked to this item.';return;}
      currentInvoice=invoices[0];const department=A.orderFor(currentInvoice)?.department||currentInvoice.department;
      paymentsButton.hidden=!global.PEAccess.can('collections','view');
      form.hidden=!global.PEAccess.can('invoices','add',department);input.value=drafts.get(String(currentInvoice.id))||'';input.disabled=saveButton.disabled=true;status.textContent='The date and time are recorded when the comment is saved.';
      const comments=[];
      for(let at=0;at<numbers.length;at+=100){
        const chunk=numbers.slice(at,at+100);
        for(let offset=0;;offset+=1000){
          const {data,error}=await client.from('invoice_followups').select('id,invoice_no,followup_date,followup_note,next_followup_date,followup_by,collection_action,promised_payment_date').in('invoice_no',chunk).order('followup_date',{ascending:false,nullsFirst:false}).order('id',{ascending:false}).range(offset,offset+999);
          if(token!==request)return;if(error)throw error;comments.push(...(data||[]));if(!data||data.length<1000)break;
        }
      }
      if(token!==request)return;
      comments.sort((a,b)=>String(b.followup_date||'').localeCompare(String(a.followup_date||''))||Number(b.id)-Number(a.id));
      host.innerHTML=comments.length?comments.map(entry).join(''):'<p>No historical comments are recorded for this invoice.</p>';
      input.disabled=saveButton.disabled=false;
    }catch(error){if(token===request){host.textContent='Unable to load historical comments: '+(error.message||error);input.disabled=saveButton.disabled=false;}}
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-report-comments]');if(button)open(button.dataset.reportComments,button.dataset.recordId,button.dataset.recordLabel,button.dataset.relatedPo?{id:button.dataset.relatedPo,label:global.PEAnnual.records().orders.find(p=>String(p.id)===button.dataset.relatedPo)?.po_no||''}:null);});
  global.addEventListener('beforeunload',event=>{if(saving||[...drafts.values()].some(value=>value.trim())){event.preventDefault();event.returnValue='';}});
  global.PEReportComments={setClient:value=>{client=value;},open};
})(window);
