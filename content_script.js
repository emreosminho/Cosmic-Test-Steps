// content_script.js
// Responsibilities:
//   - Inject and toggle the sidebar iframe
//   - Relay screenshot requests between panel and background
//   - Persist panel open/close state across tabs via chrome.storage.session

const PANEL_WIDTH  = '360px';
const PANEL_ID     = '__qa_test_panel_iframe__';
const TOGGLE_ID    = '__qa_test_panel_toggle__';
const STORAGE_KEY  = 'qa_panel_open';

let panelIframe  = null;
let toggleTab    = null;
let panelVisible = false;
let panelSuppressed = false; // geçici gizleme (ekran görüntüsü / alan seçimi)

// ─── Panel lifecycle ──────────────────────────────────────────────────────────

function createToggleTab() {
  const existing = document.getElementById(TOGGLE_ID);
  if (existing) existing.remove();

  const tab = document.createElement('button');
  tab.id = TOGGLE_ID;
  tab.title = 'Paneli gizle / göster';
  tab.innerHTML = '&#8250;'; // ›

  Object.assign(tab.style, {
    position:        'fixed',
    top:             '50%',
    right:           PANEL_WIDTH,
    transform:       'translateY(-50%)',
    width:           '18px',
    height:          '48px',
    background:      '#2a2520',
    color:           '#ebe8ec',
    border:          'none',
    borderRadius:    '6px 0 0 6px',
    cursor:          'pointer',
    zIndex:          '2147483646',
    fontSize:        '18px',
    lineHeight:      '1',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    boxShadow:       '-2px 0 8px rgba(0,0,0,0.18)',
    transition:      'right 0.25s ease, background 0.15s',
    padding:         '0',
    outline:         'none',
  });

  tab.addEventListener('mouseenter', () => { tab.style.background = '#D07E47'; });
  tab.addEventListener('mouseleave', () => { tab.style.background = panelVisible ? '#2a2520' : '#3d3540'; });
  tab.addEventListener('click', () => togglePanel());

  document.documentElement.appendChild(tab);
  return tab;
}

function createPanel() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id  = PANEL_ID;
  iframe.src = chrome.runtime.getURL('panel/panel.html');

  Object.assign(iframe.style, {
    position:   'fixed',
    top:        '0',
    right:      '0',
    width:      PANEL_WIDTH,
    height:     '100vh',
    border:     'none',
    zIndex:     '2147483647',
    boxShadow:  '-4px 0 20px rgba(42,37,32,0.18)',
    background: 'transparent',
    transition: 'right 0.25s ease',
  });

  if (!toggleTab) toggleTab = createToggleTab();

  document.documentElement.appendChild(iframe);
  applyBodyMargin(true);
  panelVisible = true;
  return iframe;
}

function showPanel() {
  panelSuppressed = false;
  panelIframe.style.display = 'block';
  applyBodyMargin(true);
  panelVisible = true;
  if (toggleTab) {
    toggleTab.style.right = PANEL_WIDTH;
    toggleTab.innerHTML = '&#8250;'; // ›  (close arrow)
    toggleTab.style.background = '#2a2520';
  }
}

function hidePanel() {
  panelSuppressed = false;
  panelIframe.style.display = 'none';
  applyBodyMargin(false);
  panelVisible = false;
  if (toggleTab) {
    toggleTab.style.right = '0';
    toggleTab.innerHTML = '&#8249;'; // ‹  (open arrow)
    toggleTab.style.background = '#3d3540';
  }
}

// Toggle and persist the new state for other tabs
function togglePanel() {
  if (!panelIframe) {
    panelIframe = createPanel();
    setPanelState(true);
  } else if (panelVisible) {
    hidePanel();
    setPanelState(false);
  } else {
    showPanel();
    setPanelState(true);
  }
}

// Open without toggling (used when auto-restoring state on a new tab)
function openPanel() {
  if (!toggleTab) toggleTab = createToggleTab();
  if (!panelIframe) {
    panelIframe = createPanel();
  } else if (!panelVisible) {
    showPanel();
  }
}

// Push page content left so the panel doesn't cover it
function applyBodyMargin(enable) {
  if (enable) {
    document.documentElement.style.setProperty('margin-right', PANEL_WIDTH, 'important');
  } else {
    document.documentElement.style.setProperty('margin-right', '0', 'important');
  }
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function setPanelState(isOpen) {
  chrome.storage.session.set({ [STORAGE_KEY]: isOpen });
}

// On load: restore panel if it was open in another tab
if (chrome?.storage?.session) {
  chrome.storage.session.get(STORAGE_KEY, (result) => {
    if (result[STORAGE_KEY] === true) openPanel();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !(STORAGE_KEY in changes)) return;
    const shouldBeOpen = changes[STORAGE_KEY].newValue;
    if (shouldBeOpen && !panelVisible) openPanel();
    else if (!shouldBeOpen && panelVisible) hidePanel();
  });
}

