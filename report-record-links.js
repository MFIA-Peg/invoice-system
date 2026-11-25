/* Open existing report records without losing the report's filters or position. */
(function(global){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function link(kind,row,label){
    if(!row||!label)return esc(label||'—');
    const module={invoice:'invoices',po:'orders',project:'projects',customer:'customers'}[kind];
    if(!module||!global.PEAccess?.can(module,'view'))return esc(label);
    const edit=global.PEAccess.can(module,'edit',row.department),params=new URLSearchParams({embedded:'1'});
    if(kind==='project'){if(row.id==null)return esc(label);params.set('project_action',edit?'edit':'open');params.set('project_id',row.id);}
    else{params.set('record',kind);params.set('edit',edit?'1':'0');if(kind==='customer')params.set('customer_name',row.name||label);else if(row.id!=null)params.set('id',row.id);else return esc(label);}
    const href='companies.html?'+esc(params.toString());
    if(['invoice','po'].includes(kind)){
      const comments='<button type="button" class="report-history-link" data-report-comments="'+kind+'" data-record-id="'+esc(row.id)+'" data-record-label="'+esc(label)+'" title="'+esc((kind==='po'?'Linked invoices: ':'Historical comments: ')+label)+'">'+esc(label)+'</button>';
      const pencil='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4"/></svg>';
      return '<span class="report-record-actions">'+comments+(edit?'<a class="report-record-link report-edit-link" data-report-record="'+kind+'" href="'+href+'" title="'+esc('Edit '+label)+'" aria-label="'+esc('Edit '+label)+'">'+pencil+'</a>':'')+'</span>';
    }
    return '<a class="report-record-link" data-report-record="'+kind+'" href="'+href+'" title="'+esc((edit?'Edit ':'View ')+label)+'">'+esc(label)+'</a>';
  }
  document.addEventListener('click',event=>{
    const a=event.target.closest('a.report-record-link');if(!a||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!global.PEEntry?.edit)return;
    event.preventDefault();global.PEEntry.edit(new URL(a.href,location.href));
  });
  global.PEReportRecord={link};
})(window);
