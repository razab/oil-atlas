const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'/Users/dcor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.argv[2]||'http://127.0.0.1:8765',out=process.env.REPORT_DIR||'../reports/trade-direction-canary';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const open=async(country,product,extra='')=>{await page.goto(base+`/?version=7&case=${country}-${product}${extra}#v=2&country=${country}&product=${product}&mode=trade&direction=both&sites=0&all=0`);await page.waitForFunction(()=>window.oilAtlas);};
 async function select(code){await page.click('#search-toggle');await page.fill('#country-search',code);await page.click(`[data-country="${code}"]`);}
 async function product(code){await page.click('#filters-toggle');await page.click(`[data-product="${code}"]`);await page.keyboard.press('Escape');}
 async function edge(origin,destination,prod,expected){
  const result=await page.evaluate(({origin,destination,prod})=>{
   const f=oilAtlas.visibleFlows.find(f=>f.origin===origin&&f.destination===destination&&f.product===prod);if(!f)return null;
   const el=[...document.querySelectorAll('path.edge')].find(el=>el.dataset.flow===f.id),start=el.getPointAtLength(0),end=el.getPointAtLength(el.getTotalLength());
   return {f,d:el.getAttribute('d'),marker:el.getAttribute('marker-mid'),start:[start.x,start.y],end:[end.x,end.y],expectedStart:point(origin),expectedEnd:point(destination),legend:document.querySelector('#legend').textContent};
  },{origin,destination,prod});assert.ok(result,`${origin} → ${destination} missing`);assert.ok(Math.abs(result.f.value-expected)<1e-9);
  for(const [actual,wanted] of [[result.start,result.expectedStart],[result.end,result.expectedEnd]])assert.ok(Math.hypot(actual[0]-wanted[0],actual[1]-wanted[1])<.001);
  const country=await page.evaluate(()=>oilAtlas.state.country);assert.equal(result.marker,`url(#arrow-${destination===country?'imports':'exports'})`);assert.match(result.legend,/Импорт/);assert.match(result.legend,/Экспорт/);return result;
 }
 await open('CAN','lng');const peru=await edge('PER','CAN','lng',.2237849971157331),usa=await edge('USA','CAN','lng',.004366004309122582);
 assert.match(await page.locator('[data-partner="PER"]').textContent(),/Перу → Канада/);assert.match(await page.locator('[data-partner="PER"]').textContent(),/СПГ/);assert.match(await page.locator('[data-partner="USA"]').textContent(),/млн м³\/год/);
 assert.match(await page.locator('#coverage-note').innerText(),/не выделен отдельным столбцом/);
 await page.click('[data-partner="USA"]');assert.match(await page.locator('#popup-content h2').innerText(),/США → Канада/);assert.match(await page.locator('#popup-content').innerText(),/Импорт/);await page.click('.jump');
 assert.equal(await page.evaluate(()=>oilAtlas.state.country),'USA');assert.equal(await page.evaluate(()=>oilAtlas.state.partner),'CAN');const reverseFocus=await edge('USA','CAN','lng',.004366004309122582);assert.equal(reverseFocus.d,usa.d);
 await page.reload();await page.waitForFunction(()=>window.oilAtlas);await edge('USA','CAN','lng',.004366004309122582);
 await select('CAN');await page.click('[data-partner="PER"]');await page.click('.jump');assert.equal(await page.evaluate(()=>oilAtlas.state.country),'PER');const peruvian=await edge('PER','CAN','lng',.2237849971157331);assert.equal(peruvian.d,peru.d);assert.match(await page.locator('[data-partner="CAN"]').textContent(),/Перу → Канада/);
 await select('CAN');await product('pipeline');const outflow=await edge('CAN','USA','pipeline',87.242408154748),inflow=await edge('USA','CAN','pipeline',28.170707799031874);
 const separation=await page.evaluate(()=>{const pair=[...document.querySelectorAll('path.edge')].filter(p=>[p.dataset.origin,p.dataset.destination].includes('CAN')&&[p.dataset.origin,p.dataset.destination].includes('USA'));const points=pair.map(p=>p.getPointAtLength(p.getTotalLength()/2));return Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);});assert.ok(separation>2);
 assert.equal(await page.locator('.country[data-iso="USA"]').getAttribute('fill'),'url(#trade-both-country)');assert.equal(await page.locator('[data-partner="USA"] .flow-row').count(),2);
 await page.locator(`.flow-row[data-flow="${inflow.f.id}"]`).click();assert.match(await page.locator('#popup-content h2').innerText(),/США → Канада/);await page.click('#close-popup');
 await page.locator(`.flow-row[data-flow="${outflow.f.id}"]`).press('Enter');assert.match(await page.locator('#popup-content h2').innerText(),/Канада → США/);await page.click('#close-popup');
 await page.screenshot({path:out+'/canada-pipeline.png'});
 await product('crude');await edge('CAN','USA','crude',1427229/365);await edge('USA','CAN','crude',138018/365);
 await select('EGY');await product('lng');await edge('USA','EGY','lng',11.661222515431277);
 await open('USA','lng','&fresh=1');const visible=await page.evaluate(()=>oilAtlas.visibleFlows);assert.ok(visible.some(f=>f.destination==='USA'));assert.ok(visible.some(f=>f.origin==='USA'));assert.match(await page.locator('#coverage-note').innerText(),/На карте/);
 await open('CAN','lng','&screenshot=1');await page.screenshot({path:out+'/canada-lng.png'});
 await page.setViewportSize({width:390,height:844});await page.reload();await page.waitForFunction(()=>window.oilAtlas);await edge('PER','CAN','lng',.2237849971157331);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);await page.screenshot({path:out+'/mobile.png'});
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/result.json',JSON.stringify({status:'PASS',base,variants:['source/destination endpoints','Canada LNG import from Peru and USA','absolute route and fuel labels','small volume readable','bilateral context survives jump and reload','both directions represented','separate reverse curves','independent rows for reverse flows','both-direction country color','crude reciprocal trade','Egypt LNG import','mobile'],errors},null,2));await browser.close();console.log('PASS directed trade canary',base);
})().catch(e=>{console.error(e);process.exit(1)});
