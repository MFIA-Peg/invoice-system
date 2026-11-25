/* Keep the report title/tabs visible and reclaim filter space while reading. */
(function (global) {
  'use strict';
  function start() {
    const dock=document.querySelector('.report-control-dock'),panel=dock?.querySelector('.report-filter-panel'),header=document.querySelector('.report-top'),tabs=dock?.querySelector('.tabs');
    if(!dock||!panel||!header||!tabs)return;
    dock.prepend(header);header.after(tabs);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='report-icon-button report-filter-toggle';toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg>';toggle.setAttribute('aria-controls','reportFilterPanel');panel.id='reportFilterPanel';tabs.append(toggle);
    panel.setAttribute('aria-label','Report filters');
    let collapsed=false,lastY=scrollY,popupOpen=false,keyboard=false,showTimer,ignoreScrollUntil=0;
    function reveal(show) {
      if(!show&&(popupOpen||panel.contains(document.activeElement)&&keyboard))return;
      if(collapsed===!show)return;
      ignoreScrollUntil=performance.now()+300;
      collapsed=!show;panel.hidden=collapsed;dock.classList.toggle('report-filters-collapsed',collapsed);
      sync();global.PEFloatingHeaders?.refresh();
    }
    function sync(){toggle.title=collapsed?'Show filters':'Hide filters';toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-expanded',String(!collapsed));}
    sync();
    toggle.onclick=()=>reveal(collapsed);
    global.addEventListener('scroll',()=>{
      const y=scrollY;
      if(performance.now()<ignoreScrollUntil){lastY=y;return;}
      if(y<20)reveal(true);
      else if(y>lastY+3&&y>60)reveal(false);
      lastY=y;
    },{passive:true});
    document.addEventListener('pointermove',event=>{
      if(event.pointerType==='touch')return;
      const r=dock.getBoundingClientRect(),edge=tabs.getBoundingClientRect().bottom;
      if(collapsed&&event.clientY>=Math.max(0,r.top-12)&&event.clientY<=edge+5){
        if(!showTimer)showTimer=setTimeout(()=>{showTimer=null;reveal(true);},120);
      }else if(showTimer){clearTimeout(showTimer);showTimer=null;}
    },{passive:true});
    document.addEventListener('pointerdown',()=>{keyboard=false;});
    document.addEventListener('keydown',event=>{if(event.key==='Tab')keyboard=true;});
    panel.addEventListener('focusin',()=>reveal(true));
    tabs.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();reveal(true);panel.querySelector('input:not([hidden]):not(.pe-select-original),button:not([hidden])')?.focus();}});
    document.addEventListener('pe-date-popover-toggle',event=>{popupOpen=event.detail.open;if(popupOpen)reveal(true);});
    document.addEventListener('pe-date-filter-change',()=>global.PEFloatingHeaders?.refresh());
    global.PEReportDock={show:()=>reveal(true),hide:()=>reveal(false),get collapsed(){return collapsed;}};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
