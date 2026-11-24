(function(global){
'use strict';
const tableSizes=new WeakMap(),textMeasure=document.createElement('canvas').getContext('2d');
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
let observer;
function enhance(){
 observer?.disconnect();
 try{
 const tables=document.querySelectorAll('#tableWrap>table,.cm-scroll>table,.tablewrap>table,.table-wrap>table,#reportContent table,.pe-drill table');
 tables.forEach(table=>{
  if(table.closest('[data-fast-register]'))return;
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
  const numbers=[...table.querySelectorAll('td.num')];
  const signature=table.clientWidth+'|'+table.rows.length+'|'+headers.map(h=>h.textContent).join('|')+'|'+numbers.map(c=>c.textContent).join('|');
  if(tableSizes.get(table)===signature)return;
  table.querySelectorAll('th,td').forEach(cell=>{if(cell.style.width)cell.style.width='';});
  numbers.forEach(cell=>{
   if(!cell.children.length&&/SAR/.test(cell.textContent)){cell.title=cell.textContent;cell.textContent=cell.textContent.replace(/SAR/g,'').trim();}
  });
  // Read geometry together, then write all font sizes. Never alternate a
  // numeric-cell style change with scrollWidth/clientWidth layout reads.
  const widths=headers.map(h=>h.getBoundingClientRect().width);
  const style=numbers.length?getComputedStyle(numbers[0]):null;
  const padding=style?parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+2:8;
  if(style)textMeasure.font='11px '+style.fontFamily;
  numbers.forEach(cell=>{
   const available=Math.max(1,(widths[cell.cellIndex]||80)-padding);
   const measured=textMeasure.measureText(cell.textContent.trim()).width;
   const size=Math.min(11,Math.max(8,measured>available?11*available/measured:11));
   const value=(Math.floor(size*4)/4)+'px';
   if(cell.style.fontSize!==value)cell.style.fontSize=value;
  });
  tableSizes.set(table,table.clientWidth+'|'+table.rows.length+'|'+headers.map(h=>h.textContent).join('|')+'|'+numbers.map(c=>c.textContent).join('|'));
 });
 document.querySelectorAll('table button,table a.btn,table a.project-action,.hero .actions button,.hero .actions a.btn,.cm-toolbar button,.panelhead>button').forEach(iconify);
 }finally{observer?.observe(document.body,{childList:true,subtree:true});}
}
let queued=false;
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance();});}
document.addEventListener('DOMContentLoaded',()=>{observer=new MutationObserver(schedule);enhance();});
global.addEventListener('resize',schedule);
document.addEventListener('pe-access-ready',schedule);
global.PETheme={enhance,schedule,icon};
})(window);

