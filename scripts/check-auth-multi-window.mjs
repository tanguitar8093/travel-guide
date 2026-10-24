// Two same-origin windows with real AuthProvider/gateway; fake SDK, workspace setup and writes.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.TRIPMAP_TEST_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const errors = [];
  await context.route('https://*.supabase.co/**', route => route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('tripmap:share:v1:e15692da-d36b-47b7-9526-f262da7c27c3', JSON.stringify({
      id:'e15692da-d36b-47b7-9526-f262da7c27c3',createdAt:Date.now(),title:'Test',text:'',url:'',
      candidate:{name:'Test',coordinate:{latitude:26.2,longitude:127.6},sourceUrl:'https://www.google.com/maps?q=26.2,127.6'},
    }));
  });
  await context.route('**/src/database/supabase.client.ts*', route => route.fulfill({ contentType:'application/javascript',body:`
    export const supabaseAuthStorageKey='test-auth',supabaseAuthCodeVerifierKey='test-code';
    const session={user:{id:'multi-window-test',email:'test@example.test'}};
    const listeners=new Set();
    const channel=new BroadcastChannel('tripmap-auth-test');
    channel.onmessage=event=>{for(const callback of listeners)callback(event.data,session)};
    window.sendAuthTestEvent=event=>{for(const callback of listeners)callback(event,session);channel.postMessage(event)};
    const role={select(){return this},eq(){return this},abortSignal(){return this},async maybeSingle(){
      await new Promise(resolve=>setTimeout(resolve,30));return {data:{role:'member'},error:null};}};
    export const supabase={from:()=>role,auth:{getSession:async()=>({data:{session},error:null}),onAuthStateChange(callback){
      listeners.add(callback);const timer=setTimeout(()=>callback('INITIAL_SESSION',session),80);
      return {data:{subscription:{unsubscribe(){listeners.delete(callback);clearTimeout(timer)}}}};
    }},rpc:(_name,payload)=>({abortSignal:async()=>({status:200,error:null,data:{status:'created',placeId:payload.p_operation_id,name:payload.p_name}})})};` }));
  await context.route('**/src/database/hybrid.runtime.ts*', async route => {
    const response=await route.fetch();
    let source=await response.text();
    assert.ok(source.includes('export async function activateHybridAccount('));
    source=source.replace('export async function activateHybridAccount(', 'async function originalActivateHybridAccount(');
    source+=`\nexport async function activateHybridAccount(){window.hybridPrepareCount=(window.hybridPrepareCount||0)+1;await new Promise(resolve=>setTimeout(resolve,180));}`;
    await route.fulfill({response,body:source});
  });
  await context.route('**/src/App.tsx*', route => route.fulfill({contentType:'application/javascript',body:`
    import React from '/node_modules/.vite/deps/react.js';
    export default function App(){return React.createElement('div',{'data-testid':'workspace-ready'},'ready')}` }));
  const web=await context.newPage(), installed=await context.newPage();
  for(const page of [web,installed])page.on('pageerror',error=>errors.push(error.message));
  await web.goto(base+'/itinerary');
  await installed.goto(base+'/share/place?receipt=e15692da-d36b-47b7-9526-f262da7c27c3');
  await Promise.all([web.getByTestId('workspace-ready').waitFor(),installed.getByRole('heading',{name:'加入成功'}).waitFor()]);
  for(const page of [web,installed])assert.equal(await page.evaluate(()=>window.hybridPrepareCount),1);
  await web.evaluate(()=>window.sendAuthTestEvent('SIGNED_IN'));
  await installed.evaluate(()=>window.sendAuthTestEvent('TOKEN_REFRESHED'));
  // Allow delayed callbacks, role reads and any erroneous second setup to finish.
  await web.waitForTimeout(400);
  for(const page of [web,installed]) {
    assert.equal(await page.evaluate(()=>window.hybridPrepareCount),1);
    assert.equal(await page.locator('.auth-panel-loading').count(),0);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: two same-origin windows, restored-session INITIAL_SESSION, shared sign-in/refresh events, one workspace initialization per window, normal app and share import both complete; no real account writes.');
} finally {await browser.close();}
