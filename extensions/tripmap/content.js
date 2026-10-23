(() => {
  if (globalThis.__tripmapPreviewInstalled) return;
  globalThis.__tripmapPreviewInstalled = true;
  let host;
  let button;
  let closeButton;
  let dismissedPlace;
  let feedback;
  let feedbackTitle;
  let feedbackIcon;
  let feedbackPanel;
  let feedbackSection;
  let feedbackTimer;
  let activeImportUrl;
  const pendingUrls = new Set();
  let label;
  let candidate;
  let revision = 0;
  let lastUrl;

  function remove() {
    host?.remove();
    host = undefined;
    candidate = undefined;
  }

  function placeKey(place) {
    return `${place.name}\n${place.coordinate.latitude},${place.coordinate.longitude}`;
  }

  function dismissEntry() {
    if (candidate) dismissedPlace = placeKey(candidate);
    host?.remove();
    host = undefined;
    button = undefined;
    closeButton = undefined;
    label = undefined;
  }

  function show(place) {
    const key = placeKey(place);
    if (dismissedPlace && dismissedPlace !== key) dismissedPlace = undefined;
    if (dismissedPlace === key) {
      candidate = place;
      return;
    }
    const changedPlace = candidate?.sourceUrl !== place.sourceUrl;
    candidate = place;
    if (!host) {
      host = document.createElement('div');
      host.id = 'tripmap-extension-entry';
      host.style.cssText = 'position:fixed!important;top:88px!important;left:24px!important;right:auto!important;bottom:auto!important;z-index:2147483647!important;display:block!important;width:max-content!important;max-width:calc(100vw - 48px)!important;overflow:visible!important;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { color-scheme: light; }
        button { display:flex; align-items:center; gap:9px; min-height:44px; padding:0 18px;
          border:1px solid #d6e3d8; border-radius:24px; background:#fff; color:#345a40;
          box-shadow:0 3px 14px #203a2729; font:600 14px/1.3 system-ui,sans-serif; cursor:pointer; }
        button:hover { background:#edf5ee; border-color:#729b7c; }
        button:focus-visible { outline:3px solid #558662; outline-offset:3px; }
        .dismiss { position:absolute; top:-9px; right:-9px; display:grid; place-items:center;
          width:24px; height:24px; min-height:24px; padding:0; border-radius:50%;
          color:#65756a; font-size:18px; line-height:1; box-shadow:0 2px 7px #203a2720; }
        .dismiss:hover { color:#263e2d; background:#e7f0e8; }
        button:disabled { opacity:.65; cursor:wait; }
        svg { width:19px; height:19px; flex:none; }
        @media(max-width:600px) { button { padding:0 12px; } }
      `;
      button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span class="label">TripMap</span>';
      label = button.querySelector('.label');

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!button.disabled) void addCurrentPlace();
      });
      closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'dismiss';
      closeButton.textContent = '×';
      closeButton.title = '關閉';
      closeButton.setAttribute('aria-label', '關閉 TripMap 懸浮按鈕');
      closeButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissEntry();
      });
      shadow.append(style, button, closeButton);

    }
    button.title = `加入 TripMap 地點：${place.name}`;
    button.setAttribute('aria-label', `加入 TripMap 地點：${place.name}`);
    if (changedPlace) {
      button.disabled = pendingUrls.has(place.sourceUrl);
      label.textContent = button.disabled ? '加入中…' : 'TripMap';
    }
    if (!host.isConnected) document.documentElement.append(host);
  }

  function ensureFeedback() {
    if (feedbackPanel?.isConnected) return;
    feedbackPanel = document.createElement('div');
    feedbackPanel.id = 'tripmap-extension-feedback';
    feedbackPanel.style.cssText = 'position:fixed!important;right:24px!important;bottom:24px!important;width:min(340px,calc(100vw - 32px))!important;z-index:2147483647!important;pointer-events:none!important;';
    const shadow = feedbackPanel.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { color-scheme:light; }
      section { display:flex; align-items:flex-start; gap:12px; padding:18px 20px; border:1px solid #d6e3d8;
        border-radius:16px; background:#fff; color:#345a40; box-shadow:0 8px 30px #203a2730;
        font:14px/1.5 system-ui,sans-serif; }
      strong { display:block; margin-bottom:4px; font-size:14px; }
      p { margin:0; color:#66766b; font-size:12px; overflow-wrap:anywhere; white-space:pre-line; }
      .icon { display:grid; place-items:center; flex:0 0 22px; width:22px; height:22px;
        border-radius:50%; background:#eaf3eb; font-weight:700; }
      section[data-state=error] { border-color:#edd0c9; color:#a24134; }
      section[data-state=error] .icon { background:#fff0ed; }
      section[data-state=saving] .icon { box-sizing:border-box; background:transparent; border:2px solid #dce9de;
        border-top-color:#4f7e5c; animation:tripmap-spin .8s linear infinite; }
      @keyframes tripmap-spin { to { transform:rotate(360deg); } }
      @media(prefers-reduced-motion:reduce) { section[data-state=saving] .icon { animation:none; } }
    `;
    const section = document.createElement('section');
    section.setAttribute('role', 'status');
    section.setAttribute('aria-live', 'polite');
    section.setAttribute('aria-atomic', 'true');
    feedbackIcon = document.createElement('span');
    feedbackIcon.className = 'icon';
    feedbackIcon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div');
    feedbackTitle = document.createElement('strong');
    feedback = document.createElement('p');
    text.append(feedbackTitle, feedback);
    section.append(feedbackIcon, text);
    shadow.append(style, section);
    feedbackSection = section;
    document.documentElement.append(feedbackPanel);
  }

  function renderResult({ url, state, message }) {
    if (url !== location.href && url !== activeImportUrl) return;
    if (state === 'saving') activeImportUrl = url;
    clearTimeout(feedbackTimer);
    ensureFeedback();
    feedbackSection.dataset.state = state;
    feedbackTitle.textContent = state === 'saving' ? '加入地點中…' : state === 'error' ? '失敗' : '成功';
    feedback.textContent = state === 'saving' ? (candidate?.name || '正在確認地點資訊…') : (message || '');
    feedbackIcon.textContent = state === 'saving' ? '' : state === 'error' ? '!' : '✓';
    if (button && candidate?.sourceUrl === url) {
      button.disabled = state === 'saving';
      label.textContent = state === 'saving' ? '加入中…' : 'TripMap';
    }
    if (state !== 'saving') feedbackTimer = setTimeout(() => feedbackPanel?.remove(), state === 'error' ? 15000 : 8000);
  }

  async function addCurrentPlace() {
    const url = location.href;
    renderResult({ url, state: 'saving' });
    if (pendingUrls.has(url)) return;
    pendingUrls.add(url);
    try {
      if (lastUrl !== url || candidate?.sourceUrl !== url) await refresh();
      if (location.href !== url || !candidate) throw new Error('地點頁面已變更，請重新選取地點。');
      const response = await chrome.runtime.sendMessage({ type: 'tripmap:add-place', url });
      if (response?.error) throw new Error(response.error);
      if (!response?.result) throw new Error('無法確認新增結果，請重試。');
      renderResult({ url, state: 'success', message: response.result.message });
    } catch (error) {
      const message = /context invalidated|receiving end does not exist/i.test(error.message)
        ? '擴充套件已更新，請重新整理 Google Maps 頁面後再試。' : error.message;
      renderResult({ url, state: 'error', message });
    } finally {
      pendingUrls.delete(url);
    }
  }

  // Isolate only trusted input on our two floating controls from Maps handlers.
  function entryControl(event) {
    if (!event.isTrusted || !host?.isConnected || !button || !event.composedPath().includes(host)) return;
    if (event.detail === 0 && event.type === 'click') {
      const focused = button.getRootNode().activeElement;
      return focused === closeButton ? closeButton : button;
    }
    for (const control of [closeButton, button]) {
      const rect = control.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom) return control;
    }
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    window.addEventListener(type, event => {
      const control = entryControl(event);
      if (!control) return;
      event.stopImmediatePropagation();
      if (type === 'click') {
        event.preventDefault();
        if (control === closeButton) dismissEntry();
        else if (!button.disabled) void addCurrentPlace();
      }
    }, true);
  }

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
    if (message?.type === 'tripmap:import-result') renderResult(message);
  });
  window.addEventListener('popstate', () => void refresh());
  window.addEventListener('hashchange', () => void refresh());
  window.addEventListener('pageshow', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
  void refresh();
})();
