import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.DEMO_URL||'http://127.0.0.1:3000';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960}});
const page=await context.newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function search(term){await page.locator('#search').fill(term);await page.waitForFunction(()=>document.querySelector('#result-count').textContent.includes('個結果'))}
try{
 await page.goto(base);await page.waitForFunction(()=>window.demoMap?.loaded(),{},{timeout:60000});
 await search('中本天婦羅');assert.equal(await page.locator('#places .place').count(),1);assert.ok((await page.locator('#places').textContent()).includes('中本てんぷら店'));assert.equal(await page.locator('#places .osm-source').getAttribute('href'),'https://www.openstreetmap.org/node/1995215770');
 await page.getByRole('button',{name:'加入 中本てんぷら店',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#route-summary').textContent.startsWith('約'),{},{timeout:60000});assert.equal(await page.locator('#itinerary li').count(),4);
 await search('波上城');assert.ok((await page.locator('#search-note').textContent()).includes('是否指「波上宮」'));assert.ok((await page.locator('#places .place').first().textContent()).includes('波上宮'));await page.getByRole('button',{name:'加入 波上宮',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#route-summary').textContent.startsWith('約'),{},{timeout:60000});assert.equal(await page.locator('#itinerary li').count(),5);
 await page.getByRole('button',{name:'移除 中本てんぷら店',exact:true}).click();await page.getByRole('button',{name:'移除 波上宮',exact:true}).click();
 await page.locator('#search').fill('中本');await page.locator('#search').fill('波上宮');await page.waitForFunction(()=>document.querySelector('#result-count').textContent.includes('個結果'));assert.ok(!(await page.locator('#places').textContent()).includes('中本'));
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS: real restaurant and shrine search, Chinese alias/suggestion, OSM source links, add to itinerary and road routing, stale-search cancellation, mobile.');
}finally{await browser.close()}