// ─── Screenshot capture ───────────────────────────────────────────────────────

function ensurePanelExists() {
  if (!panelIframe) {
    panelIframe = createPanel();
    hidePanel();
    setPanelState(false);
  }
  if (!toggleTab) toggleTab = createToggleTab();
}

function hidePanelVisually() {
  panelSuppressed = true;
  if (panelIframe) {
    panelIframe.style.display = 'none';
    panelIframe.style.visibility = 'visible';
  }
  applyBodyMargin(false);
  if (!toggleTab) toggleTab = createToggleTab();
  toggleTab.style.display = 'flex';
  toggleTab.style.right = '0';
  toggleTab.innerHTML = '&#8249;';
  toggleTab.style.background = '#3d3540';
}

function hideUiForCapture() {
  const wasVisible = panelVisible;
  hidePanelVisually();
  return wasVisible;
}

function restorePanelIfWasVisible(wasVisible) {
  if (!wasVisible || !panelIframe) return;
  showPanel();
}

function restoreUiAfterCancel(wasVisible) {
  if (wasVisible) {
    showPanel();
  } else {
    hidePanelVisually();
  }
}

async function captureTabImage() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, resolve);
  });
}

async function cropImage(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scaleX = img.naturalWidth / window.innerWidth;
      const scaleY = img.naturalHeight / window.innerHeight;
      const sx = Math.round(rect.x * scaleX);
      const sy = Math.round(rect.y * scaleY);
      const sw = Math.max(1, Math.round(rect.width * scaleX));
      const sh = Math.max(1, Math.round(rect.height * scaleY));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Görüntü kırpılamadı'));
    img.src = dataUrl;
  });
}

function deliverCaptureResult(dataUrl, panelWasVisible) {
  ensurePanelExists();
  if (panelWasVisible) {
    panelIframe.contentWindow.postMessage({ type: 'SCREENSHOT_DONE', dataUrl }, '*');
  } else {
    showCaptureOverlay(dataUrl);
  }
}

function deliverCaptureError(error, panelWasVisible) {
  ensurePanelExists();
  if (panelWasVisible) {
    panelIframe.contentWindow.postMessage(
      { type: 'SCREENSHOT_ERROR', error: error || 'Bilinmeyen hata' },
      '*'
    );
  }
}

async function captureScreenshot() {
  const wasVisible = panelVisible;

  if (wasVisible) {
    panelSuppressed = true;
    panelIframe.style.visibility = 'hidden';
    applyBodyMargin(false);
  }

  await new Promise(resolve => setTimeout(resolve, 150));

  const response = await captureTabImage();

  if (wasVisible) {
    panelSuppressed = false;
    applyBodyMargin(true);
    panelIframe.style.visibility = 'visible';
  }

  if (response?.success) {
    deliverCaptureResult(response.dataUrl, wasVisible);
  } else {
    deliverCaptureError(response?.error, wasVisible);
  }
}

const REGION_OVERLAY_ID = '__qa_region_overlay__';

function showRegionSelector() {
  return new Promise((resolve) => {
    if (document.getElementById(REGION_OVERLAY_ID)) {
      resolve(null);
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = REGION_OVERLAY_ID;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483644',
      cursor: 'crosshair', background: 'transparent',
      userSelect: 'none',
    });

    const selection = document.createElement('div');
    Object.assign(selection.style, {
      position: 'fixed', display: 'none', pointerEvents: 'none',
      border: '2px solid #D07E47',
      background: 'rgba(208,126,71,0.15)',
      boxShadow: '0 0 0 9999px rgba(42,37,32,0.35)',
      borderRadius: '2px',
    });

    const hint = document.createElement('div');
    hint.textContent = 'Fare ile alan seçin · Esc ile iptal';
    Object.assign(hint.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: '#2a2520', color: '#ebe8ec', fontSize: '12px', fontWeight: '600',
      padding: '8px 16px', borderRadius: '20px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)', pointerEvents: 'none',
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    });

    let startX = 0, startY = 0, dragging = false;

    function updateBox(cx, cy) {
      const x = Math.min(startX, cx);
      const y = Math.min(startY, cy);
      const w = Math.abs(cx - startX);
      const h = Math.abs(cy - startY);
      selection.style.left = `${x}px`;
      selection.style.top = `${y}px`;
      selection.style.width = `${w}px`;
      selection.style.height = `${h}px`;
      selection.style.display = w > 0 && h > 0 ? 'block' : 'none';
    }

    function cleanup() {
      overlay.remove();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey, true);
    }

    function onMove(e) {
      if (!dragging) return;
      updateBox(e.clientX, e.clientY);
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      cleanup();
      if (w < 8 || h < 8) resolve(null);
      else resolve({ x, y, width: w, height: h });
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        dragging = false;
        cleanup();
        resolve(null);
      }
    }

    overlay.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      updateBox(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey, true);

    overlay.appendChild(selection);
    overlay.appendChild(hint);
    document.documentElement.appendChild(overlay);
  });
}

