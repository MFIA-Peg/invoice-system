(function(global){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Math.max(0,Number(v||0)),money=v=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(n(v));
  const colors={green:'#16a34a',orange:'#f59e0b',red:'#dc2626',blue:'#2563eb'};
  function chart(items,mode,title){
    const scale=mode==='parts'?items.reduce((sum,i)=>sum+n(i.value),0):Math.max(0,...items.map(i=>n(i.value)));
    let svg='<svg viewBox="0 0 160 160" role="img" aria-label="'+esc(title)+'"><title>'+esc(title)+' · '+items.map(i=>esc(i.label+': '+money(i.value))).join(' · ')+'</title>',offset=0;
    if(mode==='parts'){
      svg+='<circle cx="80" cy="80" r="57" fill="none" stroke="#e8eef5" stroke-width="20"/>';
      for(const i of items){const p=scale?n(i.value)/scale*100:0;if(p)svg+='<circle cx="80" cy="80" r="57" fill="none" stroke="'+i.color+'" stroke-width="20" pathLength="100" stroke-dasharray="'+p+' '+(100-p)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 80 80)"/>';offset+=p;}
    }else{
      items.forEach((i,index)=>{const r=63-index*17,p=scale?n(i.value)/scale*100:0;svg+='<circle cx="80" cy="80" r="'+r+'" fill="none" stroke="#e8eef5" stroke-width="11"/>';if(p)svg+='<circle cx="80" cy="80" r="'+r+'" fill="none" stroke="'+i.color+'" stroke-width="11" pathLength="100" stroke-dasharray="'+p+' '+(100-p)+'" transform="rotate(-90 80 80)"/>';});
    }
    return svg+'<text x="80" y="85" text-anchor="middle" fill="#475569" font-size="16" font-weight="700">SAR</text></svg>';
  }
  function kpis(s,rows=[],f={}){
    const t=s.totals,year=PEAnnual.year;
    const waiting=s.waiting||[],drafts=s.draft||[];
    const cards=[
      {title:'Purchase Order Invoicing Incl VAT',mode:'rings',note:'PO date cohort · Actual invoicing and unbilled balance; overbilling is shown in full.',items:[{label:'PO Invoiced Incl VAT',value:s.poInvoiced,color:colors.green},{label:'Remaining PO Value Incl VAT',value:s.remaining,color:colors.orange}]},
      {title:'Invoice Total & Settlement Incl VAT',mode:'rings',note:'Comparison only: Invoice Total is the control total; settlement is included in it. Allocated advance is shown separately in the reconciliation.',items:[{label:'Invoice Total Incl VAT',value:t.total,color:colors.blue},{label:'Settled Against Invoices',value:t.settled,color:colors.green},{label:'Advance Applied Incl VAT',value:t.advanceApplied,color:colors.orange}]},
      {title:'Remaining Invoice Balance Incl VAT',mode:'parts',note:'Separate components: not yet due + overdue + unreleased retention; no overlap.',items:[{label:'Not Yet Due',value:t.notDue,color:colors.blue},{label:'Overdue',value:t.overdue,color:colors.red},{label:'Retention',value:t.retention,color:colors.orange}]},
      {title:'Waiting For Approval & Draft Incl VAT',mode:'parts',note:'Outside issued invoice total · Invoice date · '+waiting.length+' awaiting approval / '+drafts.length+' draft',items:[{label:'Waiting For approval',value:t.pending,color:colors.orange,workflow:'waiting'},{label:'Draft',value:t.draft,color:colors.blue,workflow:'draft'}]}
    ];
    document.getElementById('kpis').innerHTML='<p class="pe-donut-period">'+year+' · All financial amounts include VAT · Invoice Total = settlement + allocated advance + not yet due + overdue + retention. Period cash receipts are a separate flow.</p>'+cards.map(card=>'<article class="pe-comparison-donut"><h3>'+esc(card.title)+'</h3>'+chart(card.items,card.mode,card.title)+'<div class="pe-donut-legend">'+card.items.map(i=>{
      const content='<span class="pe-donut-key"><i style="background:'+i.color+'"></i>'+esc(i.label)+'</span><strong>'+esc(money(i.value))+'</strong>';
      return i.workflow?'<button type="button" data-workflow="'+i.workflow+'">'+content+'</button>':'<div>'+content+'</div>';
    }).join('')+'</div><small>'+esc(card.note)+'</small></article>').join('');
    // The shared KPI filter binds every legend amount, including workflow totals.
  }
  global.PEDashboardDonuts={kpis,chart,colors};
})(window);


