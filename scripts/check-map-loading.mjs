import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base=process.env.DEMO_URL||'http://127.0.0.1:3000';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:960}});
 const page=await context.newPage();
 const requests=[];
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 context.on('response',response=>{
  const path=new URL(response.url()).pathname;
  if(path.endsWith('.geojson')||path.endsWith('.pbf')){
   requests.push({path,status:response.status(),bytes:Number(response.headers()['content-length']||0)});
  }
 });
 const started=Date.now();
 await page.goto(base);
 await page.waitForFunction(()=>window.demoMap?.isStyleLoaded(),{},{timeout:60000});
 await page.waitForFunction(()=>window.demoMap?.loaded(),{},{timeout:60000});
 const milliseconds=Date.now()-started;
 const initialRequests=requests.slice();
 const bytes=initialRequests.reduce((total,request)=>total+request.bytes,0);
 assert.ok(bytes>0,'No completed map data requests');
 assert.ok(requests.every(request=>request.status===200||request.status===204),'Failed map data request');
 assert.deepEqual(errors,[]);
 if(process.env.EXPECT_VECTOR){
  assert.ok(requests.every(request=>request.path.endsWith('.pbf')),'Base map still downloads GeoJSON');
  assert.ok(bytes<1_000_000,`Initial map data exceeds 1 MB: ${bytes}`);
  assert.ok(await page.evaluate(()=>window.demoMap.queryRenderedFeatures({layers:['land']}).length>0),'Land did not render');
  await page.evaluate(()=>window.demoMap.jumpTo({center:[127.6843,26.2144],zoom:15}));
  await page.waitForFunction(()=>window.demoMap.loaded(),{},{timeout:60000});
  assert.ok(await page.evaluate(()=>window.demoMap.queryRenderedFeatures({layers:['roads']}).length>50),'Detailed roads did not render');
  await page.evaluate(()=>window.demoMap.jumpTo({center:[127.7192,26.2170],zoom:17}));
  await page.waitForFunction(()=>window.demoMap.loaded(),{},{timeout:60000});
  assert.ok(await page.evaluate(()=>window.demoMap.queryRenderedFeatures({layers:['roads']}).length>0),'Overzoomed roads did not render');
  assert.deepEqual(errors,[]);
 }
 console.log(JSON.stringify({milliseconds,mapDataBytes:bytes,mapRequests:initialRequests.length,requests:initialRequests},null,2));
}finally{
 await browser.close();
}
