/* Shared gross invoice values and disjoint receivable balances. */
(function(global){
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const round2=v=>Math.round((num(v)+Number.EPSILON)*100)/100;
  function metrics(i){
    const shared=global.PEAnnual?.metrics(i,global.PEAnnual.orderFor(i));
    const original=round2(i.invoice_amount),rawAdvance=round2(i.advance_amortisation);
    const invoiceBase=shared?.net??original;
    const vat=shared?.vat??round2(i.vat_amount??(i.invoice_total!=null?Math.max(0,num(i.invoice_total)-original):0));
    const invoiceTotal=shared?.total??round2(original+vat);
    const advance=shared?.advance??round2(rawAdvance*(original>0?invoiceTotal/original:1));
    const payableTotal=shared?.payableTotal??Math.max(0,round2(invoiceTotal-advance));
    const collected=shared?.collected??Math.min(payableTotal,Math.max(0,round2(num(i.paid_amount)+num(i.retention_released_amount))));
    const retentionAmount=round2(i.retention_amount);
    const retentionVat=round2(i.retention_vat);
    const retentionTotal=round2(i.retention_total ?? (retentionAmount+retentionVat));
    const retentionReleased=round2(i.retention_released_amount);
    const recordedRetention=Math.max(0,round2(i.retention_balance ?? (retentionTotal-retentionReleased)));
    const remaining=Math.max(0,round2(payableTotal-collected));
    const retentionBalance=shared?.retention??(String(i.status||'').trim().toUpperCase()==='RETENTION'?remaining:Math.min(recordedRetention,remaining));
    const badDebt=/^bad debits?$/i.test(String(i.status||'').trim()),writtenOff=badDebt?Math.max(0,round2(remaining-retentionBalance)):0;
    const outstanding=badDebt?0:shared?.balance??Math.max(0,round2(remaining-retentionBalance));
    const netPayable=Math.max(0,round2(payableTotal-retentionTotal));
    const dueDate=global.PEAnnual?.due(i)||(i.due_date?String(i.due_date).slice(0,10):null);
    const paymentStatus=badDebt?'Bad Debits':outstanding<=0.005?(retentionBalance>0.005?'Retention Only':'Paid'):(collected>0.005?'Partially Paid':'Unpaid');
    return {invoiceBase,advance,vat,invoiceTotal,total:invoiceTotal,payableTotal,collected,outstanding,balance:outstanding,retentionAmount,retentionVat,retentionTotal,retentionReleased,retentionBalance,netPayable,dueDate,paymentStatus,badDebt,writtenOff};
  }
  global.PEFinancialMetrics={metrics,number:num,round2};
})(window);


