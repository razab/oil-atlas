const {chromium}=require('/Users/dcor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.BASE_URL||'http://127.0.0.1:8765/',scope=process.env.SCOPE||'canary';
const dir=process.env.REPORT_DIR||'../reports/coverage-probe';fs.mkdirSync(dir,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const open=async(country,product)=>{await page.goto(`${base}?audit=${scope}&coverage=${country}-${product}#v=2&country=${country}&product=${product}&mode=trade&direction=imports&sites=0&all=1`);await page.locator('.selected-country-label').waitFor();};
 await open('EGY','crude');
 const egypt=await page.evaluate(()=>({flows:selectedFlows('imports').filter(f=>f.owner==='EGY'),card:document.querySelector('#country-details').textContent,coverage:document.querySelector('#coverage-note').textContent}));
 assert.deepEqual(egypt.flows.map(f=>f.origin).sort(),['KWT','SAU','USA']);
 assert.ok(egypt.flows.every(f=>f.destination==='EGY'&&f.unit==='Mt'&&f.year===2025&&f.estimated));
 assert.ok(Math.abs(egypt.flows.reduce((a,f)=>a+f.value,0)-2.725804964492)<1e-9);
 assert.ok(!egypt.card.includes('Спрос на нефтяные жидкости'));assert.ok(egypt.coverage.includes('100%'));
 await page.evaluate(()=>showEdge(selectedFlows('imports').find(f=>f.owner==='EGY')));
 assert.ok((await page.locator('#detail-popup').textContent()).includes('≈'));
 await page.locator('#close-popup').click();await page.screenshot({path:`${dir}/egypt-${scope}.png`});
 await page.locator('#sites-button').click();await page.locator('[data-site="midor"]').click();
 const refinery=await page.locator('#detail-popup').textContent();assert.ok(refinery.includes('160'));assert.ok(refinery.includes('проектная мощность'));
 await open('EGY','gasoline');
 const partial=await page.evaluate(()=>({d:graph.domestic.EGY.gasoline,t:graph.tradeCoverage['EGY:gasoline:imports'],text:document.querySelector('#country-details').textContent}));
 assert.equal(partial.d.unit,'MtPeriod');assert.equal(partial.t.period,'2025-01/2025-08');assert.equal(partial.t.total,1.932);assert.ok(partial.text.includes('8 месяцев'));assert.ok(partial.text.includes('янв–авг'));
 await open('MDA','gasoline');
 const moldova=await page.evaluate(()=>({flows:selectedFlows('imports').filter(f=>f.owner==='MDA'),d:graph.domestic.MDA.gasoline,coverage:document.querySelector('#coverage-note').textContent}));
 assert.equal(moldova.flows.length,2);assert.deepEqual(moldova.flows.map(f=>f.origin).sort(),['BGR','ROU']);
 assert.ok(Math.abs(moldova.d.consumption-.21020296)<1e-10);assert.equal(moldova.d.production,null);assert.equal(moldova.d.unit,'Mt');
 await page.screenshot({path:`${dir}/moldova-${scope}.png`});
 if(scope==='full'){
  await open('DEU','crude');assert.ok(await page.evaluate(()=>selectedFlows('imports').filter(f=>f.owner==='DEU').length===6));
  await open('DEU','gasoline');assert.ok(await page.evaluate(()=>graph.totals['DEU:gasoline:imports']>2&&graph.domestic.DEU.gasoline.consumption===null));
  await open('EGY','refined');assert.ok(await page.evaluate(()=>graph.tradeCoverage['EGY:refined:imports'].total===11.895));
  const stats=await page.locator('#country-details').textContent();assert.ok(!stats.includes('Спрос на нефтяные жидкости'));
  await page.screenshot({path:`${dir}/egypt-refined.png`});
  await open('MDA','diesel');assert.ok(await page.evaluate(()=>selectedFlows('imports').filter(f=>f.owner==='MDA').length===11));
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/ui-${scope}.json`,JSON.stringify({base,scope,egypt,moldova,errors},null,2));await browser.close();console.log('PASS national coverage',base,scope);
})().catch(e=>{console.error(e);process.exit(1)});
