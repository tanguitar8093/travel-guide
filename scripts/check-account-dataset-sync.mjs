// Two isolated devices, real account preference API, and real app lifecycle.
// Uses only the dedicated test account; restores its original preference afterward.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile('.env.local')
process.loadEnvFile('.env.e2e.local')
const base = process.env.TRIPMAP_TEST_URL || 'http://localhost:5173'
const apiUrl = process.env.VITE_SUPABASE_URL
const client = createClient(apiUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await client.auth.signInWithPassword({ email: process.env.E2E_A_EMAIL, password: process.env.E2E_A_PASSWORD })
if (error) throw new Error(`Test sign-in failed: ${error.status}`)
const original = data.user.user_metadata.tripmap_osm_dataset
const key = `sb-${new URL(apiUrl).hostname.split('.')[0]}-auth-token`
const browser = await chromium.launch({ headless: true })
const errors = []
let contexts = []
try {
  const { error: resetError } = await client.auth.updateUser({ data: { tripmap_osm_dataset: 'okinawa' } })
  if (resetError) throw resetError
  async function device(dataset, mobile) {
    const context = await browser.newContext({ viewport: mobile ? { width:390,height:844 } : { width:1440,height:1000 }, isMobile:mobile })
    contexts.push(context)
    await context.addInitScript(({key,session,dataset}) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session))
      localStorage.setItem('travel-planner-database-mode', 'indexeddb')
      localStorage.setItem('travel-planner-sync-mode', 'manual')
      localStorage.setItem('travel-planner:map-provider','osm')
      if (!localStorage.getItem('travel-planner:osm-dataset')) localStorage.setItem('travel-planner:osm-dataset',dataset)
    }, {key,session:data.session,dataset})
    // Keep this test from publishing personal workspace mutations even if a test role changes.
    await context.route('**/rest/v1/rpc/app_sync_push',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Preference test: workspace uploads disabled"}'}))
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base+'/regions')
    await page.getByRole('button',{name:/台灣.*個行程/}).waitFor({timeout:60000})
    return page
  }
  const phone = await device('okinawa',true), desktop = await device('taiwan',false)
  async function selected(page, expected) {
    await page.waitForFunction(expected=>document.querySelector('.region-list-item.selected strong')?.textContent===expected, expected)
  }
  async function saved(page) {
    await page.waitForFunction(userId=>!localStorage.getItem(`travel-planner:osm-dataset-pending:${userId}`),data.user.id)
  }
  await selected(desktop,'沖繩')
  await phone.getByRole('button',{name:/台灣.*個行程/}).click()
  await saved(phone)
  await desktop.reload()
  await selected(desktop,'台灣')
  await desktop.getByRole('button',{name:/沖繩.*個行程/}).click()
  await saved(desktop)
  await phone.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await selected(phone,'沖繩')
  // A passive device must not write its previous cache back over the new choice.
  await desktop.reload()
  await selected(desktop,'沖繩')
  assert.deepEqual(errors,[])
  console.log('PASS: isolated mobile/desktop caches converge through real account settings in both directions, reload/focus refresh, no stale-cache overwrite, no page errors')
} finally {
  for (const context of contexts) await context.close()
  await browser.close()
  const { error: restoreError } = await client.auth.updateUser({ data: { tripmap_osm_dataset: original ?? null } })
  if (restoreError) throw restoreError
}
