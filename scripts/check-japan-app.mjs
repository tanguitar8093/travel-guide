// Manual real-app check. Credentials stay in process memory; test records use a fresh browser's IndexedDB.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const full=process.env.JAPAN_FULL_CHECK==='1';
const base=process.env.JAPAN_APP_URL||'http://127.0.0.1:4180';
const output=process.env.JAPAN_CHECK_OUTPUT||'/tmp/travel-japan-app';
await mkdir(output,{recursive:true});
const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await client.auth.signInWithPassword({email:process.env.E2E_A_EMAIL,password:process.env.E2E_A_PASSWORD});
assert(!error,'Configured test account must authenticate');
const original=data.user.user_metadata?.tripmap_osm_dataset;
const role=await client.from('user_roles').select('role').eq('user_id',data.user.id).single();
assert.equal(role.data?.role,'admin','Use the configured administrator test account for IndexedDB isolation');
const authKey=`sb-${new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(({authKey,session})=>{
 if(!localStorage.getItem(authKey))localStorage.setItem(authKey,JSON.stringify(session));
 localStorage.setItem('travel-planner-database-mode','indexeddb');
 localStorage.setItem('travel-planner:map-provider','osm');
 if(!localStorage.getItem('travel-planner:osm-dataset'))localStorage.setItem('travel-planner:osm-dataset','japan');
}, {authKey,session:data.session});
const page=await context.newPage();
const errors=[],mapRouteRequests=[];
page.on('request',request=>{if(request.url().includes('/api/route'))mapRouteRequests.push(new URL(request.url()).pathname)});
page.on('pageerror',e=>errors.push(e.message));
let cloudDataWrites=0;
await context.route('**/rest/v1/**',route=>{
 const request=route.request();
 const rpc=new URL(request.url()).pathname.split('/').at(-1);
 const action=request.postDataJSON()?.p_action;
 const readOnly = ['app_sync_snapshot','app_sync_pull'].includes(rpc) || (rpc==='app_trip_collaboration_v2' && ['list','snapshot','details'].includes(action)) || (rpc==='app_shared_trip' && action==='snapshot') || (rpc==='app_public_itinerary' && ['list','source','get','pull'].includes(action));
 if(['POST','PATCH','DELETE','PUT'].includes(request.method())&&!readOnly){
  cloudDataWrites++;console.log('Blocked cloud mutation:',rpc,action??'');return route.abort();
 }
 return route.continue();
});
try{
 await page.goto(base+'/regions');
 await page.getByRole('button',{name:/日本.*個行程/}).waitFor({timeout:60000});
 await page.getByRole('button',{name:/日本.*個行程/}).click();
 await page.waitForFunction(()=>localStorage.getItem('travel-planner:osm-dataset')==='japan');
 const createPlace=async(name,coordinate)=>{
   await page.locator('button.primary-button').first().click();
   await page.locator('.google-autocomplete input').fill(coordinate);
   await page.getByRole('option').first().click();
   await page.getByPlaceholder('例如：首里城').fill(name);
   await page.getByRole('button',{name:'建立地點',exact:true}).first().click();
   await page.getByText(name,{exact:true}).first().waitFor();
 };
 const selectDataset=async(name)=>{
   await page.goto(base+'/regions');
   await page.getByRole('button',{name:new RegExp(name+'.*個行程')}).click();
   await page.waitForFunction(expected=>localStorage.getItem('travel-planner:osm-dataset')===expected&&!Object.keys(localStorage).some(key=>key.startsWith('travel-planner:osm-dataset-pending:')),{'沖繩':'okinawa','台灣':'taiwan','日本':'japan'}[name]);
   await page.locator('.workspace-brand, .workspace-sidebar').first().waitFor().catch(()=>{});
 };
 await page.goto(base+'/places');
 await createPlace('日本驗收東京站',full?'東京駅':'35.6812,139.7671');
 if(full)await createPlace('日本驗收皇居','35.6852,139.7528');
 await createPlace('日本驗收那霸','26.2124,127.6809');
 await page.reload();
 await page.getByText('日本驗收東京站',{exact:true}).first().waitFor();
 await page.getByText('日本驗收那霸',{exact:true}).first().waitFor();
 console.log('Japan coordinate places created and survived reload');
 await selectDataset('沖繩');await page.goto(base+'/places');
 assert.equal(await page.getByText('日本驗收那霸',{exact:true}).count(),0);
 await createPlace('沖繩驗收那霸','26.2124,127.6809');
 await selectDataset('台灣');await page.goto(base+'/places');
 assert.equal(await page.getByText('日本驗收東京站',{exact:true}).count(),0);
 await createPlace('台灣驗收台北','25.03,121.56');
 await selectDataset('日本');await page.goto(base+'/places');
 await page.getByText('日本驗收東京站',{exact:true}).first().waitFor();
 assert.equal(await page.getByText('沖繩驗收那霸',{exact:true}).count(),0);
 assert.equal(await page.getByText('台灣驗收台北',{exact:true}).count(),0);
 console.log('Three datasets remain isolated, including identical Naha coordinates');
 await page.goto(base+'/itinerary');
 await page.locator('.itinerary-empty-detail button').click();
 await page.getByPlaceholder('例如：京都慢遊').fill('日本驗收行程');
 await page.locator('input[type=date]').first().fill('2026-11-01');
 await page.locator('input[type=date]').nth(1).fill('2026-11-02');
 await page.getByRole('button',{name:'建立行程',exact:true}).click();
 await page.getByRole('heading',{name:'日本驗收行程',exact:true}).waitFor();
 await page.locator('.itinerary-items-actions summary').click();
 await page.getByRole('button',{name:'新增地點',exact:true}).click();
 await page.getByRole('button',{name:'選擇地點',exact:true}).click();
 await page.getByRole('dialog').last().getByRole('option',{name:'日本驗收東京站',exact:true}).click();
 await page.getByRole('button',{name:'加入',exact:true}).click();
 await page.getByText('日本驗收東京站',{exact:true}).first().waitFor();
 await page.reload();
 await page.getByText('日本驗收東京站',{exact:true}).first().waitFor();
 console.log('Japan itinerary and scheduled place survived reload');
 await page.locator('.maplibregl-canvas').first().waitFor({state:'visible',timeout:60000});
 await page.locator('.itinerary-map-overlay').waitFor({state:'hidden',timeout:60000});
 await page.locator('.maplibregl-marker').first().waitFor({state:'visible',timeout:60000});
 const canvas=await page.locator('.maplibregl-canvas').first().boundingBox();assert(canvas&&canvas.height>100&&canvas.width>100);
 assert.equal(await page.getByText('無法顯示地圖',{exact:true}).count(),0);
 if(!full)assert.equal(mapRouteRequests.length,0,'Pin-only workflow must not calculate routes');
 if(full){
  await page.locator('.itinerary-items-actions summary').click();
  await page.getByRole('button',{name:'新增地點',exact:true}).click();
  await page.getByRole('button',{name:'選擇地點',exact:true}).click();
  await page.getByRole('dialog').last().getByRole('option',{name:'日本驗收皇居',exact:true}).click();
  await page.locator('.itinerary-item-form select').last().selectOption('DRIVING');
  await page.getByRole('button',{name:'加入',exact:true}).click();
  await page.getByText('日本驗收皇居',{exact:true}).first().waitFor();
  await page.locator('.itinerary-map-actions details summary').click();
  const routeResponse=page.waitForResponse(r=>r.url().includes('/datasets/japan/api/route')&&r.request().method()==='POST'&&r.status()===200,{timeout:60000});
  await page.getByRole('button',{name:'交通軌跡',exact:true}).click();
  assert((await (await routeResponse).json()).distance>0);
  await page.getByText('已顯示當天行程的交通軌跡',{exact:true}).waitFor();
  await page.locator('.itinerary-map-actions details summary').click();
  await page.getByRole('button',{name:'當日全程',exact:true}).click();
  await page.waitForTimeout(800); // Wait for the map's 650ms camera animation.
  await page.screenshot({path:output+'/itinerary-route.png',timeout:60000});
  for(const mode of ['car','walk','bike']){
   const response=await page.request.post(base+'/local-map/datasets/japan/api/route',{data:{points:[[139.7671,35.6812],[139.7528,35.6852]],mode}});
   assert.equal(response.status(),200,mode);const result=await response.json();assert(result.distance>0&&result.duration>0,mode);
  }
  await page.goto(base+'/route-calculator');
  await page.getByRole('button',{name:'選擇起點',exact:true}).click();
  await page.getByRole('dialog').getByRole('option',{name:'日本驗收東京站',exact:true}).click();
  await page.getByRole('button',{name:'選擇終點',exact:true}).click();
  await page.getByRole('dialog').getByRole('option',{name:'日本驗收皇居',exact:true}).click();
  await page.getByRole('button',{name:'路程計算',exact:true}).click();
  await page.getByRole('dialog',{name:'路程試算結果'}).waitFor({timeout:60000});
  console.log('Real name search, rendered itinerary geometry, three route modes and route calculator passed');
 }

 await writeFile(output+'/form.private.txt',await page.locator('body').innerText(),{mode:0o600});
 await page.screenshot({path:output+'/form.png',timeout:60000});
 assert.equal(cloudDataWrites,0);
 assert.deepEqual(errors,[]);
 await writeFile(output+'/result.json',JSON.stringify({phase:full?'complete-search-map-routing':'places-regions-itinerary',authenticated:true,role:'admin',database:'isolated IndexedDB',cloudDataWrites,mapRouteRequests,errors},null,2));
} catch(cause){
 await writeFile(output+'/failure.private.txt',(await page.locator('body').innerText()).replace(/[\w.+-]+@[\w.-]+/g,'[email]'),{mode:0o600});
 await page.screenshot({path:output+'/failure.png',timeout:60000}).catch(()=>{});
 throw cause;
}finally{
 await context.close();await browser.close();
 const restored=await client.auth.updateUser({data:{tripmap_osm_dataset:original??null}});
 assert(!restored.error,'Restore the test account dataset preference');
}
