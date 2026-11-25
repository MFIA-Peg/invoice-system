(function(global){
'use strict';
const selector='dialog,#overlay,.modal-backdrop,#projectModal,#invoiceModal,#closedModal,#dashboardDetailModal,#cmDialog';
const states=new Map();let dock;
const embedded=new URLSearchParams(location.search).get('embedded')==='1'&&parent!==global;
function title(el){return el.querySelector('h2,h3,strong')?.textContent.trim()||el.getAttribute('aria-label')||'Window';}
function visible(el){return el.tagName==='DIALOG'?el.open:getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';}
function restore(el){
 const state=states.get(el);if(!state)return;
 state.button.remove();states.delete(el);el.classList.remove('pe-popup-minimized');
 if(el.tagName==='DIALOG'&&!el.open)el.showModal();
 document.body.style.overflow=state.overflow;
 if(state.focus?.isConnected)state.focus.focus();else el.querySelector('input,textarea,select,button')?.focus();
}
function dismiss(el){const state=states.get(el);if(!state)return;state.button.remove();states.delete(el);el.classList.remove('pe-popup-minimized');}
function minimize(el){
 if(!el||states.has(el)||!visible(el))return;
 if(embedded){parent.postMessage({type:'pe-entry-minimize'},location.origin);return;}
 if(!dock){dock=document.createElement('nav');dock.className='pe-popup-dock';dock.setAttribute('aria-label','Minimized windows');document.body.append(dock);}
 const button=document.createElement('button');button.type='button';button.textContent='▣';button.title='Restore: '+title(el);button.onclick=()=>restore(el);dock.append(button);
 states.set(el,{button,focus:document.activeElement,overflow:document.body.style.overflow,openClass:el.classList.contains('open')});
 el.classList.add('pe-popup-minimized');
 // Closing only releases the native modal's top layer. Keep its DOM, iframe,
 // drafts and event state intact; suppress close cleanup until real dismissal.
 if(el.tagName==='DIALOG')el.close();
 document.body.style.overflow='';button.focus();
}
document.addEventListener('close',event=>{if(states.has(event.target))event.stopImmediatePropagation();},true);
document.addEventListener('click',event=>{
 const el=event.target.closest?.(selector);if(!el||states.has(el))return;
 if(event.target!==el)return;
 if(el.tagName==='DIALOG'){
  const r=el.getBoundingClientRect();if(event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom)return;
 }
 event.preventDefault();event.stopImmediatePropagation();minimize(el);
},true);
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 const el=[...document.querySelectorAll(selector)].reverse().find(el=>!states.has(el)&&visible(el));
 if(!el)return;event.preventDefault();event.stopImmediatePropagation();minimize(el);
},true);
document.addEventListener('cancel',event=>{if(event.target.matches?.(selector)){event.preventDefault();event.stopImmediatePropagation();minimize(event.target);}},true);
function enhance(){
 for(const [el,state] of states){if(!el.isConnected||el.tagName!=='DIALOG'&&(el.style.display==='none'||state.openClass&&!el.classList.contains('open')))dismiss(el);}
 for(const el of document.querySelectorAll(selector)){
  const panel=el.tagName==='DIALOG'?el:el.querySelector(':scope>.modal,:scope>[role="dialog"],:scope>.cm-dialog-box,:scope>div,:scope>section');
  if(!panel||panel.querySelector(':scope>.pe-popup-minimize'))continue;
  const b=document.createElement('button');b.type='button';b.className='pe-popup-minimize';b.textContent='−';b.title='Minimize';b.setAttribute('aria-label','Minimize');b.onclick=e=>{e.stopPropagation();minimize(el);};panel.prepend(b);
 }
}
function mount(){
 const style=document.createElement('style');style.textContent='.pe-popup-minimized{display:none!important}.pe-popup-dock{position:fixed;z-index:2147483647;bottom:12px;inset-inline-end:12px;display:flex;gap:8px;flex-wrap:wrap;max-width:calc(100vw - 24px);pointer-events:none}.pe-popup-dock>button{pointer-events:auto;background:#14263d;color:#fff;border:1px solid #64748b;border-radius:8px;padding:9px 14px;box-shadow:0 3px 14px #0003;font:13px Segoe UI,Arial;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.pe-popup-minimize{float:inline-end;position:relative;z-index:2;min-width:30px;margin:0 6px 4px;padding:2px 8px;border:1px solid #cbd5e1;border-radius:5px;background:#f1f5f9;color:#14263d;font:20px/1.2 Arial;cursor:pointer}';document.head.append(style);
 const observer=new MutationObserver(enhance);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','open']});enhance();
}
global.PEPopups={minimize,restore,dismiss,isMinimized:el=>states.has(el)};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(window);
(function(global){
'use strict';let dialog,frame,active,loading,timer,prefetchTimer,generation,userKey,lastTiming=null;
const embedded=new URLSearchParams(location.search).get('embedded')==='1'&&parent!==global,pool=new Map(),ttl=10000,maxCached=2;
function urlFor(kind,context={}){const p=new URLSearchParams({create:kind,embedded:'1'});for(const key of ['project_id','po_id','po_no'])if(context[key]!=null&&context[key]!=='')p.set(key,context[key]);return new URL('companies.html?'+p,location.href);}
function valid(url){url=new URL(url,location.href);if(url.origin!==location.origin||!url.pathname.endsWith('/companies.html'))return null;const p=url.searchParams,kind=p.get('record')||(p.has('project_action')?'project':p.get('create'));if(!['invoice','po','project','customer','purchase-order'].includes(kind))return null;p.set('embedded','1');return url;}
function ready(entry){try{const doc=entry.frame.contentDocument;if(!doc||doc.documentElement.classList.contains('record-loading')||doc.body.classList.contains('pe-access-denied'))return false;if(new URL(entry.url).searchParams.has('payments_invoice'))return !!doc.getElementById('receivedPayments')?.open&&!/Loading payments/.test(doc.getElementById('receivedPaymentsContent')?.textContent||'');return !!doc.querySelector('#invoiceModalContent .invoice-fields,#projectModal input,#cmField');}catch{return false;}}
function readonly(entry){try{const url=new URL(entry.url),p=url.searchParams;if(!['invoice','po'].includes(p.get('record'))||p.get('edit')==='1'||p.has('view')||!ready(entry))return false;return [...entry.frame.contentDocument.querySelectorAll('#invoiceModalContent input,#invoiceModalContent select,#invoiceModalContent textarea')].every(e=>e.disabled||e.readOnly);}catch{return false;}}
function remove(entry){entry.frame.src='about:blank';entry.frame.remove();}
function invalidate(){for(const entry of pool.values())remove(entry);pool.clear();}
function checkGeneration(){const next=global.PEAnnual?.records(),key=String(global.PEAccess?.state?.user_id||sessionStorage.getItem('pe_username')||'');if(generation!==next||userKey!==key){invalidate();generation=next;userKey=key;}for(const [key,entry]of pool)if(performance.now()-entry.created>ttl){pool.delete(key);remove(entry);}}
function trim(){while(pool.size>maxCached){const key=pool.keys().next().value,entry=pool.get(key);pool.delete(key);remove(entry);}}
function acquire(url){checkGeneration();url.searchParams.sort();const key=url.href;let entry=pool.get(key),reused=!!entry;if(entry)pool.delete(key);else{mount();const f=document.createElement('iframe');f.title='Record form';f.hidden=true;f.style.display='none';dialog.append(f);entry={frame:f,url:key,created:performance.now()};f.src=key;}return {entry,reused};}
function release(){clearTimeout(timer);if(!active)return;const entry=active;active=null;frame=null;if(!entry.discard&&readonly(entry)){entry.frame.hidden=true;entry.frame.style.display='none';pool.set(entry.url,entry);trim();}else remove(entry);if(loading)loading.hidden=true;}
function mount(){if(dialog)return;const cacheStyle=document.createElement('style');cacheStyle.textContent="#peEntryDialog{position:fixed;display:block;top:50%;left:50%;right:auto;bottom:auto;margin:0;transform:translate(-50%,-50%)}#peEntryDialog:not([open]),#peEntryDialog.pe-popup-minimized{visibility:hidden;pointer-events:none}#peEntryDialog.pe-popup-minimized{display:block!important}#peEntryDialog>iframe{position:absolute;top:47px;left:0;display:block!important;width:100%;height:calc(100% - 47px)}#peEntryDialog>iframe[hidden]{visibility:hidden;pointer-events:none}#peEntryDialog>iframe:not([hidden]){visibility:inherit}";document.head.append(cacheStyle);dialog=document.createElement('dialog');dialog.id='peEntryDialog';dialog.innerHTML='<div class="pe-entry-heading"><strong id="peEntryTitle"></strong><button type="button" aria-label="Close entry form">×</button></div><div class="pe-entry-loading" role="status">Loading details…</div>';document.body.append(dialog);loading=dialog.querySelector('.pe-entry-loading');loading.style.cssText='position:absolute;inset:47px 0 0;background:white;color:#475569;padding:24px;font:13px Segoe UI,Arial;z-index:1';dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',release);}
function observeReady(entry){if(active!==entry)return;if(ready(entry)){loading.hidden=true;if(lastTiming)lastTiming.readyMs=performance.now()-lastTiming.started;return;}if(performance.now()-entry.created>15000){loading.textContent='The form is taking longer to load. Close it and try again.';return;}timer=setTimeout(()=>observeReady(entry),25);}
function show(title,url){const start=performance.now();clearTimeout(prefetchTimer);if(dialog&&global.PEPopups?.isMinimized(dialog)){global.PEPopups.restore(dialog);return;}mount();if(active)release();const result=acquire(new URL(url,location.href));active=result.entry;frame=active.frame;frame.title=title;frame.hidden=false;frame.style.display='block';dialog.setAttribute('aria-label',title);document.getElementById('peEntryTitle').textContent=title;loading.textContent='Loading details…';loading.hidden=ready(active);if(!dialog.open)dialog.showModal();lastTiming={started:start,shellMs:performance.now()-start,reused:result.reused,readyAtOpen:ready(active)};observeReady(active);}
function open(kind,context={}){if(!['invoice','purchase-order'].includes(kind))return;show(kind==='invoice'?'Add Invoice':'Add Purchase Order',urlFor(kind,context));}
function edit(raw){const url=valid(raw);if(!url)return;const p=url.searchParams,kind=p.get('record')||(p.has('project_action')?'project':''),editable=p.get('edit')==='1'||p.get('project_action')==='edit';show((editable?'Edit ':'View ')+{invoice:'Invoice',po:'Purchase Order',project:'Project',customer:'Customer'}[kind],url);}
function preload(raw){const url=valid(raw);if(!url)return;const p=url.searchParams;if(!(p.get('create')||['invoice','po'].includes(p.get('record'))&&p.get('edit')!=='1')||p.has('view'))return;checkGeneration();if(active?.url===url.href||pool.has(url.href))return;const {entry}=acquire(url);pool.set(entry.url,entry);trim();}
function saved(){if(!embedded)return false;parent.postMessage({type:'pe-entry-saved'},location.origin);return true;}
function updated(){if(!embedded)return false;parent.postMessage({type:'pe-entry-updated'},location.origin);return true;}
function payments(invoice){if(invoice?.id==null)return;show('Received Payments — '+(invoice.invoice_no||''),'invoices.html?'+new URLSearchParams({payments_invoice:invoice.id,embedded:'1'}));}
function cancel(){if(!embedded)return false;parent.postMessage({type:'pe-entry-cancel'},location.origin);return true;}
function candidate(target){const link=target?.closest?.('a[href]');if(link){const url=new URL(link.href,location.href);if(url.origin===location.origin&&url.pathname.endsWith('/companies.html'))return url;}const button=target?.closest?.('#openCreate');if(button){const page=location.pathname.split('/').pop(),kind=page==='invoices.html'?'invoice':page==='purchase-orders.html'?'purchase-order':null;if(kind)return urlFor(kind);}return null;}
document.addEventListener('pointerover',event=>{if(embedded||event.pointerType==='touch')return;const url=candidate(event.target);if(!url)return;clearTimeout(prefetchTimer);prefetchTimer=setTimeout(()=>preload(url),80);},{passive:true});
document.addEventListener('pointerout',event=>{const url=candidate(event.target);if(url&&candidate(event.relatedTarget)?.href!==url.href)clearTimeout(prefetchTimer);},{passive:true});
document.addEventListener('focusin',event=>{if(!embedded){const url=candidate(event.target);if(url)preload(url);}});
document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(!a||embedded)return;const url=new URL(a.href,location.href),kind=url.searchParams.get('create');if(url.origin!==location.origin||!['invoice','purchase-order'].includes(kind))return;event.preventDefault();open(kind,Object.fromEntries(url.searchParams));});
global.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!['pe-entry-saved','pe-entry-updated','pe-entry-cancel','pe-entry-minimize'].includes(event.data?.type))return;if(event.data.type==='pe-entry-minimize'){global.PEPopups?.minimize(dialog);return;}if(['pe-entry-saved','pe-entry-updated'].includes(event.data.type)){invalidate();if(active)active.discard=true;}if(event.data.type!=='pe-entry-updated'){global.PEPopups?.dismiss(dialog);dialog.close();}if(['pe-entry-saved','pe-entry-updated'].includes(event.data.type)){if(typeof global.loadAll==='function')await global.loadAll();else if(typeof global.refreshDashboard==='function')await global.refreshDashboard();else location.reload();}});
if(embedded)document.documentElement.classList.add('pe-entry-embedded');
global.PEEntry={open,edit,payments,preload,invalidate,saved,updated,cancel,embedded,get timing(){return lastTiming?{...lastTiming,started:undefined}:null;},get cacheStats(){return {size:pool.size,ready:[...pool.values()].filter(ready).length};}};
})(window);