(function(global){
'use strict';
let tables=[],dirty=true,queued=false;const floating=new Map(),skip='dialog,.modal,.modal-backdrop,.cm-dialog,#invoiceModal,#projectModal,#closedModal,[data-pe-floating-head]';
function schedule(){if(queued)return;queued=true;requestAnimationFrame(update);}
function navBottom(){let top=0;for(const nav of document.querySelectorAll('#pe-global-nav,.nav')){const r=nav.getBoundingClientRect();if(r.top<=2&&r.bottom>0)top=Math.max(top,r.bottom);}for(const dock of document.querySelectorAll('.report-control-dock')){const r=dock.getBoundingClientRect();if(r.top<=top+2&&r.bottom>top&&getComputedStyle(dock).position==='sticky')top=r.bottom;}return top;}
function header(table){return table.tHead||([...table.rows].find(r=>r.querySelector('th'))||null);}
function background(cell){for(let p=cell;p;p=p.parentElement){const color=getComputedStyle(p).backgroundColor;if(color!=='transparent'&&color!=='rgba(0, 0, 0, 0)')return color;}return '#fff';}
function update(){
 queued=false;if(dirty){tables=[...document.querySelectorAll('table')].filter(t=>!t.closest(skip));dirty=false;}
 const top=navBottom(),keep=new Set();
 for(const table of tables){const head=header(table);if(!head||!table.isConnected)continue;const rect=table.getBoundingClientRect(),hr=head.getBoundingClientRect();if(!rect.width||!hr.height)continue;
  let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),boundTop=top,bottom=Math.min(innerHeight,rect.bottom);
  for(let p=table.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){boundTop=Math.max(boundTop,r.top);bottom=Math.min(bottom,r.bottom);}}
  if(hr.top>=boundTop-.5||bottom<=boundTop+hr.height||right<=left)continue;
  keep.add(table);let entry=floating.get(table);const cells=[...head.querySelectorAll('th,td')],widths=cells.map(c=>c.getBoundingClientRect().width),signature=head.innerHTML+'|'+rect.width+'|'+widths.join(',');
  if(!entry){const host=document.createElement('div');host.dataset.peFloatingHead='true';host.setAttribute('aria-hidden','true');host.style.cssText='position:fixed;z-index:19;overflow:hidden;background:#14263d;box-shadow:0 2px 5px #0002;pointer-events:auto';document.body.append(host);entry={host,signature:''};floating.set(table,entry);}
  if(entry.signature!==signature){const clone=document.createElement('table');clone.style.cssText='border-collapse:collapse;table-layout:fixed;margin:0;min-width:0;max-width:none';clone.style.width=rect.width+'px';const copy=head.cloneNode(true),group=document.createElement('colgroup');const first=head.tagName==='THEAD'?head.rows[0]:head;
   for(const cell of first.cells){for(let i=0;i<cell.colSpan;i++){const col=document.createElement('col');col.style.width=cell.getBoundingClientRect().width/cell.colSpan+'px';group.append(col);}}
   const copied=[...copy.querySelectorAll('th,td')];cells.forEach((cell,i)=>{const target=copied[i];if(!target)return;const s=getComputedStyle(cell);for(const key of ['font','fontSize','fontWeight','lineHeight','fontFamily','padding','border','boxSizing','color','textAlign','verticalAlign','whiteSpace','overflowWrap','letterSpacing'])target.style[key]=s[key];target.style.backgroundColor=background(cell);target.style.position='static';target.style.height=cell.getBoundingClientRect().height+'px';});
   for(const node of [copy,...copy.querySelectorAll('*')]){node.removeAttribute('id');node.removeAttribute('name');for(const attr of [...node.attributes])if(attr.name.startsWith('on'))node.removeAttribute(attr.name);if(node.matches('button,a,input,select,textarea'))node.tabIndex=-1;}
   clone.append(group);if(head.tagName==='THEAD')clone.append(copy);else{const thead=document.createElement('thead');thead.append(copy);clone.append(thead);}entry.host.replaceChildren(clone);entry.clone=clone;entry.signature=signature;
  }
  entry.host.style.left=left+'px';entry.host.style.top=boundTop+'px';entry.host.style.width=(right-left)+'px';entry.host.style.height=hr.height+'px';entry.clone.style.transform='translateX('+(rect.left-left)+'px)';
 }
 for(const [table,entry]of floating)if(!keep.has(table)){entry.host.remove();floating.delete(table);}
}
function mount(){const style=document.createElement('style');style.textContent='@media print{[data-pe-floating-head]{display:none!important}}';document.head.append(style);new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('[data-pe-floating-head]')))return;dirty=true;schedule();}).observe(document.body,{childList:true,subtree:true});
 document.addEventListener('scroll',schedule,{capture:true,passive:true});global.addEventListener('resize',()=>{dirty=true;schedule();},{passive:true});document.addEventListener('pe-access-ready',()=>{dirty=true;schedule();});if(global.ResizeObserver){const observer=new ResizeObserver(schedule);document.querySelectorAll('#pe-global-nav,.nav,.report-control-dock').forEach(n=>observer.observe(n));}schedule();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
global.PEFloatingHeaders={refresh:()=>{dirty=true;schedule();}};
})(window);
