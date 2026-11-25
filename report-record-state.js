/* Report record state follows invoice workflow, independently of payment balance. */
(function(global){
 'use strict';
 const query=new URLSearchParams(location.search),requested=query.get('record_state')||query.get('view');
 let state=requested==='closed'?'closed':'open',explicit=requested==='open'||requested==='closed',contextChosen=false,source,orderSource,ordersById,projectsById;
 function completed(invoice){return /^(completed|competed|complete|paid|fully paid|bad debits?)$/i.test(String(invoice?.status||'').trim());}
 function matches(invoice){return completed(invoice)===(state==='closed');}
 function index(){const data=global.PEAnnual?.records();if(!data)return;if(source===data.invoices&&orderSource===data.orders)return;source=data.invoices;orderSource=data.orders;ordersById=new Map();projectsById=new Map();
  for(const invoice of data.invoices){const order=global.PEAnnual.orderFor(invoice),project=order?.project_id??invoice.project_id;for(const [map,key]of [[ordersById,order?.id],[projectsById,project]]){if(key==null)continue;const count=map.get(String(key))||{open:0,closed:0};count[completed(invoice)?'closed':'open']++;map.set(String(key),count);}}
 }
 function parentMatches(map,id){const count=map?.get(String(id));return count?count[state]>0:state==='open';}
 function orderMatches(order){index();return parentMatches(ordersById,order.id);}
 function projectMatches(project){index();return parentMatches(projectsById,project.id);}
 function sync(){document.querySelectorAll('[data-record-state]').forEach(button=>{const selected=button.dataset.recordState===state;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});}
 function choose(value,notify=true){if(!['open','closed'].includes(value))return;state=value;explicit=true;const url=new URL(location.href);url.searchParams.set('record_state',value);history.replaceState(null,'',url);sync();if(notify)document.dispatchEvent(new Event('pe-report-record-state'));}
 function chooseContext(invoices){if(explicit||contextChosen)return;contextChosen=true;if(invoices.length&&invoices.every(completed)){state='closed';sync();}}
 function mount(){const tabs=document.querySelector('.report-control-dock .tabs');if(!tabs)return;const group=document.createElement('div');group.className='report-record-state';group.setAttribute('role','group');group.setAttribute('aria-label','Invoice record state');for(const [key,label]of [['open','Open'],['closed','Closed']]){const button=document.createElement('button');button.type='button';button.dataset.recordState=key;button.textContent=label;button.title=key==='closed'?'Invoice status: Completed or Bad Debits':'Invoice status: neither Completed nor Bad Debits';button.onclick=()=>choose(key);group.append(button);}tabs.append(group);sync();
  document.addEventListener('pe-report-record-state',()=>global.applyFilters?.());
  const note=document.querySelector('.report-summary-panel>.muted');if(note)note.textContent=note.textContent.replace('Totals include open and closed records.','Totals follow the selected Open / Closed invoice state.');
 }
 global.PEReportState={completed,matches,orderMatches,projectMatches,chooseContext,choose,get value(){return state;}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(window);
