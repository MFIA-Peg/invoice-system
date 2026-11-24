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
'use strict';let dialog,frame;
const embedded=new URLSearchParams(location.search).get('embedded')==='1'&&parent!==global;
function open(kind,context={}){
 if(!['invoice','purchase-order'].includes(kind))return;
 if(dialog&&global.PEPopups?.isMinimized(dialog)){global.PEPopups.restore(dialog);return;}
 if(!dialog){dialog=document.createElement('dialog');dialog.id='peEntryDialog';dialog.setAttribute('aria-label','Add record');dialog.innerHTML='<div class="pe-entry-heading"><strong id="peEntryTitle"></strong><button type="button" aria-label="Close entry form">×</button></div><iframe title="Entry form"></iframe>';document.body.append(dialog);frame=dialog.querySelector('iframe');dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>frame.src='about:blank');}
 document.getElementById('peEntryTitle').textContent=kind==='invoice'?'Add Invoice':'Add Purchase Order';
 const params=new URLSearchParams({create:kind,embedded:'1'});for(const key of ['project_id','po_id','po_no'])if(context[key]!=null&&context[key]!=='')params.set(key,context[key]);
 frame.src='companies.html?'+params;dialog.showModal();
}
function saved(){if(!embedded)return false;parent.postMessage({type:'pe-entry-saved'},location.origin);return true;}
function cancel(){if(!embedded)return false;parent.postMessage({type:'pe-entry-cancel'},location.origin);return true;}
document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(!a||embedded)return;const url=new URL(a.href,location.href),kind=url.searchParams.get('create');if(url.origin!==location.origin||!['invoice','purchase-order'].includes(kind))return;event.preventDefault();open(kind,Object.fromEntries(url.searchParams));});
global.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!['pe-entry-saved','pe-entry-cancel','pe-entry-minimize'].includes(event.data?.type))return;if(event.data.type==='pe-entry-minimize'){global.PEPopups?.minimize(dialog);return;}global.PEPopups?.dismiss(dialog);dialog.close();frame.src='about:blank';if(event.data.type==='pe-entry-saved'){if(typeof global.loadAll==='function')await global.loadAll();else if(typeof global.refreshDashboard==='function')await global.refreshDashboard();else location.reload();}});
if(embedded)document.documentElement.classList.add('pe-entry-embedded');
global.PEEntry={open,saved,cancel,embedded};
})(window);
