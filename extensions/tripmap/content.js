(() => {
  if (globalThis.__tripmapPreviewInstalled) return;
  globalThis.__tripmapPreviewInstalled = true;
  let host;
  let button;
  let candidate;
  let revision = 0;
  let lastUrl;

  function remove() {
    host?.remove();
    host = undefined;
    candidate = undefined;
  }

  function show(place) {
    candidate = place;
    if (!host) {
      host = document.createElement('div');
      host.id = 'tripmap-extension-entry';
      host.style.cssText = 'display:flex!important;justify-content:center!important;align-items:center!important;width:100%!important;box-sizing:border-box!important;padding:8px 0 12px!important;flex-shrink:0!important;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { color-scheme: light; }
        button { display:flex; align-items:center; gap:9px; min-height:44px; padding:0 18px;
          border:1px solid #d6e3d8; border-radius:24px; background:#fff; color:#345a40;
          box-shadow:0 3px 14px #203a2729; font:600 14px/1.3 system-ui,sans-serif; cursor:pointer; }
        button:hover { background:#edf5ee; border-color:#729b7c; }
        button:focus-visible { outline:3px solid #558662; outline-offset:3px; }
        svg { width:19px; height:19px; flex:none; }
        @media(max-width:600px) { button { padding:0 12px; } }
      `;
      button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>TripMap</span>';
      button.addEventListener('click', () => {
        // A placeholder only: re-check URL so an old place is never submitted later.
        if (lastUrl !== location.href) { void refresh(); return; }
        console.info('[TripMap] 入口預覽；本版不儲存地點', candidate);
      });
      shadow.append(style, button);

    }
    button.title = `加入 TripMap 地點：${place.name}`;
    button.setAttribute('aria-label', `加入 TripMap 地點：${place.name}`);
    positionInPlaceCard();
  }

  function positionInPlaceCard() {
    if (!candidate || !host) return;
    const tabs = [...document.querySelectorAll('[role="tablist"]')].find(element => {
      const pane = element.closest('[role="main"]');
      const heading = pane?.querySelector('h1');
      return Boolean(heading && (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    if (!tabs?.parentElement) {
      host.remove();
      return;
    }
    if (host.parentElement !== tabs.parentElement || host.nextSibling !== tabs) {
      tabs.parentElement.insertBefore(host, tabs);
    }
  }

  let placementScheduled = false;
  const observer = new MutationObserver(records => {
    if (!candidate || placementScheduled || records.every(record => record.target === host)) return;
    placementScheduled = true;
    requestAnimationFrame(() => {
      placementScheduled = false;
      positionInPlaceCard();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  async function refresh() {
    const currentRevision = ++revision;
    const url = location.href;
    lastUrl = url;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'tripmap:inspect', url });
      if (currentRevision !== revision || url !== location.href) return;
      if (result?.place) show(result.place);
      else remove();
    } catch {
      // Reloading an unpacked extension invalidates content scripts in existing tabs.
      remove();
    }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'tripmap:refresh') void refresh();
  });
  window.addEventListener('popstate', () => void refresh());
  window.addEventListener('hashchange', () => void refresh());
  window.addEventListener('pageshow', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
  void refresh();
})();
