/* Compatibility entry point: the seven shared financial cards replace donuts. */
(function(global){
  'use strict';
  function kpis(snapshot,rows=[],filters={}){
    const recordIds=rows.map(row=>(row.i||row).id).filter(id=>id!=null);
    return PEAnnual.render('kpis',null,{
      invoiceIds:recordIds,
      periodFrom:filters.from||'',periodTo:filters.to||''
    });
  }
  global.PEDashboardDonuts={kpis};
})(window);
