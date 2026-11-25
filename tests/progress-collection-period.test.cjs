const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-25T09:00:00Z']));}}
(async()=>{for(const source of ['dashboard-context.js','dashboard-trial-context.js']){
const c={Date:Clock,Intl,URLSearchParams,location:{search:''},document:{getElementById(){return null;},addEventListener(){}}};c.window=c;vm.createContext(c);
for(const f of ['annual-analytics.js',source])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
const base={status:'Approved',invoice_amount:1000,paid_amount:600,approval_date:'2025-01-01',payment_terms:30,start_date:'2025-01-01',po_no:'P',pos_id:1};
const records={projects:[{id:1,project_name:'A',company:'C',department:'D'}],pos:[{id:1,project_id:1,po_no:'P',company:'C',department:'D',vat:false}],invoices:[{...base,id:1},{...base,id:2,status:'Bad Debits'},{...base,id:3,status:'Canceled'},{...base,id:4,due_date:'2026-12-31',approval_date:'2026-12-01'}],invoice_collections:[{id:1,invoice_id:1,collection_date:'2025-04-01',amount:100},{id:2,invoice_id:1,collection_date:'2026-04-01',amount:200},{id:3,invoice_id:1,collection_date:'2026-09-01',amount:300},{id:4,invoice_id:2,collection_date:'2026-04-01',amount:99},{id:5,invoice_id:3,collection_date:'2026-04-01',amount:88},{id:6,invoice_id:4,collection_date:'2026-04-01',amount:77}],po_advance_payments:[]};
await c.PEAnnual.load({from:t=>({select:()=>({order:()=>({range:async(a,b)=>({data:records[t].slice(a,b+1)})})})})});
const A=c.PEAnnual,C=c.PEDashboardContext,pick=(filters,metric)=>C.select(C.derive(A.records(),filters),metric);
assert.equal(pick({},'Due Invoice Collected').amount,500);assert.equal(pick({},'Due Invoice Overdue').amount,400);
assert.equal(pick({from:'2025-01-01',to:'2025-12-31'},'Due Invoice Collected').amount,100);
assert.equal(pick({from:'2026-03-01',to:'2026-05-01'},'Due Invoice Collected').amount,200);
assert.equal(pick({dueFrom:'2025-01-01',dueTo:'2025-12-31'},'Due Invoice Collected').amount,500);
assert.equal(pick({paymentStatus:'Overdue',from:'2026-01-01',to:'2026-12-31'},'Due Invoice Collected').amount,500);
assert.equal(pick({company:'Other'},'Due Invoice Collected').amount,0);
assert.equal(pick({from:'2026-01-01',to:'2026-12-31'},'Due Invoice Overdue').amount,0);
assert.deepEqual(Array.from(pick({},'Due Invoice Collected').receipts,r=>r.id),[2,3]);
console.log('PASS '+source+': current-year actual receipts include old invoices; explicit receipt periods and due-date filters intersect correctly; overdue retains old balances; Bad Debits, canceled and not-yet-due invoices excluded');
}})().catch(e=>{console.error(e);process.exit(1);});
