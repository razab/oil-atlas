const {chromium}=require('/Users/dcor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:900}}),base=process.env.BASE_URL||'http://127.0.0.1:8765/',canary=process.env.SCOPE!=='full';
 await page.goto(base+'validation.html'+(canary?'?canary=1':''));await page.waitForFunction(()=>window.atlasValidation);
 const report=await page.evaluate(()=>atlasValidation.validation.summary);assert.equal(report.unmappedPositiveFlows,0);assert.ok(report.reconciliations>=16);
 await page.fill('#search','RUS');await page.click('button.record');assert.equal(await page.locator('#record-detail').isVisible(),true);
 await page.goto(base+(canary?'?audit=canary':'?version=5')+'#v=2&country=RUS&product=lng&mode=trade&direction=exports&all=1');await page.waitForFunction(()=>window.oilAtlas);
 const flows=await page.evaluate(()=>oilAtlas.visibleFlows);assert.equal(flows.length,10);assert.ok(Math.abs(flows.reduce((s,f)=>s+f.value,0)-42.56305480406593)<1e-8);
 await page.reload();await page.waitForFunction(()=>window.oilAtlas);assert.equal(await page.locator('.edge-hit').count(),10);
 await page.route('**/data/'+(canary?'validation-canary':'validated')+'/*.json',async route=>{
  if(route.request().url().endsWith('/manifest.json'))return route.continue();
  return route.fulfill({status:200,body:'{}',contentType:'application/json'});
 });
 await page.reload();await page.waitForSelector('#error-message:not([hidden])');assert.equal(await page.locator('.country').count(),0);assert.match(await page.locator('#error-message').textContent(),/повреждены/);
 await page.unrouteAll();await page.goto(base+'validation.html'+(canary?'?canary=1':''));await page.waitForFunction(()=>window.atlasValidation);
 console.log(JSON.stringify({scope:canary?'canary':'full',report,russiaExports:flows.length,corruptBundleBlocked:true,persistedReload:true,url:base}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
