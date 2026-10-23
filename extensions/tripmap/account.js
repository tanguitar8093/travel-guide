const status = document.getElementById('status');
const email = document.getElementById('email');
const signedIn = document.getElementById('signed-in');
const signIn = document.getElementById('sign-in');
const signOut = document.getElementById('sign-out');
const error = document.getElementById('error');
const redirect = document.getElementById('redirect');
let busy = false;

function display(account) {
  email.textContent = account.email || '未提供電子郵件';
  signedIn.hidden = !account.signedIn;
  signIn.hidden = account.signedIn;
  status.textContent = account.signedIn ? '已登入' : '登入後連結你的 TripMap 帳號。';
  redirect.textContent = account.redirectUrl;
}

async function request(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (response?.error) throw new Error(response.error);
  if (!response?.account) throw new Error('無法讀取帳號狀態，請重新開啟此介面。');
  return response.account;
}

async function act(type) {
  if (busy) return;
  busy = true;
  signIn.disabled = signOut.disabled = true;
  error.hidden = true;
  if (type === 'tripmap:sign-in') status.textContent = '請在 Google 視窗完成登入…';
  try { display(await request(type)); }
  catch (cause) {
    error.textContent = cause.message || '連線失敗，請稍後重試。';
    error.hidden = false;
    if (signedIn.hidden) {
      signIn.hidden = false;
      status.textContent = '尚未完成登入。';
    }
  } finally {
    busy = false;
    signIn.disabled = signOut.disabled = false;
  }
}

signIn.addEventListener('click', () => void act('tripmap:sign-in'));
signOut.addEventListener('click', () => void act('tripmap:sign-out'));
// Session changes may finish after Chrome closes the toolbar popup for OAuth.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local' && !busy) void act('tripmap:account');
});
document.getElementById('copy').addEventListener('click', async () => {
  const copyStatus = document.getElementById('copy-status');
  try { await navigator.clipboard.writeText(redirect.textContent); copyStatus.textContent = '已複製'; }
  catch { copyStatus.textContent = '請選取上方網址後複製。'; }
});
redirect.textContent = chrome.identity.getRedirectURL('oauth');
void act('tripmap:account');
