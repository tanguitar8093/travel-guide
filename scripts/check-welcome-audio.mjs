// Real AuthGate in a browser; controlled media events/auth state, no real login or account writes.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.TRIPMAP_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const source = await (await context.request.get(base + '/src/auth/useAuth.ts')).text();
  const reactPath = source.match(/from "([^\"]*\/react\.js[^\"]*)"/)[1];
  const contextPath = source.match(/from "([^\"]*\/auth-context[^\"]*)"/)[1];
  await context.addInitScript(() => {
    let resolvePlay;
    window.playCalls = 0;
    window.blockAudio = false;
    let paused = true;
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get: () => paused });
    HTMLMediaElement.prototype.play = function () {
      window.playCalls++;
      if (window.blockAudio) return Promise.reject(new DOMException('Blocked autoplay', 'NotAllowedError'));
      paused = false;
      return new Promise(resolve => { resolvePlay = resolve; });
    };
    HTMLMediaElement.prototype.pause = function () { paused = true; };
    window.startAudio = () => {
      const audio = document.getElementById('login-welcome-audio');
      paused = false;
      audio.dispatchEvent(new Event('playing'));
      resolvePlay?.();
    };
    window.endAudio = () => document.getElementById('login-welcome-audio').dispatchEvent(new Event('ended'));
  });
  await context.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '${reactPath}';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { AuthContext } from '${contextPath}';
    import { AuthGate } from '/src/auth/AuthGate.tsx';
    function Fixture() {
      const [ready,setReady]=React.useState(false),[welcome,setWelcome]=React.useState(true);
      window.setAuthReady=()=>setReady(true);
      return React.createElement(AuthContext.Provider,{value:{
        status:ready?'authenticated':'loading',loginWelcomeRequired:welcome,
        hasWorkspaceAccess:ready,userRole:'member',completeLoginWelcome:()=>setWelcome(false),
        clearError(){},signInWithGoogle(){},signOut(){}
      }},React.createElement(AuthGate,null,React.createElement('div',{'data-testid':'workspace'},'workspace')));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Fixture)));
  ` }));
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror', error=>{errors.push(error.message);console.error(error.message)});
  await page.goto(base);
  await page.waitForFunction(()=>window.playCalls>0);
  assert.equal(await page.locator('.okinawa-login-scene').count(),0,'welcome must wait for actual playback');
  assert.equal(await page.locator('.auth-panel-loading').count(),0,'keep the login card without a flag detour');
  assert.equal(await page.getByTestId('workspace').count(),0);
  assert.equal(await page.locator('#login-welcome-audio').getAttribute('preload'),'auto');
  await page.evaluate(()=>window.startAudio());
  await page.locator('.okinawa-login-scene').waitFor();
  assert.equal(await page.getByTestId('workspace').count(),0,'audio starts before auth/data finishes');
  const plays=await page.evaluate(()=>window.playCalls);
  await page.evaluate(()=>window.setAuthReady());
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.okinawa-login-scene').count(),1);
  assert.equal(await page.getByTestId('workspace').count(),0,'ready data must not skip the music');
  assert.equal(await page.evaluate(()=>window.playCalls),plays,'auth update must not restart music');
  await page.evaluate(()=>window.endAudio());
  await page.getByTestId('workspace').waitFor();
  // Invert ordering: keep the original welcome until both music and data are ready.
  await page.reload();
  await page.waitForFunction(()=>window.playCalls>0);
  await page.evaluate(()=>window.startAudio());
  await page.locator('.okinawa-login-scene').waitFor();
  await page.evaluate(()=>window.endAudio());
  await page.locator('.okinawa-login-scene').waitFor();
  assert.equal(await page.getByTestId('workspace').count(),0);
  await page.evaluate(()=>window.setAuthReady());
  await page.getByTestId('workspace').waitFor();
  // Autoplay rejection is never reported as successful playback; activation retries.
  await page.addInitScript(()=>{window.blockAudio=true;});
  await page.reload();
  await page.waitForFunction(()=>window.playCalls>0);
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.okinawa-login-scene').count(),0);
  await page.evaluate(()=>{window.blockAudio=false;window.dispatchEvent(new Event('pointerdown'));});
  await page.evaluate(()=>window.startAudio());
  await page.locator('.okinawa-login-scene').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: preloaded audio reused; login card retained until actual playback, then island and sound start together; audio/data finish in either order; no restart after rerender under StrictMode; autoplay rejection/activation retry.');
} finally { await browser.close(); }
