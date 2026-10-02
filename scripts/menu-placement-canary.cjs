const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'/Users/dcor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.argv[2]||'http://127.0.0.1:8765',out=process.env.REPORT_DIR||'../reports/menu-placement-canary';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[];let nonce=0;page.on('pageerror',e=>errors.push(e.message));
 async function open(country){await page.goto(base+`/?version=8&case=${++nonce}#v=2&country=${country}&product=crude&mode=trade&direction=both&sites=0&all=0`);await page.waitForFunction(()=>window.oilAtlas);}
 async function clear(){
  const boxes=await page.evaluate(()=>{
   const box=el=>{const r=el.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];};
   const card=document.querySelector('#country-card');
   const overlaps=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
   const cardBox=box(card),blockers=['#map-settings','.search','#search-results','#detail-popup','.zoom-controls'].map(s=>document.querySelector(s)).filter(el=>!el.hidden&&el.getClientRects().length).map(box);
   return {visible:getComputedStyle(card).visibility!=='hidden',countryOverlap:overlaps(cardBox,oilAtlas.getSelectedBounds()),uiOverlap:blockers.map(b=>overlaps(cardBox,b)),width:document.documentElement.scrollWidth,viewport:innerWidth};
  });if(boxes.visible){assert.equal(boxes.countryOverlap,0,JSON.stringify(boxes));assert.ok(boxes.uiOverlap.every(n=>n===0),JSON.stringify(boxes));}assert.equal(boxes.width,boxes.viewport);return boxes;
 }
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(viewport);
  for(const country of ['FRA','USA','CAN']){
   await open(country);const view=await page.evaluate(()=>oilAtlas.getView());
   await page.click('#filters-toggle');assert.equal(await page.locator('#map-settings').isVisible(),true);await clear();assert.deepEqual(await page.evaluate(()=>oilAtlas.getView()),view);
   await page.screenshot({path:`${out}/${country}-${viewport.width}-menu.png`});
   await page.keyboard.press('Escape');await clear();assert.equal(await page.locator('#map-settings').isVisible(),false);
   await page.click('#filters-toggle');await page.click('[data-product="gasoline"]');assert.equal(await page.locator('#map-settings').isVisible(),false);assert.equal(await page.locator('#filters-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>oilAtlas.state.product),'gasoline');await clear();
   await page.click('#search-toggle');await page.fill('#country-search','a');await clear();await page.keyboard.press('Escape');await clear();
   checks.push({country,viewport});
  }
 }
 await page.setViewportSize({width:1440,height:900});await open('FRA');await page.click('#filters-toggle');await page.click('[data-partner="USA"]');assert.equal(await page.locator('#detail-popup').isVisible(),true);assert.equal(await page.locator('#map-settings').isVisible(),false);await clear();
 await page.click('#filters-toggle');assert.equal(await page.locator('#detail-popup').isVisible(),false);await clear();await page.click('[data-product="lng"]');await page.reload();await page.waitForFunction(()=>window.oilAtlas);assert.equal(await page.evaluate(()=>oilAtlas.state.product),'lng');assert.equal(await page.locator('#map-settings').isVisible(),false);await clear();
 await page.click('#filters-toggle');await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await clear();assert.equal(await page.locator('#map-settings').isVisible(),true);await page.click('#filters-toggle');await clear();
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/result.json',JSON.stringify({status:'PASS',base,checks,variants:['menu clears country card and selected country','opening menu preserves map view','fuel selection closes menu','search results clear country card','detail popup and menu mutually exclusive','resize with menu open','reload preserves product and closed menu'],errors},null,2));await browser.close();console.log('PASS menu placement canary',base);
})().catch(e=>{console.error(e);process.exit(1)});
