(function(global){
'use strict';
const shapes={
open:'<path d="M14 3h7v7M21 3l-11 11"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
edit:'<path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4"/>',
delete:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
add:'<path d="M12 4v16M4 12h16"/>',
report:'<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>',
attachment:'<path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9M7 13l7-7"/>',
refresh:'<path d="M20 7a9 9 0 1 0 1 7M20 2v6h-6"/>',
export:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
link:'<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 1 1 6 6l-5 5a4 4 0 0 1-6 0"/>'
};
function icon(key){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+shapes[key]+'</svg>';}
function iconify(element){
 if(element.matches('.invoice-drill,.project-drill,.po-drill,[data-history-invoice],[data-invoice-drill],[data-project-drill],[data-drill-po],.user-item,.invoice-alert')||element.querySelector('svg'))return;
 const text=element.textContent.trim();if(!text||text.length>50)return;
 let key;
 if(/delete|remove/i.test(text))key='delete';
 else if(/unlink/i.test(text))key='link';
 else if(/edit/i.test(text))key='edit';
 else if(/attachment/i.test(text))key='attachment';
 else if(/add|new/i.test(text))key='add';
 else if(/report|details/i.test(text))key='report';
 else if(/open|view/i.test(text))key='open';
 else if(/refresh/i.test(text))key='refresh';
 else if(/export|excel/i.test(text))key='export';
 else if(/link|departments/i.test(text))key='link';
 if(!key)return;
 element.title=text;element.setAttribute('aria-label',text);element.classList.add('pe-icon-action');element.innerHTML=icon(key);
}
function enhance(){
 const tables=document.querySelectorAll('#tableWrap>table,.cm-scroll>table,.tablewrap>table,.table-wrap>table,#reportContent table,.pe-drill table');
 tables.forEach(table=>{
  if(table.closest('dialog,.modal,.cm-dialog,.modal-backdrop,.po-detail-row,.detail-row'))return;
  const headers=[...table.querySelectorAll(':scope>thead>tr:first-child>th')];
  if(!headers.length)return;
  table.classList.add('pe-register');table.parentElement.classList.add('pe-register-scroll');
  let group=table.querySelector(':scope>colgroup');
  if(!group){group=document.createElement('colgroup');table.prepend(group);}
  if(group.children.length!==headers.length)group.innerHTML=headers.map(()=>'<col>').join('');
  const weights=headers.map(h=>/actions/i.test(h.textContent)?2:/customer|company|project|department/i.test(h.textContent)?1.4:1);
  const total=weights.reduce((a,b)=>a+b,0);
  [...group.children].forEach((col,i)=>{const width=(weights[i]/total*100).toFixed(3)+'%';if(col.style.width!==width)col.style.width=width;});
  table.querySelectorAll('th,td').forEach(cell=>{cell.style.width='';});
  table.querySelectorAll('td.num').forEach(cell=>{
   if(!cell.children.length&&/SAR/.test(cell.textContent)){cell.title=cell.textContent;cell.textContent=cell.textContent.replace(/SAR/g,'').trim();}
   cell.style.fontSize='11px';let size=11;
   while(cell.scrollWidth>cell.clientWidth&&size>8){size-=.25;cell.style.fontSize=size+'px';}
  });
 });
 document.querySelectorAll('table button,table a.btn,table a.project-action,.hero .actions button,.hero .actions a.btn,.cm-toolbar button,.panelhead>button').forEach(iconify);
}
let queued=false;
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance();});}
document.addEventListener('DOMContentLoaded',()=>{enhance();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});});
global.addEventListener('resize',schedule);
document.addEventListener('pe-access-ready',schedule);
global.PETheme={enhance,schedule,icon};
})(window);