async function startRegionCapture() {
  if (document.getElementById(REGION_OVERLAY_ID)) return;

  ensurePanelExists();
  const wasVisible = hideUiForCapture();
  await new Promise(resolve => setTimeout(resolve, 50));

  const rect = await showRegionSelector();

  if (!rect) {
    restoreUiAfterCancel(wasVisible);
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 150));

  const response = await captureTabImage();

  if (!response?.success) {
    restoreUiAfterCancel(wasVisible);
    if (wasVisible) {
      panelIframe.contentWindow.postMessage(
        { type: 'SCREENSHOT_ERROR', error: response?.error || 'Bilinmeyen hata' },
        '*'
      );
    }
    return;
  }

  try {
    const cropped = await cropImage(response.dataUrl, rect);
    showCaptureOverlay(cropped, { restorePanelVisible: wasVisible });
  } catch (err) {
    // Kırpma başarısız olursa tam görüntüyle önizleme göster
    showCaptureOverlay(response.dataUrl, { restorePanelVisible: wasVisible });
  }
}

// Panel kapalıyken çekilen görüntü → overlay modal göster
async function captureWithOverlay() {
  await new Promise(resolve => setTimeout(resolve, 150));

  const response = await captureTabImage();

  if (!response?.success) return;
  showCaptureOverlay(response.dataUrl);
}

function showCaptureOverlay(dataUrl, options = {}) {
  const { restorePanelVisible = false } = options;
  const OVERLAY_ID = '__qa_capture_overlay__';

  // Mevcut önizleme varsa kaldır
  document.getElementById(OVERLAY_ID)?.remove();

  // Panel gizle, açma butonu (‹) görünür kalsın
  hidePanelVisually();

  const S = (obj) => Object.entries(obj).map(([k,v]) => `${k.replace(/([A-Z])/g,'-$1').toLowerCase()}:${v}`).join(';');

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.tabIndex = -1;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0',
    background: 'rgba(42,37,32,0.78)',
    zIndex: '2147483647',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  });

  overlay.innerHTML = `
    <style>
      @keyframes qaFadeIn { from{opacity:0;transform:scale(.97)} to{opacity:1;transform:scale(1)} }
    </style>
    <div id="__qa_overlay_card__" style="${S({
      background: '#fff', borderRadius: '12px',
      width: 'min(560px,92vw)', maxHeight: '90vh',
      overflowY: 'auto', display: 'flex', flexDirection: 'column',
      boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
    })}">
      <div style="${S({
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', background:'#2a2520', borderRadius:'12px 12px 0 0',
      })}">
        <span style="color:#ebe8ec;font-size:13px;font-weight:700;">Önizleme — açıklama ekle</span>
        <button id="__qa_overlay_close__" style="${S({
          background:'none', border:'none', color:'rgba(235,232,236,.6)',
          fontSize:'20px', cursor:'pointer', lineHeight:'1', padding:'0 4px',
        })}" title="İptal">×</button>
      </div>

      <div style="${S({ padding:'0', borderBottom:'1px solid #e8e3df' })}">
        <img src="${dataUrl}" style="${S({
          display:'block', width:'100%', maxHeight:'340px',
          objectFit:'contain', background:'#f5f3f1',
        })}" alt="Ekran görüntüsü" />
      </div>

      <div style="${S({ padding:'12px 14px', borderBottom:'1px solid #e8e3df' })}">
        <textarea id="__qa_overlay_desc__"
          placeholder="Bu adımda ne yaptınızı yazın…"
          rows="4"
          style="${S({
            width:'100%', resize:'vertical',
            border:'1px solid #e8e3df', borderRadius:'6px',
            padding:'8px 10px', fontSize:'13px',
            fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
            color:'#2a2520', background:'#faf9f8', outline:'none',
            lineHeight:'1.55', boxSizing:'border-box',
          })}"></textarea>
      </div>

      <div style="${S({
        display:'flex', justifyContent:'flex-end', gap:'8px',
        padding:'12px 14px',
      })}">
        <button id="__qa_overlay_cancel__" style="${S({
          padding:'7px 16px', borderRadius:'6px', border:'1px solid #e8e3df',
          background:'#f5f3f1', color:'#6b5d52', fontSize:'12px',
          fontWeight:'600', cursor:'pointer',
        })}">İptal</button>
        <button id="__qa_overlay_send__" style="${S({
          padding:'7px 16px', borderRadius:'6px', border:'none',
          background:'#D07E47', color:'#fff', fontSize:'12px',
          fontWeight:'600', cursor:'pointer',
        })}">Panele Ekle →</button>
      </div>
    </div>`;

  document.documentElement.appendChild(overlay);
  overlay.focus();

  setTimeout(() => document.getElementById('__qa_overlay_desc__')?.focus(), 80);

  function closeOverlay(restorePanel = restorePanelVisible) {
    overlay.remove();
    if (restorePanel) {
      restorePanelIfWasVisible(true);
    } else {
      restoreUiAfterCancel(false);
    }
  }

  document.getElementById('__qa_overlay_close__').addEventListener('click', () => closeOverlay());
  document.getElementById('__qa_overlay_cancel__').addEventListener('click', () => closeOverlay());

  document.getElementById('__qa_overlay_send__').addEventListener('click', () => {
    const desc = document.getElementById('__qa_overlay_desc__')?.value || '';

    if (!panelIframe) {
      panelIframe = createPanel();
      hidePanel();
      setPanelState(false);
    }

    panelIframe.contentWindow.postMessage(
      { type: 'ADD_STEP_EXTERNAL', dataUrl, description: desc },
      '*'
    );
    closeOverlay(restorePanelVisible);
  });

  // Esc to close
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });
  // Click backdrop to close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
}

