import {chromium, expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
const extension=fileURLToPath(new URL('./', import.meta.url));
const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=await worker.evaluate(()=>chrome.runtime.id);
 if(id!=='cpechdjdfbbngnaeecoijepoaekbcgda')throw Error('Unexpected extension ID');
 const errors=[];worker.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const account=await context.newPage();await account.goto(`chrome-extension://${id}/account.html`);
 await expect(account.locator('#sign-in')).toBeVisible();
 await expect(account.locator('#redirect')).toHaveText(`https://${id}.chromiumapp.org/oauth`);
 await account.screenshot({path:'/tmp/tripmap-account-signed-out.png'});
 console.log('PASS: account management loads with stable callback and Google sign-in');
 await worker.evaluate(()=>{
  globalThis.testRefreshes=0;
  globalThis.testImports=[];
  globalThis.testImportMode='created';
  const realFetch=globalThis.fetch.bind(globalThis);
  const user={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',aud:'authenticated',role:'authenticated',email:'extension-test@example.com',app_metadata:{provider:'google',providers:['google']},user_metadata:{},created_at:'2026-10-23T00:00:00Z'};
  const encode=value=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const token=()=>`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated'})}.c2lnbmF0dXJl`;
  globalThis.fetch=async(input,options={})=>{
   const url=new URL(typeof input==='string'?input:input.url);
   if(url.pathname==='/rest/v1/rpc/app_import_place'){
    const body=JSON.parse(options.body);
    const headers=new Headers(options.headers);
    if(!headers.get('authorization')?.startsWith('Bearer '))throw Error('Missing user token');
    globalThis.testImports.push(body);
    await new Promise(resolve => setTimeout(resolve, 450));
    if(globalThis.testImportMode==='error')return new Response(JSON.stringify({code:'22023',message:'此地點超出目前沖繩圖資範圍，尚未新增。'}),{status:400,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({status:globalThis.testImportMode,placeId:body.p_operation_id,name:body.p_name,reason:'name'}),{status:200,headers:{'content-type':'application/json'}});
   }
   if(url.pathname==='/auth/v1/token'){
    const body=JSON.parse(options.body);
    if(url.searchParams.get('grant_type')==='pkce' && (!body.code_verifier||body.auth_code!=='test-auth-code'))throw Error('PKCE exchange missing');
    if(url.searchParams.get('grant_type')==='refresh_token')globalThis.testRefreshes++;
    return new Response(JSON.stringify({access_token:token(),refresh_token:`test-refresh-${globalThis.testRefreshes}`,expires_in:3600,token_type:'bearer',provider_token:'unneeded-google-token',user}),{status:200,headers:{'content-type':'application/json'}});
   }
   if(url.pathname==='/auth/v1/user')return new Response(JSON.stringify(user),{status:200,headers:{'content-type':'application/json'}});
   if(url.pathname==='/auth/v1/logout')return new Response(null,{status:204});
   return realFetch(input,options);
  };
  chrome.identity.launchWebAuthFlow=async({url})=>{
   const u=new URL(url);
   if(u.searchParams.get('provider')!=='google'||u.searchParams.get('code_challenge_method')!=='s256'||!u.searchParams.get('code_challenge'))throw Error('Expected Google PKCE');
   const redirect=u.searchParams.get('redirect_to');
   if(redirect!==chrome.identity.getRedirectURL('oauth'))throw Error('Unexpected redirect');
   return `${redirect}?code=test-auth-code`;
  };
 });
 await account.locator('#sign-in').click();
 await expect(account.locator('#email')).toHaveText('extension-test@example.com');
 const storage=await worker.evaluate(async()=>{
  const values=await chrome.storage.local.get(null);const key=Object.keys(values).find(k=>k.startsWith('tripmap:auth:')&&!k.endsWith('-code-verifier'));
  const session=JSON.parse(values[key]);
  return {key,hasAccess:!!session.access_token,hasRefresh:!!session.refresh_token,noGoogleToken:!session.provider_token,noVerifier:!Object.keys(values).some(k=>k.endsWith('-code-verifier'))};
 });
 if(!storage.hasAccess||!storage.hasRefresh||!storage.noGoogleToken||!storage.noVerifier)throw Error('Session persistence failed');
 console.log('PASS: Google PKCE callback → code exchange → verified email → persisted Supabase tokens');
 await account.reload();await expect(account.locator('#email')).toHaveText('extension-test@example.com');
 await account.screenshot({path:'/tmp/tripmap-account-signed-in.png'});
 console.log('PASS: re-opened account UI restores email');
 await worker.evaluate(async key=>{
  const session=JSON.parse((await chrome.storage.local.get(key))[key]);session.expires_at=Math.floor(Date.now()/1000)+30;
  await chrome.storage.local.set({[key]:JSON.stringify(session)});
 },storage.key);
 await expect.poll(()=>worker.evaluate(()=>globalThis.testRefreshes)).toBeGreaterThan(0);
 console.log('PASS: approaching expiry refreshes tokens');
 const page=await context.newPage();
 const html='<html><head><meta charset="UTF-8"></head><body style="margin:0;background:#edf0ec;font-family:system-ui"><div role="main" style="width:410px;margin:20px;background:white;border-radius:14px;overflow:hidden"><div style="height:200px;background:#b5d2d9"></div><div style="padding:20px"><h1 style="font-size:22px">海之驛站 彩橋館</h1><p style="color:#777">海の駅 あやはし館</p><p>3.8 ★★★★☆ (2,047)</p><p style="color:#777">收費道路休息站</p></div><div role="tablist" style="display:flex;justify-content:space-around;padding:16px;color:#168092;border-bottom:1px solid #ddd"><button role="tab">總覽</button><button role="tab">評論</button><button role="tab">簡介</button></div></div><script>document.addEventListener("click",event=>event.stopImmediatePropagation(),true);</script></body></html>';
 await page.route('https://www.google.com/**',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.goto('https://www.google.com/maps/place/海之驛站+彩橋館/@26.3,127.9,17z/data=!3d26.3316539!4d127.927996');
 const entry=page.locator('#tripmap-extension-entry');await expect(entry).toBeVisible();
 await expect(entry).toHaveCSS('position','fixed');
 const rect=await entry.boundingBox();
 if(Math.abs(rect.x-24)>1||Math.abs(rect.y-88)>1)throw Error('Floating entry not at inset top-left');
 if(!await entry.evaluate(el=>el.parentElement===document.documentElement))throw Error('Entry must be outside the Maps card');
 await page.screenshot({path:'/tmp/tripmap-floating-entry.png'});
 const cdp=await context.newCDPSession(page);
 async function clickEntry(close = false) {
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  function find(node) {
   if(node.nodeName==='BUTTON'&&node.attributes?.includes('aria-label')&&node.attributes.some(value=>close ? value==='關閉 TripMap 懸浮按鈕' : value.startsWith('加入 TripMap 地點：')))return node;
   for(const child of [...(node.children||[]),...(node.shadowRoots||[])]){const match=find(child);if(match)return match;}
  }
  const node=find(root);if(!node)throw Error('Entry button missing');
  const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:node.backendNodeId});
  const {result}=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}',returnByValue:true});
  await page.mouse.click(result.value.x,result.value.y);
 }
 await clickEntry();
 await expect(page.locator('#tripmap-extension-feedback')).toBeVisible();
 await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('tripmap:last-import'))['tripmap:last-import']?.status)).toBe('created');
 const payload=await worker.evaluate(()=>globalThis.testImports[0]);
 if(payload.p_latitude!==26.3316539||payload.p_longitude!==127.927996||payload.userId||payload.owner_uid)throw Error('Wrong import payload');
 async function feedbackState() {
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  function find(node) {
   if(node.attributes?.includes('data-state'))return node.attributes[node.attributes.indexOf('data-state')+1];
   for(const child of [...(node.children||[]),...(node.shadowRoots||[])]){const state=find(child);if(state)return state;}
  }
  return find(root);
 }
 await expect.poll(feedbackState).toBe('success');
 await expect(page.locator('#tripmap-extension-feedback')).toHaveCSS('pointer-events','none');
 await page.screenshot({path:'/tmp/tripmap-import-success.png'});
 console.log('PASS: trusted mouse click works despite Maps document capture; readonly floating success feedback');
 await worker.evaluate(()=>globalThis.testImportMode='duplicate');
 await clickEntry();
 await expect.poll(feedbackState).toBe('saving');
 await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('tripmap:last-import'))['tripmap:last-import']?.status)).toBe('duplicate');
 await worker.evaluate(()=>globalThis.testImportMode='error');
 await clickEntry();
 await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('tripmap:last-import'))['tripmap:last-import']?.status)).toBe('error');
 await expect.poll(feedbackState).toBe('error');
 await page.screenshot({path:'/tmp/tripmap-import-error.png'});
 console.log('PASS: floating saving/success/error feedback, duplicate result, no extra controls');
 const beforeClose=await worker.evaluate(()=>globalThis.testImports.length);
 await clickEntry(true);
 await expect(entry).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
 // URL decorations for the same place must not undo dismissal.
 await page.evaluate(()=>history.pushState({},'',location.href+'?entry=ttu'));
 await page.waitForTimeout(150);
 await expect(entry).toHaveCount(0);
 if(await worker.evaluate(()=>globalThis.testImports.length)!==beforeClose)throw Error('Close accidentally imported a place');
 await page.evaluate(()=>history.pushState({},'','/maps/place/Other+Place/data=!3d26.5!4d128.0'));
 await expect(entry).toBeVisible();
 console.log('PASS: close dismisses only entry, does not import; same place stays hidden, next place reappears');
 await page.evaluate(()=>history.pushState({},'','/maps/place/CameraOnly/@26.2,127.6,17z'));
 await expect(entry).toHaveCount(0);
 console.log('PASS: floating entry at inset top-left, removed on invalid location');
 await account.locator('#sign-out').click();await expect(account.locator('#sign-in')).toBeVisible();
 const cleared=await worker.evaluate(async key=>!(await chrome.storage.local.get(key))[key],storage.key);
 if(!cleared)throw Error('Logout left tokens');
 console.log('PASS: logout clears session');
 // Maps content scripts are deliberately not allowed to invoke account commands.
 if(errors.length)throw Error('Worker errors: '+errors.join(';'));
}finally{await context.close();}
