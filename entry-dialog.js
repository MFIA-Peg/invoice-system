(function(global){
'use strict';let dialog,frame;
const embedded=new URLSearchParams(location.search).get('embedded')==='1'&&parent!==global;
function open(kind,context={}){
 if(!['invoice','purchase-order'].includes(kind))return;
 if(!dialog){dialog=document.createElement('dialog');dialog.id='peEntryDialog';dialog.setAttribute('aria-label','Add record');dialog.innerHTML='<div class="pe-entry-heading"><strong id="peEntryTitle"></strong><button type="button" aria-label="Close entry form">×</button></div><iframe title="Entry form"></iframe>';document.body.append(dialog);frame=dialog.querySelector('iframe');dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>frame.src='about:blank');}
 document.getElementById('peEntryTitle').textContent=kind==='invoice'?'Add Invoice':'Add Purchase Order';
 const params=new URLSearchParams({create:kind,embedded:'1'});for(const key of ['project_id','po_id','po_no'])if(context[key]!=null&&context[key]!=='')params.set(key,context[key]);
 frame.src='companies.html?'+params;dialog.showModal();
}
function saved(){if(!embedded)return false;parent.postMessage({type:'pe-entry-saved'},location.origin);return true;}
function cancel(){if(!embedded)return false;parent.postMessage({type:'pe-entry-cancel'},location.origin);return true;}
document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(!a||embedded)return;const url=new URL(a.href,location.href),kind=url.searchParams.get('create');if(url.origin!==location.origin||!['invoice','purchase-order'].includes(kind))return;event.preventDefault();open(kind,Object.fromEntries(url.searchParams));});
global.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!['pe-entry-saved','pe-entry-cancel'].includes(event.data?.type))return;dialog.close();if(event.data.type==='pe-entry-saved'){if(typeof global.loadAll==='function')await global.loadAll();else if(typeof global.refreshDashboard==='function')await global.refreshDashboard();else location.reload();}});
if(embedded)document.documentElement.classList.add('pe-entry-embedded');
global.PEEntry={open,saved,cancel,embedded};
})(window);