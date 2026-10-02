const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'/Users/dcor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.argv[2]||'http://127.0.0.1:8109',out=process.env.REPORT_DIR||'../reports/floating-panel-canary';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#v=2&country=USA&product=crude&mode=trade&direction=imports');await page.waitForFunction(()=>window.oilAtlas);
 async function clearCountry(){
  const boxes=await page.evaluate(()=>{const c=document.querySelector('#country-card').getBoundingClientRect();return {card:[c.left,c.top,c.right,c.bottom],country:oilAtlas.getSelectedBounds(),visible:getComputedStyle(document.querySelector('#country-card')).visibility!=='hidden',side:document.querySelector('#country-card').dataset.side,view:oilAtlas.getView(),count:oilAtlas.graph.flows.length};});
  const [a,b]=[boxes.card,boxes.country];const overlap=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));if(boxes.visible)assert.equal(overlap,0,JSON.stringify(boxes));assert.equal(boxes.count,706);return boxes;
 }
 let info=await clearCountry();assert.equal(info.side,'right');assert.deepEqual(info.view.translate,[720,450]);
 assert.equal(await page.locator('#map-settings').isVisible(),false);assert.equal(await page.locator('.search').isVisible(),false);assert.equal(await page.locator('.map-caption').isVisible(),false);
 const original=info.view;await page.locator('#collapse-card').click();assert.deepEqual((await clearCountry()).view,original);await page.locator('#collapse-card').click();assert.deepEqual((await clearCountry()).view,original);
 await page.screenshot({path:out+'/usa.png'});
 await page.locator('#sites-button').click();await clearCountry();for(let i=0;i<4;i++)await page.locator('#zoom-in').click();await clearCountry();if(await page.locator('#country-info').isVisible()){await page.locator('#country-info').click();assert.ok((await page.locator('#popup-content').innerText()).includes('США'));await page.locator('#close-popup').click();}await page.locator('#reset-map').click();await page.locator('#sites-button').click();
 await page.mouse.move(770,750);await page.mouse.down();await page.mouse.move(1290,750,{steps:8});await page.mouse.up();assert.equal((await clearCountry()).side,'left');
 await page.locator('#reset-map').click();assert.equal((await clearCountry()).side,'right');
 await page.locator('#search-toggle').click();await page.locator('#country-search').fill('FRA');await page.locator('[data-country="FRA"]').click();assert.equal((await clearCountry()).side,'left');await page.screenshot({path:out+'/france.png'});
 await page.locator('#filters-toggle').click();await page.locator('[data-product="lng"]').click();await page.keyboard.press('Escape');await page.reload();await page.waitForFunction(()=>window.oilAtlas);assert.equal(await page.evaluate(()=>oilAtlas.state.product),'lng');await clearCountry();assert.equal(await page.locator('#map-settings').isVisible(),false);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await clearCountry();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),844);await page.screenshot({path:out+'/mobile.png'});
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/result.json',JSON.stringify({status:'PASS',base,variants:['USA right','France left','country bounding rectangle clear','pan switches side','collapse no projection or transform change','full viewport centered projection','compact menu','commodity resume','mobile'],errors},null,2));await browser.close();console.log('PASS floating panel canary',base);
})().catch(e=>{console.error(e);process.exit(1)});
