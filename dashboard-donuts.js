(function(global){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v||0),money=v=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(n(v));
  function ring(value,denominator,color,label,center){
    const percent=denominator>0?Math.min(100,Math.max(0,n(value)/denominator*100)):0;
    return '<svg viewBox="0 0 100 100" role="img" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title><circle cx="50" cy="50" r="37" fill="none" stroke="#e8eef5" stroke-width="10"/>'+(percent>0?'<circle cx="50" cy="50" r="37" fill="none" stroke="'+color+'" stroke-width="10" pathLength="100" stroke-dasharray="'+percent+' '+(100-percent)+'" transform="rotate(-90 50 50)"/>':'')+'<text x="50" y="55" text-anchor="middle" fill="#14263d" font-size="16" font-weight="700">'+esc(center)+'</text></svg>';
  }
  function kpis(s){
    const t=s.totals,base=n(t.total),cards=[
      ['Invoice Value Ex VAT',t.net,'#2563eb',base,'Invoice due date'],['VAT',t.vat,'#64748b',base,'Invoice due date'],
      ['Invoice Total',t.total,'#0f766e',null,'Invoice due date'],['Collected',t.collected,'#0891b2',null,'Payment date'],
      ['Open Balance',t.balance,'#d97706',base,'Invoice due date'],['Overdue',t.overdue,'#dc2626',base,'Invoice due date'],
      ['Pending Approval',t.pending,'#7c3aed',null,'Invoice date · awaiting approval'],['Retention',t.retention,'#b45309',base,'Invoice due date']
    ];
    document.getElementById('kpis').innerHTML='<p class="pe-donut-period">'+PEAnnual.year+' · Invoices by due date · Collections by payment date</p>'+cards.map(([label,value,color,denominator,basis])=>{
      const hasRatio=denominator!==null,ratio=hasRatio&&denominator>0?Math.min(100,Math.max(0,n(value)/denominator*100)):0;
      const center=hasRatio?(denominator>0?ratio.toFixed(1)+'%':'—'):'SAR';
      return '<article class="pe-donut-kpi"><div class="pe-donut-caption">'+esc(label)+'</div>'+ring(value,hasRatio?denominator:n(value),color,label+': '+money(value)+(hasRatio?' · share of current-year invoice total':''),center)+'<strong class="pe-donut-value">'+esc(money(value))+'</strong><small>'+PEAnnual.year+' · '+esc(basis)+'</small><small class="pe-donut-basis">'+(hasRatio?'Share of invoiced total':'Period total · no percentage')+'</small></article>';
    }).join('');
  }
  function workflow(rows,f){
    const host=document.getElementById('invoiceWorkflowCharts');if(!host)return;
    const base=rows.filter(r=>!r.cancelled&&PEDashboard.matches(r,f,{period:!!(f.from||f.to),attention:false}));
    const specs=[['draft','Draft invoices','#d97706',r=>r.draft],['waiting','Awaiting approval','#7c3aed',r=>r.waiting]];
    host.innerHTML=specs.map(([key,label,color,match])=>{
      const group=base.filter(match),total=group.reduce((sum,r)=>sum+r.m.total,0);
      return '<button type="button" class="pe-workflow-donut" data-workflow="'+key+'" aria-label="Show '+label+'"><span><strong>'+label+'</strong><small>'+group.length+' of '+base.length+' matching invoices</small><b>'+esc(money(total))+'</b></span>'+ring(group.length,base.length,color,label+': '+group.length+' of '+base.length+' invoices',String(group.length))+'</button>';
    }).join('');
    host.querySelectorAll('[data-workflow]').forEach(b=>b.addEventListener('click',()=>PEDashboard.selectWorkflow(b.dataset.workflow)));
    document.getElementById('workflowChartNote').textContent=(f.from||f.to?'Selected period':'All years, including unresolved historical invoices')+' · Rings show invoice-count share; amounts include VAT. Drafts include future recorded invoice dates.';
  }
  global.PEDashboardDonuts={kpis,workflow,ring};
})(window);

