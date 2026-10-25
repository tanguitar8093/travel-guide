// Reproduce a synced itinerary in a fresh local IndexedDB; never write user cloud data.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const fixture=process.argv[2];
assert(fixture,'Pass the path to the local private synced-trip fixture');
const source=JSON.parse(await readFile(fixture,'utf8')).find(row=>row.region.map_provider==='osm');
assert(source,'OSM itinerary required');
if(process.env.ROUTING_FIRST_LEG_ONLY==='1')source.items=source.items.slice(0,2);
const dataset=source.region.osm_dataset||'okinawa';
const datasetName={okinawa:'沖繩',taiwan:'台灣',japan:'日本'}[dataset];
const base=process.env.ROUTING_APP_URL||process.env.OKINAWA_APP_URL||'http://127.0.0.1:4180';
const output=process.env.ROUTING_CHECK_OUTPUT||process.env.OKINAWA_CHECK_OUTPUT||'/tmp/travel-okinawa-app';
await mkdir(output,{recursive:true});
const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await client.auth.signInWithPassword({email:process.env.E2E_A_EMAIL,password:process.env.E2E_A_PASSWORD});
assert(!error,'Configured test account must authenticate');
const role=await client.from('user_roles').select('role').eq('user_id',data.user.id).single();
assert.equal(role.data?.role,'admin','Administrator required for isolated IndexedDB mode');
const authKey=`sb-${new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(({authKey,session,dataset})=>{
 if(!localStorage.getItem(authKey))localStorage.setItem(authKey,JSON.stringify(session));
 localStorage.setItem('travel-planner-database-mode','indexeddb');
 localStorage.setItem('travel-planner:map-provider','osm');
 localStorage.setItem('travel-planner:osm-dataset',dataset);
},{authKey,session:data.session,dataset});
let cloudWrites=0;const errors=[],responses=[],pending=[];
// Keep this local reproduction's selection independent of the account preference.
await context.route('**/auth/v1/user',async route=>{
 if(route.request().method()!=='GET'){cloudWrites++;return route.abort();}
 const response=await route.fetch();const user=await response.json();
 user.user_metadata={...user.user_metadata,tripmap_osm_dataset:dataset};
 await route.fulfill({response,json:user});
});
await context.route('**/rest/v1/**',route=>{
 const request=route.request(),rpc=new URL(request.url()).pathname.split('/').at(-1),action=request.postDataJSON()?.p_action;
 const readOnly=['app_sync_snapshot','app_sync_pull'].includes(rpc)||(rpc==='app_trip_collaboration_v2'&&['list','snapshot','details'].includes(action))||(rpc==='app_shared_trip'&&action==='snapshot')||(rpc==='app_public_itinerary'&&['list','source','get','pull'].includes(action));
 if(['POST','PUT','PATCH','DELETE'].includes(request.method())&&!readOnly){cloudWrites++;return route.abort();}
 return route.continue();
});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
page.on('response',response=>{
 if(response.url().includes('/api/route')&&response.request().method()==='POST')pending.push((async()=>{
  const body=await response.json();responses.push({status:response.status(),path:new URL(response.url()).pathname,distance:body.distance,duration:body.duration,error:body.error});
 })());
});
try{
 await page.goto(base+'/regions');await page.getByRole('button',{name:new RegExp(datasetName+'.*個行程')}).waitFor({timeout:60000});
 await page.evaluate(async ({source,dataset})=>{
  const {database:db}=await import('/src/database/database.ts');
  const {localOsmRegionId,osmRegion}=await import('/src/geo/osm-datasets.ts');
  const regionId=localOsmRegionId(dataset),tripId=crypto.randomUUID();
  await db.transaction('rw',db.regions,db.places,db.trips,db.itineraryItems,async()=>{
   await db.regions.put({...osmRegion(dataset),id:regionId});
   const places=[...new Map(source.items.map(item=>[item.place.id,item.place])).values()];
   await db.places.bulkPut(places.map(place=>({...place,regionIds:[regionId],labelIds:[]})));
   await db.trips.put({id:tripId,regionId,name:source.trip.name,startDate:source.trip.start_date,endDate:source.trip.end_date});
   await db.itineraryItems.bulkPut(source.items.map(item=>({id:crypto.randomUUID(),tripId,placeId:item.place_id,date:item.date,order:item.sort_order,...(item.transport?{transport:item.transport}:{})})));
  });
 },{source,dataset});
 await page.goto(base+'/itinerary');await page.getByRole('heading',{name:source.trip.name,exact:true}).waitFor({timeout:60000});
 const days=[...new Set(source.items.map(item=>item.date))].sort().slice(0,2);
 for(const [index,date] of days.entries()){
  const count=source.items.filter(item=>item.date===date).length-1;
  await page.locator('.itinerary-day-strip button').filter({hasText:date.slice(8,10)}).click();
  await page.locator('.itinerary-map-overlay').waitFor({state:'hidden',timeout:60000});
  await page.locator('.maplibregl-marker').first().waitFor({timeout:60000});
  await page.locator('.itinerary-map-actions details summary').click();
  await page.getByRole('button',{name:'交通軌跡',exact:true}).click();
  await page.getByText(/^已顯示當天行程的交通軌跡/).waitFor({timeout:60000});
  if(process.env.ROUTING_EXPECT_APPROXIMATE==='1')await page.getByText(/已顯示當天行程的交通軌跡.*道路估算/).waitFor();
  await page.locator('.itinerary-map-actions details summary').click();
  await page.getByRole('button',{name:'當日全程',exact:true}).click();
  await page.waitForTimeout(800);
  await page.screenshot({path:output+`/day-${index+1}-route.png`});
  await page.locator('.itinerary-items-actions summary').click();
  await page.getByRole('button',{name:'計算所有路程',exact:true}).click();
  await page.getByText(`計算路程完成：成功 ${count} 段。`,{exact:true}).waitFor({timeout:60000});
  const stored=await page.evaluate(async date=>{
   const {database:db}=await import('/src/database/database.ts');
   return (await db.itineraryItems.where('date').equals(date).toArray()).sort((a,b)=>a.order-b.order).slice(1).map(item=>({minutes:item.travelDurationMinutes,meters:item.travelDistanceMeters}));
  },date);
  assert.equal(stored.length,count);assert(stored.every(item=>item.minutes>0&&item.meters>0));
  console.log(`Day ${index+1}: all ${count} route geometries and stored time/distance estimates passed`);
  await page.locator('.itinerary-map-actions details summary').click();
  await page.getByRole('button',{name:'隱藏交通軌跡',exact:true}).click();
 }
 if(process.env.ROUTING_CHECK_CALCULATOR==='1'){
  await page.goto(base+'/route-calculator');
  await page.getByRole('button',{name:'選擇起點',exact:true}).click();
  await page.getByRole('dialog').getByRole('option',{name:source.items[0].place.name,exact:true}).click();
  await page.getByRole('button',{name:'選擇終點',exact:true}).click();
  await page.getByRole('dialog').getByRole('option',{name:source.items[1].place.name,exact:true}).click();
  await page.getByRole('button',{name:'路程計算',exact:true}).click();
  await page.getByRole('dialog',{name:'路程試算結果'}).waitFor({timeout:60000});
  if(process.env.ROUTING_EXPECT_APPROXIMATE==='1')await page.getByText('道路估算，未保證最快或最短路線。',{exact:false}).waitFor();
  console.log('Route calculator result and road-estimate quality label passed');
 }
 const expectedLegs=days.reduce((sum,date)=>sum+source.items.filter(item=>item.date===date).length-1,0);
 await Promise.all(pending);assert(responses.length>=expectedLegs*2);
 assert(responses.every(row=>row.status===200&&row.distance>0&&row.duration>0));
 assert(responses.every(row=>dataset==='okinawa'?!row.path.includes('/datasets/'):row.path.includes('/datasets/'+dataset+'/')));
 assert.equal(cloudWrites,0);assert.deepEqual(errors,[]);
 await writeFile(output+'/result.json',JSON.stringify({dataset,days:days.length,legs:expectedLegs,cloudWrites,errors,responses},null,2));
 console.log('All selected itinerary days rendered and calculated successfully; no cloud mutations');
}catch(error){
 await page.screenshot({path:output+'/failure.png'}).catch(()=>{});
 await writeFile(output+'/failure.private.txt',await page.locator('body').innerText(),{mode:0o600});throw error;
}finally{await context.close();await browser.close();}
