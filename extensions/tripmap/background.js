import { accountStatus, signIn, signOut } from './vendor/auth.js';
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
  if (message?.type === 'tripmap:inspect') {
    respond({ place: parsePlaceUrl(message.url) });
    void updateMenu();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== menuId) return;
  const place = parsePlaceUrl(info.pageUrl || tab?.url);
  if (place) console.info('[TripMap] 入口預覽；本版不儲存地點', place);
});

// Reconcile persisted menus whenever Chrome wakes the service worker.
void updateMenu();
