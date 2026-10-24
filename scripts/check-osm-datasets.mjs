// Browser regression check. Uses an existing test login; all app mutations remain in this browser.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile('.env.local')
process.loadEnvFile('.env.e2e.local')
const base=process.env.OSM_CHECK_URL || 'http://127.0.0.1:5173'
const hybridOnly=process.env.OSM_CHECK_HYBRID==='1'
const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const {data,error}=await client.auth.signInWithPassword({email:process.env.E2E_A_EMAIL,password:process.env.E2E_A_PASSWORD})
if(error)throw new Error(`Test sign-in failed: ${error.status}`)
const key=`sb-${new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000}})
await context.addInitScript(({key,session,hybridOnly})=>{
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(session))
  localStorage.setItem('travel-planner-database-mode',hybridOnly?'hybrid':'indexeddb')
  localStorage.setItem('travel-planner-sync-mode','manual')
  localStorage.setItem('travel-planner:map-provider','osm')
},{key,session:data.session,hybridOnly})
// Member accounts may use hybrid mode. Block uploads so this check never writes test records to the cloud.
if(!hybridOnly)await context.route('**/rest/v1/rpc/app_sync_push',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Browser regression check: uploads disabled'})}))
const page=await context.newPage()
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
try{
  await page.goto(base+'/regions')
  await page.getByRole('heading',{name:'區域',exact:true}).waitFor({timeout:60000})
  if(hybridOnly){
    const state=await page.evaluate(async()=>{
      const runtimeUrl=performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>name.includes('/src/database/hybrid.runtime.ts')).at(-1)
      if(!runtimeUrl)throw new Error('The app runtime was not loaded')
      const runtime=await import(runtimeUrl)
      await runtime.syncHybridWorkspace()
      const status=runtime.getHybridStatus()
      const summary=await runtime.requireHybridStore().getSummary()
      return {error:status.error,pending:summary.pendingCount,failed:summary.failedCount,conflicts:summary.conflictCount}
    })
    assert.equal(state.error,undefined);assert.equal(state.pending,0);assert.equal(state.failed,0);assert.equal(state.conflicts,0)
    await page.reload()
    await page.getByRole('heading',{name:'區域',exact:true}).waitFor({timeout:60000})
    assert.equal(await page.getByText('資料同步失敗，目前顯示本機資料，本機變更仍保留。',{exact:true}).count(),0)
    console.log('PASS: actual-account hybrid sync, zero pending/failed/conflicting operations, and no stale warning after reload')
    process.exitCode=0
  }else{

  await page.getByRole('button',{name:/台灣.*個行程/}).click()
  await page.waitForFunction(()=>localStorage.getItem('travel-planner:osm-dataset')==='taiwan')
  await page.reload()
  await page.waitForFunction(()=>document.querySelector('.region-list-item.selected strong')?.textContent==='台灣')
  assert.equal(await page.evaluate(()=>localStorage.getItem('travel-planner:osm-dataset')), 'taiwan')
  await page.goto(base+'/places')
  const add=page.getByRole('button',{name:'地點',exact:true}).first()
  await add.click()
  const search=page.getByRole('combobox',{name:'搜尋 OSM 地點'})
  await search.fill('26.4, 127.9')
  await search.press('Enter')
  await page.getByRole('status').filter({hasText:'超出台灣圖資範圍'}).waitFor()
  await search.fill('25.033, 121.5654')
  await search.press('Enter')
  await page.getByRole('option',{name:'25.033, 121.5654',exact:true}).click()
  await page.locator('#place-user-name').fill('OSM 台灣瀏覽器測試')
  await page.getByRole('button',{name:'建立地點',exact:true}).first().click()
  await page.getByText('地點已建立。',{exact:true}).waitFor()
  await page.reload()
  await page.getByText('OSM 台灣瀏覽器測試',{exact:true}).first().waitFor()
  await page.goto(base+'/regions')
  await page.getByRole('button',{name:/沖繩.*個行程/}).click()
  await page.waitForFunction(()=>localStorage.getItem('travel-planner:osm-dataset')==='okinawa')
  await page.goto(base+'/places')
  await page.getByRole('heading',{name:'地點',exact:true}).waitFor()
  assert.equal(await page.getByText('OSM 台灣瀏覽器測試',{exact:true}).count(),0)
  await page.goto(base+'/regions')
  await page.getByRole('button',{name:/台灣.*個行程/}).click()
  await page.goto(base+'/itinerary')
  await page.getByRole('button',{name:'＋ 新增',exact:true}).click()
  await page.getByPlaceholder('例如：京都慢遊').fill('OSM 台灣瀏覽器行程')
  // The active dataset determines the only available default region.
  const region=page.locator('.itinerary-trip-form select').first()
  const options=await region.locator('option').allTextContents()
  assert(options.includes('台灣'))
  assert(!options.includes('沖繩'))
  const inputs=page.locator('.itinerary-trip-form input[type=date]')
  await inputs.nth(0).fill('2026-10-24');await inputs.nth(1).fill('2026-10-24')
  await page.getByRole('button',{name:'建立行程',exact:true}).click()
  await page.locator('.itinerary-google-map canvas').waitFor({timeout:60000})
  await page.getByText('正在載入 OpenStreetMap…',{exact:true}).waitFor({state:'hidden',timeout:70000})
  await page.locator('.itinerary-google-map canvas').waitFor({state:'visible',timeout:5000})
  await mkdir('/tmp/travel-osm-check',{recursive:true})
  await page.screenshot({path:'/tmp/travel-osm-check/taiwan-itinerary.png',fullPage:true})

  await page.goto(base+'/regions')
  await page.getByRole('button',{name:/沖繩.*個行程/}).click()
  await page.goto(base+'/itinerary')
  await page.getByRole('button',{name:'＋ 新增',exact:true}).click()
  await page.getByPlaceholder('例如：京都慢遊').fill('OSM 沖繩瀏覽器行程')
  const okinawaDates=page.locator('.itinerary-trip-form input[type=date]')
  await okinawaDates.nth(0).fill('2026-10-24');await okinawaDates.nth(1).fill('2026-10-24')
  await page.getByRole('button',{name:'建立行程',exact:true}).click()
  await page.locator('.itinerary-google-map canvas').waitFor({timeout:60000})
  await page.getByText('正在載入 OpenStreetMap…',{exact:true}).waitFor({state:'hidden',timeout:70000})
  await page.locator('.itinerary-google-map canvas').waitFor({state:'visible',timeout:5000})
  await page.screenshot({path:'/tmp/travel-osm-check/okinawa-itinerary.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log('PASS: region selection, persisted Taiwan places, cross-region rejection, isolated lists, Taiwan trip defaults and fully loaded Taiwan/Okinawa maps')
  }
}catch(error){await mkdir('/tmp/travel-osm-check',{recursive:true});await page.screenshot({path:'/tmp/travel-osm-check/failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(0,2500));throw error}finally{await context.close();await browser.close()}
