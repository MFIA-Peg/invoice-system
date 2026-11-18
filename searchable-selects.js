(function(global){
 'use strict';
 const registry=new Map(),filterVersions=new WeakMap();let nextId=0,active=null,scheduled=false;
 function syncFilterSources(){
  document.querySelectorAll('select[data-filter-source]').forEach(select=>{
   const source=document.getElementById(select.dataset.filterSource);if(!source)return;
   const values=Array.from(source.querySelectorAll('option')).map(o=>({value:o.value,label:o.label||o.textContent||o.value})),version=JSON.stringify(values);
   if(filterVersions.get(select)===version)return;filterVersions.set(select,version);
   const old=select.value;select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent=select.dataset.filterEmpty||'All';select.append(all);
   for(const v of values){const o=document.createElement('option');o.value=v.value;o.textContent=v.label;select.append(o);}
   select.value=values.some(v=>v.value===old)?old:'';
   if(old&&select.value!==old)select.dispatchEvent(new Event('input',{bubbles:true}));
  });
 }
 const normalize=v=>String(v??'').normalize('NFKC').trim().toLocaleLowerCase();
 const optionsFor=(select,query)=>Array.from(select.options).filter(o=>!o.hidden&&normalize(o.textContent).includes(normalize(query)));
 function selectedText(select){return select.selectedOptions?.[0]?.textContent||'';}
 function enhance(select){
  if(registry.has(select)||select.multiple||select.size>1||select.dataset.nativeSelect==='true')return;
  const wrap=document.createElement('span'),input=document.createElement('input'),arrow=document.createElement('button'),list=document.createElement('div');
  wrap.className='pe-combobox';input.type='text';input.className='pe-combobox-input';input.autocomplete='off';input.spellcheck=false;
  input.id=select.id?select.id+'__search':'pe-select-search-'+(++nextId);list.id='pe-select-list-'+(++nextId);list.className='pe-combobox-list';list.hidden=true;list.setAttribute('role','listbox');
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',list.id);
  const label=select.labels?.[0];if(label){if(!label.id)label.id='pe-select-label-'+(++nextId);input.setAttribute('aria-labelledby',label.id);label.addEventListener('click',e=>{e.preventDefault();input.focus();});}
  else input.setAttribute('aria-label',select.getAttribute('aria-label')||select.getAttribute('title')||select.id||'Select an option');
  arrow.type='button';arrow.className='pe-combobox-arrow';arrow.textContent='▾';arrow.tabIndex=-1;arrow.setAttribute('aria-label','Open options');
  select.before(wrap);wrap.append(input,arrow,select);(select.closest('dialog')||document.body).append(list);select.classList.add('pe-select-original');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  let filtered=[],index=-1,open=false;
  function sync(){if(open&&!input.getClientRects().length)close();input.disabled=arrow.disabled=select.disabled;input.required=select.required;if(!open)input.value=selectedText(select);input.placeholder=select.dataset.searchPlaceholder||'Type to search…';}
  function close(){open=false;list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');input.value=selectedText(select);if(active===api)active=null;}
  function choose(option){if(!option||option.disabled)return;select.value=option.value;input.setCustomValidity('');close();select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));sync();input.focus();}
  function mark(){Array.from(list.children).forEach((node,i)=>{node.classList.toggle('highlighted',i===index);if(i===index){input.setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});}});}
  function render(query){
   filtered=optionsFor(select,query);index=-1;list.replaceChildren();
   filtered.forEach((option,i)=>{const item=document.createElement('div');item.id=list.id+'-'+i;item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.setAttribute('aria-disabled',String(option.disabled));item.className='pe-combobox-option';item.textContent=option.textContent;item.addEventListener('mousedown',e=>e.preventDefault());item.addEventListener('click',()=>choose(option));list.append(item);});
   if(!filtered.length){const empty=document.createElement('div');empty.className='pe-combobox-empty';empty.textContent='No matching options';list.append(empty);}
  }
  function position(){const box=input.getBoundingClientRect(),space=innerHeight-box.bottom,up=space<150&&box.top>space;list.style.position='fixed';list.style.width=Math.max(220,box.width)+'px';list.style.minWidth=box.width+'px';list.style.maxHeight=Math.max(90,Math.min(230,(up?box.top:space)-12))+'px';list.style.left=Math.max(8,Math.min(box.left,innerWidth-Math.max(220,box.width)-8))+'px';list.style.top=up?'auto':(box.bottom+4)+'px';list.style.bottom=up?(innerHeight-box.top+4)+'px':'auto';}
  function show(){if(select.disabled)return;if(active&&active!==api)active.close();sync();open=true;active=api;list.hidden=false;position();input.setAttribute('aria-expanded','true');render('');}
  input.addEventListener('focus',()=>{show();input.select();});input.addEventListener('click',()=>{if(!open)show();});
  input.addEventListener('input',e=>{e.stopPropagation();const query=input.value;if(!open)show();input.value=query;render(query);input.setCustomValidity('Select a matching option from the list.');});
  input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open)show();const step=e.key==='ArrowDown'?1:-1;for(let tries=0;tries<filtered.length;tries++){index=(index+step+filtered.length)%filtered.length;if(!filtered[index].disabled)break;}mark();}else if(e.key==='Enter'&&open){e.preventDefault();if(index>=0)choose(filtered[index]);else{const exact=filtered.find(o=>!o.disabled&&normalize(o.textContent)===normalize(input.value));if(exact)choose(exact);}}else if(e.key==='Escape'){e.preventDefault();close();input.setCustomValidity('');}else if(e.key==='Tab'){close();input.setCustomValidity('');}});
  input.addEventListener('blur',()=>{setTimeout(()=>{if(!wrap.contains(document.activeElement)){close();input.setCustomValidity('');}},0);});
  arrow.addEventListener('mousedown',e=>e.preventDefault());arrow.addEventListener('click',()=>{if(open)close();else{input.focus();show();}});
  select.addEventListener('change',sync);select.addEventListener('input',sync);select.addEventListener('invalid',e=>{e.preventDefault();input.focus();input.setCustomValidity('Select an option from the list.');input.reportValidity();});
  const api={select,input,wrap,list,sync,close};registry.set(select,api);sync();
 }
 function refresh(){scheduled=false;syncFilterSources();for(const [select,api] of registry){if(!select.isConnected){if(active===api)active=null;api.list.remove();registry.delete(select);}else api.sync();}document.querySelectorAll('select').forEach(enhance);}
 function schedule(records){if(records.every(r=>r.target?.closest?.('.pe-combobox-list')||(r.target?.closest?.('.pe-combobox')&&!r.target?.matches?.('select,option,optgroup'))))return;if(!scheduled){scheduled=true;requestAnimationFrame(refresh);}}
 function start(){
  const link=document.createElement('link');link.rel='stylesheet';link.href='searchable-selects.css?v=20261118a';document.head.append(link);
  refresh();new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','required','selected','style','hidden']});
  document.addEventListener('mousedown',e=>{if(active&&!active.wrap.contains(e.target)&&!active.list.contains(e.target))active.close();});document.addEventListener('reset',()=>setTimeout(refresh,0));
  document.addEventListener('scroll',e=>{if(active&&!active.list.contains(e.target))active.close();},true);global.addEventListener('resize',()=>active?.close());
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
 global.PESearchableSelects={refresh,optionsFor,selectedText,syncFilterSources};
})(window);



