import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.DEMO_URL||'http://127.0.0.1:3000';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960}});const errors=[],remote=[],bad=[];
context.on('request',r=>{if(r.url().startsWith('http')&&new URL(r.url()).origin!==new URL(base).origin)remote.push(r.url());});
context.on('response',r=>{if(r.status()>=400)bad.push(`${r.status()} ${r.url()}`);});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function ready(){await page.waitForFunction(()=>document.querySelector('#route-summary').textContent.startsWith('約')&&document.querySelectorAll('#comparison button').length===3&&![...document.querySelectorAll('#comparison button')].some(b=>b.textContent.includes('計算中')),{},{timeout:60000});}
try{
 await page.goto(base);await page.waitForFunction(()=>window.demoMap?.loaded(),{},{timeout:60000});await ready();assert.equal(await page.locator('#itinerary li').count(),3);assert.equal(await page.locator('#legs>div').count(),2);assert.ok(await page.evaluate(()=>window.routeFeatureCount===2));
 await page.locator('[data-mode="walk"]').click();await ready();assert.equal(await page.locator('[data-mode="walk"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-mode="bike"]').click();await ready();await page.locator('[data-mode="car"]').click();
 await page.locator('#search').fill('美國');await page.waitForFunction(()=>document.getElementById('result-count').textContent.includes('個結果'));await page.getByRole('button',{name:'加入 美國村',exact:true}).click();await ready();assert.equal(await page.locator('#itinerary li').count(),4);
 await page.getByRole('button',{name:'上移 美國村',exact:true}).click();await ready();assert.ok((await page.locator('#itinerary li').nth(2).textContent()).includes('美國村'));
 await page.getByRole('button',{name:'移除 美國村',exact:true}).click();await ready();
 console.log('Checking styles');await page.locator('#dark').click();await page.waitForFunction(()=>window.demoMap.isStyleLoaded()&&window.demoMap.getLayer('route-line'));assert.equal(await page.evaluate(()=>window.demoMap.getPaintProperty('sea','background-color')),'#193e49');await page.locator('#light').click();await page.waitForFunction(()=>window.demoMap.isStyleLoaded());
 console.log('Checking custom points');await page.locator('#fit-trip').click();await page.waitForFunction(()=>!window.demoMap.isMoving());await page.locator('#map').click({position:{x:450,y:350}});assert.ok(await page.locator('#add-dialog').isVisible());await page.locator('#custom-name').fill('測試住宿');await page.locator('#add-form [type="submit"]').click();assert.equal(await page.locator('#itinerary li').count(),4);await page.getByRole('button',{name:'移除 測試住宿',exact:true}).click();await ready();
 await page.reload();await ready();assert.equal(await page.locator('#itinerary li').count(),3);await page.locator('#search').fill('');console.log('Checking custom points');await page.locator('#fit-trip').click();await page.waitForFunction(()=>!window.demoMap.isMoving());await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>{document.activeElement.blur();document.querySelector('.sidebar').scrollTop=0;});await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/okinawa-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>window.demoMap.loaded());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:'artifacts/okinawa-mobile.png',fullPage:true});
 await page.locator('#clear-trip').click();assert.equal(await page.locator('#itinerary li').count(),0);assert.equal(await page.locator('#route-summary').textContent(),'請加入至少兩個地點');assert.equal(await page.evaluate(()=>window.routeFeatureCount),0);
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.deepEqual(bad,[]);console.log('PASS: Okinawa map, 3 travel modes, road routes, multi-stop add/remove/reorder, custom points, persistence, styles, mobile; no remote requests/errors.');
}finally{await browser.close();}
