const assert=require('assert'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),{setup}=require('./date-filters-browser.cjs');let browser;
(async()=>{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
for(const [file,id]of [['dashboard.html','invoiceStatus'],['reports.html','fInvoiceStatus'],['invoices.html','invoiceState']]){
const p=await browser.newPage();await setup(p);await p.goto('http://fixture.test/'+file);await p.waitForFunction(id=>Array.from(document.getElementById(id)?.options||[]).some(o=>o.value==='Bad Debits'),id);
assert.equal(await p.locator('#'+id+' option[value="Bad Debits"]').count(),1);
await p.locator('#'+id).selectOption('Bad Debits',{force:true});
if(file==='dashboard.html'){await p.waitForFunction(()=>testCalls.some(c=>c.name==='dashboard_summary_trial_v1'&&c.args.p_filters.invoiceStatus==='Bad Debits'));await p.evaluate(()=>loadSummary());}
else if(file==='reports.html')await p.waitForFunction(()=>document.getElementById('filterCount')?.textContent.includes('0 invoices'));
else await p.waitForFunction(()=>document.getElementById('invoiceState')?.value==='Bad Debits');
assert.equal(await p.locator('#'+id).inputValue(),'Bad Debits');assert.equal(await p.locator('#'+id+' option[value="Bad Debits"]').count(),1);assert.deepEqual(await p.evaluate(()=>testCalls.filter(c=>c.write)),[]);await p.close();console.log('PASS '+file+': Bad Debits available without matching records, selectable, unique, no data writes');
}await browser.close();})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exit(1);});
