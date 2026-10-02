const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'/Users/dcor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.argv[2]||'http://127.0.0.1:8765',out=process.env.REPORT_DIR||'../reports/country-view-canary';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?version=6#v=2&country=USA&product=lng&mode=trade&direction=both&sites=0&all=0');await page.waitForFunction(()=>window.oilAtlas);
 const view=()=>page.evaluate(()=>oilAtlas.getView());
 await page.click('#zoom-in');await page.mouse.move(760,750);await page.mouse.down();await page.mouse.move(850,710,{steps:8});await page.mouse.up();
 const before=await view();assert.ok(before.k>1);assert.ok(before.x!==0&&before.y!==0);
 // Search, partner jump, and country map hit all share country selection.
 await page.click('#search-toggle');await page.fill('#country-search','FRA');await page.click('[data-country="FRA"]');assert.equal(await page.evaluate(()=>oilAtlas.state.country),'FRA');assert.deepEqual(await view(),before);
 await page.click('[data-partner="USA"]');await page.click('.jump');assert.equal(await page.evaluate(()=>oilAtlas.state.country),'USA');assert.deepEqual(await view(),before);
 await page.locator('.country[data-iso="CAN"]').evaluate(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await page.evaluate(()=>oilAtlas.state.country),'CAN');assert.deepEqual(await view(),before);
 await page.click('#reset-map');assert.equal((await view()).k,1);assert.equal((await view()).x,0);assert.equal((await view()).y,0);
 // Leaving a domestic drilldown via country selection also retains the view.
 await page.evaluate(()=>oilAtlas.selectCountry('USA'));await page.click('#sites-button');const domestic=await view();assert.ok(domestic.k>3);
 await page.click('#search-toggle');await page.fill('#country-search','FRA');await page.click('[data-country="FRA"]');assert.equal(await page.evaluate(()=>oilAtlas.state.sites),false);assert.deepEqual(await view(),domestic);
 await page.click('#filters-toggle');await page.click('#world-button');assert.equal((await view()).k,1);await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await page.click('#zoom-in');const mobile=await view();await page.click('#search-toggle');await page.fill('#country-search','USA');await page.click('[data-country="USA"]');assert.deepEqual(await view(),mobile);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/result.json',JSON.stringify({status:'PASS',base,before,domestic,mobile,variants:['search preserves pan and zoom','partner jump preserves view','map selection preserves view','explicit reset works','drilldown selection preserves view','world button works','mobile selection preserves view'],errors},null,2));await browser.close();console.log('PASS country selection preserves view',base);
})().catch(e=>{console.error(e);process.exit(1)});
