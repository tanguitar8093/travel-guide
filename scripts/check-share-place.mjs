// Browser verification against the existing server; all account writes/Maps calls are mocked.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.TRIPMAP_TEST_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  let mapCalls = 0;
  await context.route('https://mapu.retiolus.net/unshortener?*', route => {
    mapCalls++;
    return route.fulfill({ json: { approximate: false, name: '分享測試地點', lat: 26.2, long: 127.6, full_link: 'https://www.google.com/maps?q=26.2,127.6' } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Both lazy module download and receipt retrieval must use the existing animated panel.
  let releaseEntry;
  const delayedEntry = new Promise(resolve => { releaseEntry = resolve; });
  await context.route('**/src/modules/share-place/SharePlaceEntry.tsx*', async route => {
    await delayedEntry;
    await route.continue();
  });
  await context.addInitScript(() => {
    const originalMatch = Cache.prototype.match;
    Cache.prototype.match = async function(request, options) {
      const url = typeof request === 'string' ? request : request.url;
      if (url?.includes('/share/inbox/')) await new Promise(resolve => setTimeout(resolve, 800));
      return originalMatch.call(this, request, options);
    };
  });
  await page.goto(`${base}/share/place`, { waitUntil: 'domcontentloaded' });
  await page.locator('.auth-panel-loading .auth-loading-caption', { hasText: '正在接收分享' }).waitFor();
  assert.equal(await page.locator('#root > p, .share-place-panel h1').count(), 0);
  releaseEntry();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  assert.ok(await page.evaluate(() => navigator.serviceWorker.controller));
  async function share() {
    await page.evaluate(() => {
      const form = document.createElement('form'); form.action = '/share/place'; form.method = 'POST';
      const input = document.createElement('input'); input.name = 'text'; input.value = '機場 https://maps.app.goo.gl/tWvNV7FfEfHbpd5X6';
      form.append(input); document.body.append(form); form.submit();
    });
    await page.waitForURL('**/share/place?receipt=*');
  }
  await share();
  await page.locator('.auth-panel-loading .auth-loading-caption', { hasText: '正在接收分享' }).waitFor();
  assert.equal(await page.locator('#root > p, .share-place-panel h1').count(), 0);
  await page.getByRole('button', { name: '使用 Google 登入後加入' }).waitFor();
  const receipt = new URL(page.url()).searchParams.get('receipt');
  const authSource = await (await context.request.get(`${base}/src/auth/useAuth.ts`)).text();
  const contextPath = authSource.match(/"(\/src\/auth\/auth-context[^"]+)"/)[1];
  await context.route('**/src/auth/AuthProvider.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import { AuthContext } from '${contextPath}';
    export function AuthProvider({ children }) { return React.createElement(AuthContext.Provider, { value: {
      status:'authenticated',loginWelcomeRequired:false,hasWorkspaceAccess:true,
      user:{id:'browser-test',email:'test@example.test'},userRole:'member',
      completeLoginWelcome(){},signOut(){},signInWithGoogle(){},clearError(){}
    } }, children); }` }));
  const submissions = [];
  let failNext = false;
  await context.exposeBinding('tripmapTestImport', (_source, payload) => {
    submissions.push(payload);
    return failNext ? (failNext = false, { status: 500, error: { message: '模擬失敗' } }) : {
      status: 200, error: null, data: { status: 'created', placeId: payload.p_operation_id, name: payload.p_name },
    };
  });
  await context.route('**/src/database/supabase.client.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const supabaseAuthStorageKey='test-auth'; export const supabaseAuthCodeVerifierKey='test-code';
    export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'browser-test'}}}})},
      rpc:(_name,payload)=>({abortSignal:()=>window.tripmapTestImport(payload)})};` }));
  await page.reload();
  await page.getByRole('heading', { name: '加入成功' }).waitFor();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].p_operation_id, receipt);
  await page.reload();
  await page.getByRole('heading', { name: '加入成功' }).waitFor();
  assert.equal(submissions.length, 1);
  failNext = true;
  await share();
  await page.getByRole('alert').filter({ hasText: '模擬失敗' }).waitFor();
  await page.getByRole('button', { name: '重試', exact: true }).click();
  await page.getByRole('heading', { name: '加入成功' }).waitFor();
  assert.equal(submissions.length, 3);
  assert.deepEqual(submissions[1], submissions[2]);
  // Both controls attempt close first, then fall back when the browser keeps the page alive.
  await page.evaluate(() => {
    window.tripmapCloseCalls = 0; window.tripmapBackCalls = 0;
    window.close = () => { window.tripmapCloseCalls++; };
    window.history.back = () => { window.tripmapBackCalls++; };
  });
  const closeButtons = page.getByRole('button', { name: '關閉頁面', exact: true });
  assert.equal(await closeButtons.count(), 2);
  await closeButtons.nth(0).click();
  await page.waitForFunction(() => window.tripmapBackCalls === 1);
  await closeButtons.nth(1).click();
  await page.waitForFunction(() => window.tripmapBackCalls === 2);
  assert.equal(await page.evaluate(() => window.tripmapCloseCalls), 2);
  await page.screenshot({ path: '/tmp/tripmap-share-close.png' });
  // Simulate a slow workspace download after auth is ready: the original panel must remain.
  let releaseApp;
  const delayedApp = new Promise(resolve => { releaseApp = resolve; });
  let sawApp;
  const appRequested = new Promise(resolve => { sawApp = resolve; });
  await context.route('**/src/App.tsx*', async route => {
    sawApp();
    await delayedApp;
    await route.fulfill({ contentType: 'application/javascript', body: `
      import React from '/node_modules/.vite/deps/react.js';
      export default function App(){return React.createElement('div', {'data-testid':'workspace-ready'}, 'ready');}` });
  });
  await page.goto(`${base}/itinerary`, { waitUntil: 'domcontentloaded' });
  await appRequested;
  await page.locator('.auth-panel-loading').waitFor();
  assert.equal(await page.locator('#root > p').count(), 0);
  releaseApp();
  await page.getByTestId('workspace-ready').waitFor();
  assert.equal(await page.locator('.auth-panel-loading').count(), 0);
  assert.deepEqual(errors, []);
  const cdp = await context.newCDPSession(page);
  assert.deepEqual((await cdp.send('Page.getAppManifest')).errors, []);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  console.log(`PASS: share worker POST, clean route, signed-out persistence, shared Mapu adapter (${mapCalls} calls), import success, refresh deduplication, stable retry, both close/back controls, unified loading panel, manifest/installability; no browser errors.`);
} finally { await browser.close(); }
