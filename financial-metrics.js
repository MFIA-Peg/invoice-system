/* Power Energy shared invoice financial calculations — approved policy B. */
(function(global){
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const round2=v=>Math.round((num(v)+Number.EPSILON)*100)/100;
  function metrics(i){
    const original=round2(i.invoice_amount);
    const advance=round2(i.advance_amortisation);
    const invoiceBase=round2(i.net_invoice_amount ?? Math.max(0,original-advance));
    const vat=round2(i.vat_after_advance ?? i.vat_amount);
    const invoiceTotal=round2(i.invoice_total_after_advance ?? (invoiceBase+vat));
    const collected=round2(i.paid_amount);
    const outstanding=Math.max(0,round2(invoiceTotal-collected));
    const retentionAmount=round2(i.retention_amount);
    const retentionVat=round2(i.retention_vat);
    const retentionTotal=round2(i.retention_total ?? (retentionAmount+retentionVat));
    const retentionReleased=round2(i.retention_released_amount);
    const retentionBalance=Math.max(0,round2(i.retention_balance ?? (retentionTotal-retentionReleased)));
    const netPayable=Math.max(0,round2(i.net_payable_after_advance ?? (invoiceTotal-retentionTotal)));
    const dueDate=i.due_date ? String(i.due_date).slice(0,10) : null;
    const paymentStatus=outstanding<=0.005?'Paid':(collected>0.005?'Partially Paid':'Unpaid');
    return {invoiceBase,advance,vat,invoiceTotal,total:invoiceTotal,collected,outstanding,balance:outstanding,retentionAmount,retentionVat,retentionTotal,retentionReleased,retentionBalance,netPayable,dueDate,paymentStatus};
  }
  global.PEFinancialMetrics={metrics,number:num,round2};
})(window);
