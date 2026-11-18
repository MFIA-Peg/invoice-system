(function(global){
 'use strict';
 const basis=po=>po?.retention_basis==='before_vat'?'before_vat':'after_vat';
 const label=po=>basis(po)==='before_vat'?'Before VAT':'After VAT';
 const round=v=>Math.round((v+Number.EPSILON)*100)/100;
 function calculate(amount,po){
  const base=po?.retention_applicable?Math.max(0,Number(amount)||0)*Math.max(0,Math.min(100,Number(po.retention_percentage)||0))/100:0;
  const retentionAmount=round(base);
  const retentionVat=basis(po)==='after_vat'&&po?.vat===true?round(base*.15):0;
  return {amount:retentionAmount,vat:retentionVat,total:round(retentionAmount+retentionVat)};
 }
 global.PERetention={basis,label,calculate};
})(window);
