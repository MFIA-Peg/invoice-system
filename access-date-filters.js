/* Shared calendar filters. Existing source inputs remain the filtering contract. */
(function (global) {
  'use strict';
  const presets = [
    ['on', 'On a date'], ['before', 'Before a date'], ['after', 'After a date'], ['between', 'Between two dates'],
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['last-week', 'Last week'], ['this-week', 'This week'],
    ['next-week', 'Next week'], ['last-month', 'Last month'], ['this-month', 'This month'], ['next-month', 'Next month'],
    ['this-year', 'This year'], ['last-year', 'Last year'], ['next-year', 'Next year'], ['past', 'Past'], ['future', 'Future']
  ];
  const custom = new Set(['on', 'before', 'after', 'between']);
  function iso(date) { return date.toISOString().slice(0, 10); }
  function parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Enter a valid date.');
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(+date) || iso(date) !== value || value < '0001-01-01') throw Error('Enter a valid date.');
    return date;
  }
  function shift(value, days) {
    const date = parse(value); date.setUTCDate(date.getUTCDate() + days);
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw Error('Choose a date between 01/01/0001 and 12/31/9999.');
    return iso(date);
  }
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en', {timeZone:'Asia/Riyadh', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
    const part = key => parts.find(p => p.type === key).value;
    return part('year') + '-' + part('month') + '-' + part('day');
  }
  function resolve(mode, first = '', second = '', asOf = today()) {
    parse(asOf);
    const year = Number(asOf.slice(0, 4)), month = Number(asOf.slice(5, 7));
    if (custom.has(mode)) parse(first);
    if (mode === 'on') return {from:first, to:first};
    if (mode === 'before') return {from:'', to:shift(first, -1)};
    if (mode === 'after') return {from:shift(first, 1), to:''};
    if (mode === 'between') { parse(second); if (first > second) throw Error('The end date must be on or after the start date.'); return {from:first, to:second}; }
    if (mode === 'today') return {from:asOf, to:asOf};
    if (mode === 'yesterday') { const date = shift(asOf, -1); return {from:date, to:date}; }
    if (mode.endsWith('-week')) {
      const offset = mode === 'last-week' ? -7 : mode === 'next-week' ? 7 : 0;
      const from = shift(asOf, -parse(asOf).getUTCDay() + offset);
      return {from, to:shift(from, 6)};
    }
    if (mode.endsWith('-month')) {
      const offset = mode === 'last-month' ? -1 : mode === 'next-month' ? 1 : 0;
      const start = parse(asOf); start.setUTCDate(1); start.setUTCMonth(month - 1 + offset);
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
      return {from:iso(start), to:iso(end)};
    }
    if (mode.endsWith('-year')) {
      const target = year + (mode === 'last-year' ? -1 : mode === 'next-year' ? 1 : 0);
      return {from:String(target).padStart(4,'0') + '-01-01', to:String(target).padStart(4,'0') + '-12-31'};
    }
    if (mode === 'past') return {from:'', to:shift(asOf,-1)};
    if (mode === 'future') return {from:shift(asOf,1), to:''};
    if (mode === 'reset') return {from:'', to:''};
    throw Error('Unknown date filter.');
  }
  function display(value) { return value ? value.slice(5,7) + '/' + value.slice(8,10) + '/' + value.slice(0,4) : ''; }
  const calendar = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v16H4zM4 10h16M8 3v4m8-4v4M8 14h3m2 0h3M8 17h3"/></svg>';
  const icons = {close:'<path d="m6 6 12 12M18 6 6 18"/>', apply:'<path d="m5 12 4 4L19 6"/>', back:'<path d="M19 12H5m7 7-7-7 7-7"/>'};
  const svg = key => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + icons[key] + '</svg>';
  const configs = [
    ['fromDate','toDate','Period'], ['dueFromDate','dueToDate','Due date'],
    ['dateFrom','dateTo','Period'], ['dueFrom','dueTo','Due date'],
    ['fFrom','fTo','Period'], ['fDueFrom','fDueTo','Due date'], ['filterFrom','filterTo','Period']
  ];
  const fields = new Map();
  let popup, active, mode = '', queued = false;
  const excluded = 'dialog,.modal,.modal-backdrop,#invoiceModal,#projectModal,#cmDialog,[role="dialog"]';
  function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text) n.textContent = text; return n; }
  function action(label, icon, handler) {
    const b = node('button','pe-date-action'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = svg(icon); b.onclick = handler; return b;
  }
  function values(field) { return {from:field.from.value, to:field.to?.value || ''}; }
  function update(field) {
    const value = values(field), signature = value.from + '|' + value.to;
    if (field.signature === signature) return;
    field.signature = signature;
    if (field.choice && (field.choice.from !== value.from || field.choice.to !== value.to)) field.choice = null;
    let label;
    if (field.single) label = display(value.from) || 'Select date';
    else if (field.choice) label = field.choice.label;
    else if (!value.from && !value.to) label = field.label === 'Period' ? 'Default period' : 'Any date';
    else if (value.from === value.to) label = display(value.from);
    else label = value.from && value.to ? 'Custom range' : value.from ? 'From ' + display(value.from) : 'Through ' + display(value.to);
    field.caption.textContent = label;
    field.button.title = field.label + ': ' + label + (field.single ? '' : '\n' + (value.from ? display(value.from) : 'Beginning') + ' – ' + (value.to ? display(value.to) : 'No end date'));
    field.button.setAttribute('aria-label', field.button.title.replace(/\n/g,' · '));
    field.button.classList.toggle('pe-date-active', Boolean(value.from || value.to));
  }
  function notify(field) {
    // One input event sees both final bounds, avoiding two financial renders.
    // The as-of input has an existing onchange handler rather than oninput.
    field.from.dispatchEvent(new Event(field.single ? 'change' : 'input', {bubbles:true}));
    document.dispatchEvent(new CustomEvent('pe-date-filter-change', {detail:{id:field.from.id, ...values(field)}}));
  }
  function commit(field, value, label) {
    field.from.value = value.from; if (field.to) field.to.value = value.to;
    field.choice = {...value, label}; field.signature = null; update(field); close(); notify(field);
  }
  function position() {
    if (!popup || !active) return;
    const rect = active.button.getBoundingClientRect(), width = Math.min(340, innerWidth - 16);
    popup.style.width = width + 'px';
    const height = popup.getBoundingClientRect().height;
    popup.style.left = Math.max(8,Math.min(rect.left,innerWidth-width-8)) + 'px';
    popup.style.top = Math.max(8,Math.min(rect.bottom+5,innerHeight-height-8)) + 'px';
  }
  function close(restore = true) {
    if (!popup) return;
    const previous = active; popup.remove(); popup = null; active = null; mode = '';
    previous?.button.setAttribute('aria-expanded','false');
    document.dispatchEvent(new CustomEvent('pe-date-popover-toggle',{detail:{open:false}}));
    if (restore && previous?.button.isConnected) previous.button.focus({preventScroll:true});
  }
  function heading(text) {
    popup.replaceChildren(); const header = node('div','pe-date-heading'); header.append(node('strong','',text),action('Close date filter','close',()=>close())); popup.append(header);
  }
  function editor(key) {
    mode = key;
    const field = active, label = presets.find(p=>p[0]===key)[1];
    heading(field.label + ' · ' + label);
    const form = node('form','pe-date-form');
    const row = node('div','pe-date-inputs');
    function input(id, title, value) {
      const wrap = node('label','',title), element = node('input'); element.type='date'; element.id=id; element.lang='en-US'; element.min='0001-01-01'; element.max='9999-12-31'; element.required=true; element.value=value || ''; wrap.htmlFor=id; wrap.append(element); row.append(wrap); return element;
    }
    const current = values(field);
    let initial=current.from||current.to;
    try{if(key==='before'&&current.to)initial=shift(current.to,1);else if(key==='after'&&current.from)initial=shift(current.from,-1);}catch{}
    const first = input('peDateFirst',key==='between'?'From':'Date',initial);
    const second = key==='between'?input('peDateSecond','To',current.to):null;
    const hint = node('p','pe-date-hint',key==='between'?'Both dates are included. MM/DD/YYYY':key==='before'?'Excludes the chosen date. MM/DD/YYYY':key==='after'?'Excludes the chosen date. MM/DD/YYYY':'MM/DD/YYYY');
    const error = node('p','pe-date-error'); error.setAttribute('role','alert');
    const tools = node('div','pe-date-tools');
    const back = action('Back to date options','back',menu), apply = action('Apply date filter','apply',()=>{}); apply.type='submit'; tools.append(back,apply);
    form.append(row,hint,error,tools); popup.append(form);
    form.onsubmit = e => { e.preventDefault(); if(!form.reportValidity())return; try { const value=field.single?{from:(parse(first.value),first.value),to:''}:resolve(key,first.value,second?.value); const caption=key==='on'?display(first.value):key==='before'?'< '+display(first.value):key==='after'?'> '+display(first.value):'Custom range';commit(field,value,caption); } catch(e) { error.textContent=e.message; } };
    position(); first.focus({preventScroll:true});
  }
  function menu() {
    mode=''; heading(active.label);
    const list = node('div','pe-date-options'); list.setAttribute('role','group'); list.setAttribute('aria-label','Date options');
    for (const [key,label] of presets.filter(([key])=>!active.single || ['on','today','yesterday'].includes(key))) {
      const b = node('button','pe-date-option',label); b.type='button'; b.dataset.datePreset=key;
      b.onclick = () => { if(custom.has(key))return editor(key); const value=resolve(key); commit(active,active.single?{from:value.to,to:''}:value,label); }; list.append(b);
    }
    if(!active.single){const reset=node('button','pe-date-option pe-date-reset','Reset date filter');reset.type='button';reset.dataset.datePreset='reset';reset.onclick=()=>commit(active,resolve('reset'),active.label==='Period'?'Default period':'Any date');list.append(reset);}
    popup.append(list,node('p','pe-date-hint',active.single?'Report balances through the selected date.':'Asia/Riyadh · Weeks: Sunday–Saturday. Past and Future exclude today.'));
    position(); list.querySelector('button')?.focus({preventScroll:true});
  }
  function open(field) {
    if(active===field){close();return;} close(false); active=field; update(field);
    popup=node('section','pe-date-popover');popup.id='peDatePopover';popup.setAttribute('role','dialog');popup.setAttribute('aria-label',field.label+' filter');
    document.body.append(popup);field.button.setAttribute('aria-expanded','true');
    document.dispatchEvent(new CustomEvent('pe-date-popover-toggle',{detail:{open:true}}));menu();
  }
  function mount(from,to,label,single=false) {
    if(fields.has(from.id))return;
    let host;
    if(single){
      const old=from.parentElement,row=document.querySelector('main .filters,.container .filters,.wrap .filters');
      host=node('div','field'); const caption=node('label','',label);host.append(caption,from);if(row)row.append(host);else old.replaceWith(host);
      if(row)old.remove();
    }else{
      host=from.parentElement;const endHost=to.parentElement;endHost.hidden=true;endHost.classList.add('pe-date-source');
      const caption=host.querySelector('label'); if(caption)caption.textContent=label;
    }
    from.hidden=true;if(to)to.hidden=true;host.classList.add('pe-date-field');
    const button=node('button','pe-date-button');button.type='button';button.id='peDate-'+from.id;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','peDatePopover');
    const caption=node('span','pe-date-caption');button.innerHTML=calendar;button.append(caption);host.append(button);host.querySelector('label')?.setAttribute('for',button.id);
    const field={from,to,label,single,button,caption,signature:null};fields.set(from.id,field);button.onclick=()=>open(field);update(field);
  }
  function refresh() {
    for(const [a,b,label]of configs){const from=document.getElementById(a),to=document.getElementById(b);if(from&&to)mount(from,to,label);}
    const asOf=document.getElementById('peReportDate');if(asOf)mount(asOf,null,'Report date',true);
    for(const row of document.querySelectorAll('.filters'))if(!row.closest(excluded)){
      row.classList.add('pe-filter-row');row.closest('.panel,.card')?.classList.add('pe-filter-panel');
      for(const label of row.querySelectorAll('label'))if(!label.title)label.title=label.textContent.trim();
      for(const field of row.children){
        const label=(field.querySelector('label')?.textContent||'').toLowerCase();
        const weight=/project/.test(label)&&!/status/.test(label)?1.4:/customer|company/.test(label)?1.3:/department/.test(label)?.85:/status/.test(label)?1:/search/.test(label)?1.15:1.05;
        field.style.setProperty('--pe-filter-weight',weight);
      }
    }
    for(const field of fields.values())update(field);
    // Choice/input events already apply every filter; retain only reset actions.
    document.querySelectorAll('[aria-label="Apply Filters"],[title="Apply Filters"]').forEach(b=>{b.hidden=true;b.classList.add('pe-auto-apply');});
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refresh();});}
  function start() {
    refresh();
    new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('.pe-date-popover,[data-pe-floating-head]')))schedule();}).observe(document.body,{childList:true,subtree:true});
    document.addEventListener('input',schedule);document.addEventListener('change',schedule);document.addEventListener('click',schedule);
    // Reports' native date fields had an Apply button, unlike other registers.
    if(document.body.classList.contains('reports-page'))for(const id of ['fFrom','fTo','fDueFrom','fDueTo'])document.getElementById(id)?.addEventListener('input',()=>global.applyFilters?.());
    document.addEventListener('pointerdown',e=>{if(popup&&!mode&&!popup.contains(e.target)&&!active.button.contains(e.target))close(false);});
    document.addEventListener('keydown',e=>{
      if(!popup)return;
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}
      if(!popup.contains(document.activeElement))return;
      const buttons=[...popup.querySelectorAll('.pe-date-option')],index=buttons.indexOf(document.activeElement);
      if(index>=0&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}
      if(e.key==='Tab'){const items=[...popup.querySelectorAll('button,input')],at=items.indexOf(document.activeElement);if(e.shiftKey&&at===0){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&at===items.length-1){e.preventDefault();items[0].focus();}}
    },true);
    global.addEventListener('resize',position);document.addEventListener('scroll',()=>{if(popup)position();},{capture:true,passive:true});
  }
  global.PEDateFilters={resolve,today,shift,display,refresh:schedule,get isOpen(){return !!popup;}};
  if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();}
})(typeof window==='undefined'?globalThis:window);
