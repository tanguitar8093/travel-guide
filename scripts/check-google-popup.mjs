// Real SDK/AuthProvider/media. Google and Supabase responses are isolated mocks;
// no real login, account writes, or new listening port.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const base=process.env.TRIPMAP_TEST_URL || 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext();
 if (process.env.TRIPMAP_TEST_DIST) {
  const dist=path.resolve(process.env.TRIPMAP_TEST_DIST);
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wav':'audio/wav','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
  await context.route(base+'/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname.startsWith('/local-map/')||pathname.startsWith('/osm-'))return route.continue();
   let filename=path.resolve(dist,'.'+pathname);
   if(!filename.startsWith(dist+path.sep)&&filename!==dist)return route.abort();
   try {if(!(await stat(filename)).isFile())filename=path.join(dist,'index.html');}
   catch {if(path.extname(pathname))return route.fulfill({status:404,body:'Not found'});filename=path.join(dist,'index.html');}
   return route.fulfill({body:await readFile(filename),contentType:types[path.extname(filename)]||'application/octet-stream'});
  });
 }
 const user={id:'00000000-0000-4000-8000-000000000099',email:'popup-test@example.test',aud:'authenticated',app_metadata:{provider:'google'},user_metadata:{},created_at:new Date().toISOString()};
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const jwt=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})+'.fake-test-signature';
 const callback=base+'/#'+new URLSearchParams({access_token:jwt,refresh_token:'test-refresh',expires_in:'3600',token_type:'bearer'});
 let failProvider=false, roleReads=0, popupRoleReads=0;
 await context.route('https://*.supabase.co/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/authorize'))return route.fulfill({contentType:'text/html',body:`<script>location.href='https://tripmap-google-test.example/confirm'</script>`});
  if(url.pathname.endsWith('/user'))return route.fulfill({json:user});
  if(url.pathname.includes('user_roles')){roleReads++;if(route.request().frame().page()!==page)popupRoleReads++;return route.fulfill({json:[{role:'member'}]});}
  if(url.pathname.includes('app_sync_snapshot'))return route.fulfill({json:{protocolVersion:1,cursor:'0',records:[]}});
  if(url.pathname.includes('app_sync_pull'))return route.fulfill({json:{protocolVersion:1,cursor:'0',hasMore:false,changes:[]}});
  return route.fulfill({json:[]});
 });
 await context.route('https://tripmap-google-test.example/confirm',route=>route.fulfill({contentType:'text/html',headers:process.env.TRIPMAP_TEST_COOP ? {'Cross-Origin-Opener-Policy':'same-origin'} : {},body:`<button onclick="location.href='${failProvider ? base+'/#error=access_denied&error_description=Test%20cancelled' : callback}'">Confirm test Google</button>`}));
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>{errors.push(e.message);if(process.env.TRIPMAP_DEBUG)console.log('pageerror',e.message)});
 if(process.env.TRIPMAP_DEBUG)page.on('console',m=>console.log('browser',m.type(),m.text()));
 await page.goto(base);
 await page.getByRole('button',{name:'Google 登入',exact:true}).waitFor();
 await page.evaluate(()=>{window.originalDocument=crypto.randomUUID();window.parentLoads=1;});
 const original=await page.evaluate(()=>window.originalDocument);
 async function open() {
  const result=page.waitForEvent('popup');void result.catch(()=>{});
  await page.getByRole('button',{name:'Google 登入',exact:true}).click();
  if(process.env.TRIPMAP_DEBUG)console.log('after login click',await page.locator('#root').textContent());
  const popup=await result;
  await popup.getByRole('button',{name:'Confirm test Google'}).waitFor();
  assert.equal(page.url(),base+'/');
  assert.equal(await page.evaluate(()=>window.originalDocument),original);
  assert.equal(await page.locator('.auth-panel-loading').count(),0);
  return popup;
 }
 // Closing Google must recover the existing button without reloading the app.
 let popup=await open();
 await popup.close();await page.bringToFront();
 await page.getByRole('button',{name:'Google 登入',exact:true}).waitFor();
 assert.match(await page.getByRole('alert').textContent(),/取消/);
 // OAuth error arrives in the existing login card, child does not mount the app.
 failProvider=true;popup=await open();
 await popup.getByRole('button',{name:'Confirm test Google'}).click({noWaitAfter:true});
 await page.getByRole('button',{name:'Google 登入',exact:true}).waitFor();
 assert.match(await page.getByRole('alert').textContent(),/Test cancelled/);
 // Successful cross-origin OAuth: real audio, no autoplay flags or synthetic clicks.
 failProvider=false;popup=await open();
 const close=popup.waitForEvent('close');
 await popup.getByRole('button',{name:'Confirm test Google'}).click({noWaitAfter:true});
 await close;
 await page.locator('.okinawa-login-scene').waitFor();
 const playing=await page.evaluate(()=>{const a=document.getElementById('login-welcome-audio');return {paused:a.paused,time:a.currentTime,muted:a.muted};});
 assert.equal(playing.paused,false);assert.equal(playing.muted,false);assert.ok(playing.time<3);
 assert.equal(await page.evaluate(()=>window.originalDocument),original);
 assert.equal(await page.locator('.workspace-layout').count(),0,'music must finish before entry');
 await page.locator('.workspace-layout').waitFor();
 assert.equal(popupRoleReads,0,'callback child must not read workspace roles');
 assert.ok(roleReads>=1);
 // Repeat logout/login in the same document; ensure stale ended media cannot skip music.
 await page.locator('.workspace-session-button').evaluate(button=>button.click());
 popup=await open();
 await popup.getByRole('button',{name:'Confirm test Google'}).click({noWaitAfter:true});
 await page.locator('.okinawa-login-scene').waitFor();
 assert.equal(await page.evaluate(()=>document.getElementById('login-welcome-audio').paused),false);
 assert.equal(await page.evaluate(()=>window.originalDocument),original);
 await page.locator('.workspace-layout').waitFor();
 // Reloading a restored session must not replay the login welcome.
 await page.reload();await page.locator('.workspace-layout').waitFor();
 assert.equal(await page.locator('.okinawa-login-scene').count(),0);
 assert.equal(await page.evaluate(()=>document.getElementById('login-welcome-audio').paused),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: popup close/cancel/retry, provider error, real cross-origin login + audible autoplay, synchronized island, original document preserved, no duplicate child workspace, repeat logout/login, restored-session reload.');
}finally{await browser.close()}
