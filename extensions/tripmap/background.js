import { accountStatus, signIn, signOut, importPlace } from './vendor/auth.js';
import { parsePlaceUrl } from './place-url.js';

const menuId = 'tripmap-add-place';
let menuUpdates = Promise.resolve();

function updateMenu() {
  menuUpdates = menuUpdates.catch(console.warn).then(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const place = parsePlaceUrl(tab?.url);
    const properties = {
      title: '加入 TripMap 地點', contexts: ['page', 'selection', 'link', 'image'],
      visible: Boolean(place),
      // Keep a persisted menu from leaking into unrelated sites after worker suspension.
      documentUrlPatterns: ['https://*.google.com/maps*', 'https://maps.google.com/*',
        'https://*.google.com.tw/maps*', 'https://maps.google.com.tw/*',
        'https://*.google.co.jp/maps*', 'https://maps.google.co.jp/*',
        'https://*.google.co.uk/maps*', 'https://maps.google.co.uk/*'],
    };
    try { await chrome.contextMenus.update(menuId, properties); }
    catch { await chrome.contextMenus.create({ id: menuId, ...properties }); }
  }).catch(error => console.warn('[TripMap] 更新右鍵選單失敗', error));
  return menuUpdates;
}

chrome.runtime.onInstalled.addListener(() => void updateMenu());
chrome.runtime.onStartup.addListener(() => void updateMenu());
chrome.tabs.onActivated.addListener(() => void updateMenu());
chrome.windows.onFocusChanged.addListener(() => void updateMenu());
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.url || change.status === 'complete')) void updateMenu();
});

function navigationChanged(details) {
  if (details.frameId !== 0) return;
  void chrome.tabs.sendMessage(details.tabId, { type: 'tripmap:refresh' }).catch(() => {});
  void updateMenu();
}
chrome.webNavigation.onHistoryStateUpdated.addListener(navigationChanged);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(navigationChanged);

const pendingImports = new Map();
async function addPlace(tabId, url) {
  const place = parsePlaceUrl(url);
  const current = await chrome.tabs.get(tabId);
  if (!place || current.url !== url) throw new Error('地點頁面已變更，請重新選取地點。');
  const key = `${tabId}:${url}`;
  if (pendingImports.has(key)) return pendingImports.get(key);
  const work = (async () => {
    void chrome.tabs.sendMessage(tabId, { type: 'tripmap:import-result', url, state: 'saving' }).catch(() => {});
    try {
      const result = await importPlace(place, crypto.randomUUID());
      const message = result.status === 'duplicate'
        ? result.reason === 'nearby' ? `附近已有「${result.name}」，未重複新增。` : `已有同名地點「${result.name}」，未重複新增。`
        : `已加入「${result.name}」`;
      void chrome.tabs.sendMessage(tabId, { type: 'tripmap:import-result', url, state: 'success', message }).catch(() => {});
      await chrome.storage.local.set({ 'tripmap:last-import': { name: place.name, status: result.status, message, at: Date.now() } });
      return { ...result, message };
    } catch (error) {
      void chrome.tabs.sendMessage(tabId, { type: 'tripmap:import-result', url, state: 'error', message: error.message }).catch(() => {});
      await chrome.storage.local.set({ 'tripmap:last-import': { name: place.name, status: 'error', message: error.message, at: Date.now() } });
      throw error;
    }
  })().finally(() => pendingImports.delete(key));
  pendingImports.set(key, work);
  return work;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const accountPage = sender.url === chrome.runtime.getURL('account.html');
  if (accountPage && ['tripmap:account', 'tripmap:sign-in', 'tripmap:sign-out'].includes(message?.type)) {
    const operation = message.type === 'tripmap:sign-in' ? signIn
      : message.type === 'tripmap:sign-out' ? signOut : accountStatus;
    void operation().then(account => respond({ account })).catch(error => respond({ error: error.message }));
    return true;
  }
  if (!sender.tab || sender.frameId !== 0) return;
  if (message?.type === 'tripmap:add-place') {
    void addPlace(sender.tab.id, message.url).then(result => respond({ result })).catch(error => respond({ error: error.message }));
    return true;
  }
  if (message?.type === 'tripmap:inspect') {
    respond({ place: parsePlaceUrl(message.url) });
    void updateMenu();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== menuId) return;
  if (tab?.id) void addPlace(tab.id, info.pageUrl || tab.url).catch(error => console.warn('[TripMap]', error.message));
});

// Reconcile persisted menus whenever Chrome wakes the service worker.
void updateMenu();