// ─── Message listeners ────────────────────────────────────────────────────────

// Messages from background.js (extension icon click → toggle)
if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'TOGGLE_PANEL') {
      togglePanel();
      sendResponse({ ok: true });
    }
  });
}

// Messages from the panel iframe (panel.js → content_script)
window.addEventListener('message', (event) => {
  // Guard: chrome.runtime may be undefined if extension was reloaded
  if (!chrome?.runtime?.getURL) return;

  const extensionOrigin = chrome.runtime.getURL('').slice(0, -1);
  if (event.origin !== extensionOrigin) return;

  if (event.data?.type === 'CAPTURE_SCREENSHOT') {
    captureScreenshot();
  }

  if (event.data?.type === 'START_REGION_CAPTURE') {
    startRegionCapture();
  }
});

// Global shortcuts
document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || !e.shiftKey) return;

  const key = e.key.toLowerCase();

  // Cmd+Shift+S — full page capture
  if (key === 's') {
    ensurePanelExists();
    e.preventDefault();
    if (panelVisible) {
      panelIframe.contentWindow.postMessage({ type: 'TRIGGER_CAPTURE' }, '*');
    } else {
      captureWithOverlay();
    }
    return;
  }

  // Cmd+Shift+X — region capture
  if (key === 'x') {
    e.preventDefault();
    startRegionCapture();
  }
}, true);

// ─── SPA / navigation resilience ─────────────────────────────────────────────

function repairPanel() {
  if (!panelIframe) return;

  // Re-attach iframe if SPA removed it from DOM
  if (!document.contains(panelIframe)) {
    document.documentElement.appendChild(panelIframe);
  }
  // Re-attach toggle tab if removed
  if (toggleTab && !document.contains(toggleTab)) {
    document.documentElement.appendChild(toggleTab);
  }
  // Margin yalnızca panel gerçekten görünürken uygulansın
  if (panelVisible && !panelSuppressed) {
    applyBodyMargin(true);
  } else if (panelSuppressed || !panelVisible) {
    applyBodyMargin(false);
  }
}

// Watch for our elements being removed by SPA framework DOM replacements
const _domObserver = new MutationObserver(repairPanel);
_domObserver.observe(document.documentElement, { childList: true, subtree: false });

// SPA history navigation (pushState / replaceState / back-forward)
function onSpaNavigate() {
  // Brief delay to let the SPA finish its DOM update before we repair
  setTimeout(repairPanel, 100);
}

window.addEventListener('popstate', onSpaNavigate);

// Intercept pushState / replaceState to catch programmatic SPA navigation
(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _push(...args);
    onSpaNavigate();
  };
  history.replaceState = function (...args) {
    _replace(...args);
    onSpaNavigate();
  };
})();
