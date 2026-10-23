import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from './config.js';

const storageKey = `tripmap:auth:${new URL(supabaseUrl).hostname}`;
let clientPromise;
let loginPending = false;
let refreshPromise;
const refreshAlarm = 'tripmap:refresh-session';

function client() {
  if (!clientPromise) clientPromise = (async () => {
    // Tokens belong to trusted extension pages / the worker, never Maps content scripts.
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const auth = createClient(supabaseUrl, supabaseKey, {
      auth: {
        storageKey, flowType: 'pkce', persistSession: true,
        autoRefreshToken: false, detectSessionInUrl: false,
        storage: {
          async getItem(key) { return (await chrome.storage.local.get(key))[key] ?? null; },
          async setItem(key, value) {
            // Google API tokens are not needed for TripMap; retain only the Supabase session.
            if (key === storageKey) {
              const session = JSON.parse(value);
              delete session.provider_token;
              delete session.provider_refresh_token;
              value = JSON.stringify(session);
            }
            await chrome.storage.local.set({ [key]: value });
          },
          async removeItem(key) { await chrome.storage.local.remove(key); },
        },
      },
    });
    auth.auth.onAuthStateChange((_event, session) => {
      if (session) void chrome.alarms.create(refreshAlarm, { periodInMinutes: 4 });
      else void chrome.alarms.clear(refreshAlarm);
    });
    return auth;
  })();
  return clientPromise;
}

export function getOAuthRedirectUrl() { return chrome.identity.getRedirectURL('oauth'); }

export async function getUsableSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const supabase = await client();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    let session = data.session;
    if (session && session.expires_at * 1000 < Date.now() + 90000) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) throw new Error('登入更新失敗，請檢查網路或重新登入。');
      session = refreshed.data.session;
    }
    return session;
  })().finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

export async function accountStatus() {
  const session = await getUsableSession();
  return { email: session?.user?.email ?? null, signedIn: Boolean(session), redirectUrl: getOAuthRedirectUrl() };
}

export async function signIn() {
  if (loginPending) throw new Error('登入視窗已開啟，請完成登入。');
  loginPending = true;
  try {
    const supabase = await client();
    const redirectTo = getOAuthRedirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    if (error || !data.url) throw new Error(error?.message || '無法建立登入連線。');
    let returned;
    try { returned = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }); }
    catch { throw new Error('登入未完成。若回到 TripMap 網站，請確認 Supabase 已加入下方的固定回跳網址。'); }
    if (!returned) throw new Error('登入已取消。');
    const callback = new URL(returned);
    const expected = new URL(redirectTo);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) throw new Error('登入回跳網址不符。');
    const failure = callback.searchParams.get('error') || new URLSearchParams(callback.hash.slice(1)).get('error');
    if (failure) throw new Error('Google 授權未完成，請重新登入。');
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('登入回應缺少授權碼，請確認 Supabase 回跳設定。');
    const result = await supabase.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.session) throw new Error('無法完成登入驗證，請重新登入。');
    // Fetch email from the authenticated user endpoint, not from unverified URL fields.
    const user = await supabase.auth.getUser();
    if (user.error || !user.data.user) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('無法確認登入帳號，請重新登入。');
    }
    return { email: user.data.user.email ?? null, signedIn: true, redirectUrl: redirectTo };
  } finally {
    loginPending = false;
    await chrome.storage.local.remove(`${storageKey}-code-verifier`);
  }
}

export async function signOut() {
  const supabase = await client();
  const result = await supabase.auth.signOut({ scope: 'local' });
  if (result.error) throw new Error('登出失敗，請檢查網路後重試。');
  await chrome.alarms.clear(refreshAlarm);
  return { email: null, signedIn: false, redirectUrl: getOAuthRedirectUrl() };
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === refreshAlarm) void getUsableSession().catch(() => {
    console.warn('[TripMap] 登入更新暫時無法完成；請開啟帳號管理確認。');
  });
});
// Also reconcile expiry when Chrome wakes the worker after suspension/restart.
void getUsableSession().catch(() => {});
