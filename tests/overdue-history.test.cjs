const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const records=structuredClone(require('./date-filter-fixture.cjs'));records.invoices.push({...records.invoices[0],id:81,invoice_no:'OLD',start_date:'2025-12-01',approval_date:'2025-12-01',due_date:'2025-12-20'});
records.invoices.push({...records.invoices[0],id:82,invoice_no:'PAID-OLD',start_date:'2025-12-01',approval_date:'2025-12-01',due_date:'2025-12-20',paid_amount:115});
records.invoices.push({...records.invoices[0],id:83,invoice_no:'CANCELED-OLD',status:'Canceled',start_date:'2025-12-01',approval_date:'2025-12-01',due_date:'2025-12-20'});
class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-25T09:00:00Z']));}}
const c={Intl,Date:Clock,URLSearchParams,document:{getElementById(){return null;},addEventListener(){}},location:{search:''}};c.window=c;vm.createContext(c);for(const file of ['annual-analytics.js','dashboard-context.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
(async()=>{
 await c.PEAnnual.load({from:t=>({select:()=>({order:()=>({range:async(a,b)=>({data:records[t].slice(a,b+1)})})})})});
 const A=c.PEAnnual,C=c.PEDashboardContext,loaded=A.records(),pick=(f,m)=>C.select(C.derive(loaded,f),m),ids=s=>Array.from(s.invoices,i=>i.id);
 assert(ids(pick({},'Due Invoice Overdue')).includes(81));assert(!ids(pick({},'Due Invoice Overdue')).includes(82));assert(!ids(pick({},'Due Invoice Overdue')).includes(83));
 assert(ids(pick({},'Overdue')).includes(81));assert(ids(pick({paymentStatus:'Overdue'},'Overdue')).includes(81));assert.equal(C.metricFor({paymentStatus:'Overdue'}),'overdue');
 assert(!ids(pick({from:'2026-01-01',to:'2026-12-31'},'Due Invoice Overdue')).includes(81));
 assert(!ids(pick({from:'2026-01-01',to:'2026-12-31'},'Overdue')).includes(81));
 assert.deepEqual(ids(pick({dueFrom:'2025-01-01',dueTo:'2025-12-31'},'Due Invoice Overdue')),[81]);
 assert(!ids(pick({attention:'overdue',from:'2026-01-01',to:'2026-12-31'},'Overdue')).includes(81));
 assert.equal(A.snapshot({profile:'invoices'}).totals.overdueToDate,81*115);
 assert.equal(A.snapshot({profile:'invoices',periodFrom:'2026-01-01',periodTo:'2026-12-31'}).totals.overdueToDate,80*115);
 assert.equal(A.snapshot({profile:'invoices'}).totals.overdue,81*115);
 console.log('PASS: previous-year overdue included by default in reports, donut details and totals; explicit period/due dates restrict history; paid and canceled invoices excluded');
})().catch(e=>{console.error(e);process.exit(1);});
