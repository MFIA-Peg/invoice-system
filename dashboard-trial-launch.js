(function(global){
'use strict';
const key='peDashboardClassicSnapshotV1',fields={company:'company',department:'department',project:'project',invoiceStatus:'invoiceStatus',paymentStatus:'paymentStatus',from:'fromDate',to:'toDate',dueFrom:'dueFromDate',dueTo:'dueToDate'};
const link=document.getElementById('trySummaryDashboard');if(link)link.addEventListener('click',()=>{try{const filters=PETrialContext.clean(global.PEDashboard?.filters?.()||{}),saved={filters,metric:global.PEKPIFilter?.active()?.label||'',scroll:scrollY};sessionStorage.setItem(key,JSON.stringify(saved));sessionStorage.setItem('peDashboardBeforeTrialFiltersV1',JSON.stringify(filters));link.href=PETrialContext.trialUrl(filters);}catch(e){link.href='dashboard-trial.html';}});
if(!new URLSearchParams(location.search).has('restore_trial'))return;
let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');if(!saved)return;saved.filters=PETrialContext.clean(saved.filters);}catch{return;}
let restored=false;const render=global.renderKPIs;
global.renderKPIs=function(...args){if(restored||!PEAnnual.records().loaded)return render.apply(this,args);restored=true;render.apply(this,args);for(const [key,id]of Object.entries(fields)){const el=document.getElementById(id),value=saved.filters[key];if(el.tagName==='SELECT'&&!Array.from(el.options).some(o=>o.value===value))el.add(new Option(value,value));el.value=value;}PEKPIFilter.set(saved.metric,'dashboard',false);render.call(this);if(saved.filters.attention)document.querySelector('[data-attention="'+saved.filters.attention+'"]')?.click();global.PESearchableSelects?.refresh();requestAnimationFrame(()=>scrollTo(0,Number(saved.scroll)||0));};
if(PEAnnual.records().loaded)global.renderKPIs();
})(window);
