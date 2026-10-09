// background.js — Service Worker
// Handles: (1) extension icon click → toggle panel, (2) screenshot capture requests

chrome.action.onClicked.addListener((tab) => {
  console.log('[QA bg] action clicked — tabId:', tab.id, '| url:', tab.url);

  if (!tab.id) return;

  const url = tab.url || '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url === ''
  ) {
    console.warn('[QA bg] Blocked: cannot run on this page type.');
    return;
  }

  function doToggle(tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_PANEL' }, () => {
      void chrome.runtime.lastError; // consume silently
    });
  }

  // Try sending directly first; if content script isn't there yet, inject it.
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, () => {
    const err = chrome.runtime.lastError;
    if (!err) {
      console.log('[QA bg] TOGGLE_PANEL delivered OK');
      return;
    }

    console.log('[QA bg] sendMessage error:', err.message, '— injecting script…');

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content_script.js'] },
      () => {
        if (chrome.runtime.lastError) {
          console.error('[QA bg] inject failed:', chrome.runtime.lastError.message);
          return;
        }
        console.log('[QA bg] inject OK — sending TOGGLE_PANEL');
        setTimeout(() => doToggle(tab.id), 150);
      }
    );
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_SCREENSHOT') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID found' });
      return false;
    }

    // captureVisibleTab captures the currently visible area of the active tab
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => {
        sendResponse({ success: true, dataUrl });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  }
});
