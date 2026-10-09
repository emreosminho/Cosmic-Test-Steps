// panel.js — runs inside the extension iframe
// Manages the step list, communicates with content_script, generates the HTML report

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let steps = [];        // { id, dataUrl, description, timestamp }
let stepCounter = 0;
let capturing = false;

const DEFAULT_TEST_TITLE = 'QA Test Steps';
const STATE_KEY = 'qa_test_state';
let testTitle = DEFAULT_TEST_TITLE;
let saveTimer = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const btnCapture = document.getElementById('btn-capture');
const btnFinish  = document.getElementById('btn-finish');
const btnClear   = document.getElementById('btn-clear');
const btnEditTitle = document.getElementById('btn-edit-title');
const titleTextEl  = document.getElementById('test-title-text');
const statusText = document.getElementById('status-text');
const stepsWrapper = document.getElementById('steps-wrapper');
const emptyState = document.getElementById('empty-state');
const badge = document.getElementById('step-count-badge');

// ─── Toolbar button handlers ──────────────────────────────────────────────────

btnCapture.addEventListener('click', requestCapture);
btnFinish.addEventListener('click', finishAndDownload);
btnClear.addEventListener('click', clearAllSteps);
btnEditTitle.addEventListener('click', startTitleEdit);
titleTextEl.addEventListener('dblclick', startTitleEdit);

// Keyboard shortcut: Cmd+Shift+S (Mac) / Ctrl+Shift+S (Win) — handled by content_script
// Fallback when the panel iframe itself has focus
document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const triggered = isMac
    ? e.metaKey && e.shiftKey && (e.key === 's' || e.key === 'S')
    : e.ctrlKey && e.shiftKey && (e.key === 's' || e.key === 'S');

  if (triggered && !capturing) {
    e.preventDefault();
    requestCapture();
    return;
  }

  const regionTriggered = isMac
    ? e.metaKey && e.shiftKey && (e.key === 'x' || e.key === 'X')
    : e.ctrlKey && e.shiftKey && (e.key === 'x' || e.key === 'X');

  if (regionTriggered) {
    e.preventDefault();
    window.parent.postMessage({ type: 'START_REGION_CAPTURE' }, '*');
  }
});

// ─── Capture ──────────────────────────────────────────────────────────────────

function requestCapture() {
  if (capturing) return;

  capturing = true;
  btnCapture.disabled = true;
  btnCapture.innerHTML = '<span class="spinner"></span> Alınıyor…';
  window.parent.postMessage({ type: 'CAPTURE_SCREENSHOT' }, '*');
}

// ─── Messages from content_script ────────────────────────────────────────────

window.addEventListener('message', (event) => {
  const { type, dataUrl, error } = event.data || {};

  if (type === 'TRIGGER_CAPTURE') {
    if (!capturing) requestCapture();
    return;
  }

  if (type === 'ADD_STEP_EXTERNAL') {
    addStep(event.data.dataUrl, { description: event.data.description || '' });
    return;
  }

  if (type === 'SCREENSHOT_DONE') {
    addStep(dataUrl);
    resetCaptureButton();
    capturing = false;
  }

  if (type === 'SCREENSHOT_ERROR') {
    resetCaptureButton();
    capturing = false;
    showToast(`Hata: ${error || 'Bilinmeyen hata'}`);
  }
});

function resetCaptureButton() {
  btnCapture.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
    Al`;
  btnCapture.disabled = false;
}

// ─── Persistence (survives URL / page changes) ────────────────────────────────

function saveState(immediate = false) {
  if (!chrome?.storage?.local) return;

  const write = () => {
    chrome.storage.local.set({
      [STATE_KEY]: {
        steps: steps.map(s => ({
          id: s.id,
          dataUrl: s.dataUrl,
          description: s.description || '',
          timestamp: s.timestamp instanceof Date
            ? s.timestamp.toISOString()
            : (s.timestamp || new Date().toISOString()),
        })),
        stepCounter,
        testTitle,
      },
    });
  };

  clearTimeout(saveTimer);
  if (immediate) write();
  else saveTimer = setTimeout(write, 250);
}

function loadState() {
  if (!chrome?.storage?.local) return;

  chrome.storage.local.get(STATE_KEY, (result) => {
    const data = result[STATE_KEY];
    if (!data || !Array.isArray(data.steps) || data.steps.length === 0) return;

    steps = data.steps.map(s => ({
      id: s.id,
      dataUrl: s.dataUrl,
      description: s.description || '',
      timestamp: s.timestamp ? new Date(s.timestamp) : new Date(),
    }));
    stepCounter = data.stepCounter || Math.max(0, ...steps.map(s => s.id));
    testTitle = data.testTitle || DEFAULT_TEST_TITLE;
    titleTextEl.textContent = testTitle;
    badge.textContent = String(steps.length);

    if (emptyState.parentNode) emptyState.remove();
    steps.forEach((step, index) => renderStepCard(step, index + 1, { silent: true }));

    setStatus(`${steps.length} adım yüklendi.`, true);
  });
}

// ─── Step management ──────────────────────────────────────────────────────────

function renderStepCard(step, displayNumber, { silent = false } = {}) {
  const card = document.createElement('div');
  card.className = 'step-card';
  card.dataset.stepId = step.id;

  card.innerHTML = `
    <div class="step-header" draggable="true">
      <span class="drag-handle" title="Sürükleyerek sırala">⠿</span>
      <span class="step-number">Adım ${displayNumber}</span>
      <button class="btn-delete" title="Bu adımı sil" data-id="${step.id}">×</button>
    </div>
    <div class="step-description">
      <textarea
        placeholder="Bu adımda ne yaptınızı yazın…"
        rows="3"
        data-id="${step.id}"
      >${escapeHtml(step.description || '')}</textarea>
    </div>
    <div class="step-img-wrap">
      <img src="${step.dataUrl}" alt="Adım ${displayNumber} ekran görüntüsü" data-src="${step.dataUrl}" />
    </div>
  `;

  card.querySelector('.btn-delete').addEventListener('click', () => deleteStep(step.id, card));

  card.querySelector('textarea').addEventListener('input', (e) => {
    const found = steps.find(s => s.id === step.id);
    if (found) {
      found.description = e.target.value;
      saveState();
    }
  });

  card.querySelector('img').addEventListener('click', (e) => openLightbox(e.target.src));

  setupCardDrag(card);
  stepsWrapper.appendChild(card);

  if (!silent) {
    const flash = document.createElement('div');
    flash.className = 'capture-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 400);
    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  return card;
}

function addStep(dataUrl, { description = '' } = {}) {
  stepCounter++;
  const id = stepCounter;
  const timestamp = new Date();
  const step = { id, dataUrl, description, timestamp };

  steps.push(step);
  badge.textContent = String(steps.length);

  if (emptyState.parentNode) emptyState.remove();

  renderStepCard(step, steps.length);

  setStatus(`${steps.length} adım kaydedildi. Son: ${formatTime(timestamp)}`, true);
  showToast(`Adım ${steps.length} eklendi`);
  saveState(true);
}

// ─── Drag & drop reorder ──────────────────────────────────────────────────────

let draggedCard = null;

stepsWrapper.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!draggedCard) return;

  const after = getDragAfterElement(e.clientY);
  if (after == null) {
    stepsWrapper.appendChild(draggedCard);
  } else if (after !== draggedCard) {
    stepsWrapper.insertBefore(draggedCard, after);
  }
});

function setupCardDrag(card) {
  const header = card.querySelector('.step-header');

  header.addEventListener('dragstart', (e) => {
    if (e.target.closest('.btn-delete')) {
      e.preventDefault();
      return;
    }
    draggedCard = card;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.stepId);
  });

  header.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    stepsWrapper.querySelectorAll('.step-card').forEach(c => c.classList.remove('drag-over'));
    if (draggedCard) {
      syncStepsFromDom();
      updateStepNumbers();
      draggedCard = null;
      saveState(true);
    }
  });
}

function getDragAfterElement(y) {
  const cards = [...stepsWrapper.querySelectorAll('.step-card:not(.is-dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function syncStepsFromDom() {
  const cards = [...stepsWrapper.querySelectorAll('.step-card')];
  steps = cards
    .map(card => steps.find(s => s.id === Number(card.dataset.stepId)))
    .filter(Boolean);
}

function updateStepNumbers() {
  stepsWrapper.querySelectorAll('.step-card').forEach((card, index) => {
    const num = index + 1;
    const label = card.querySelector('.step-number');
    if (label) label.textContent = `Adım ${num}`;
    const img = card.querySelector('img');
    if (img) img.alt = `Adım ${num} ekran görüntüsü`;
  });
}

function deleteStep(id, cardEl) {
  steps = steps.filter(s => s.id !== id);
  cardEl.remove();
  badge.textContent = String(steps.length);

  if (steps.length === 0) {
    stepsWrapper.appendChild(emptyState);
    setStatus('Tüm adımlar silindi.');
  } else {
    syncStepsFromDom();
    updateStepNumbers();
    setStatus(`${steps.length} adım kaldı.`, true);
  }
  showToast('Adım silindi');
  saveState(true);
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function openLightbox(src) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${src}" alt="Tam boyut görüntü" />`;
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

// ─── Finish & download ────────────────────────────────────────────────────────

function finishAndDownload() {
  if (steps.length === 0) {
    showToast('İndirilecek adım yok!');
    return;
  }

  const html = generateReport();
  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFileName(testTitle)}.doc`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('Rapor indirildi!');
}

function clearAllSteps() {
  if (steps.length === 0) {
    showToast('Zaten temiz!');
    return;
  }
  if (!confirm(`${steps.length} adımın tamamı silinecek. Emin misiniz?`)) return;

  steps = [];
  stepCounter = 0;
  badge.textContent = '0';

  // Remove all cards from DOM
  stepsWrapper.innerHTML = '';
  stepsWrapper.appendChild(emptyState);

  setStatus('Tüm adımlar temizlendi.');
  showToast('Tüm adımlar silindi.');
  saveState(true);
}

// ─── HTML Report generator ────────────────────────────────────────────────────

function generateReport() {
  const now = new Date();

  const stepCards = steps.map((step, index) => {
    const isLastInPair = (index + 1) % 2 === 0;
    const isLastStep = index === steps.length - 1;
    const pageBreakHtml = (isLastInPair && !isLastStep)
      ? `<br clear="all" style="mso-special-character:line-break;page-break-before:always;" />`
      : '';

    return `
    <div class="step" style="page-break-inside:avoid;">
      <div class="step-head">
        <span class="step-num">Adım ${index + 1}</span>
      </div>
      <div class="step-desc">${escapeHtml(step.description) || '<em style="color:#94a3b8">Açıklama girilmedi.</em>'}</div>
      <img src="${step.dataUrl}" alt="Adım ${index + 1}" width="520" style="display:block;width:520px;max-width:100%;height:auto;" />
    </div>
    ${pageBreakHtml}`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="tr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
  </w:WordDocument>
</xml>
<![endif]-->
<title>${escapeHtml(testTitle)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 1.5cm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f3f1; color: #2a2520; padding: 20px 16px; }
  .report-header { max-width: 600px; margin: 0 auto 20px; background: #2a2520; color: #fff; border-radius: 8px; padding: 18px 22px; page-break-after: avoid; }
  .report-header h1 { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
  .meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 11px; color: rgba(255,255,255,0.6); }
  .meta span strong { color: rgba(255,255,255,0.9); }
  .steps { max-width: 600px; margin: 0 auto; }
  .step { background: #fff; border-radius: 6px; box-shadow: 0 1px 3px rgba(101,73,54,0.08); overflow: hidden; border: 1px solid #e8e3df; margin-bottom: 14px; page-break-inside: avoid; }
  .step-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: #faf9f8; border-bottom: 1px solid #e8e3df; }
  .step-num { font-size: 12px; font-weight: 700; color: #D07E47; }
  .step img { display: block; width: 100%; max-width: 520px; height: auto; border-bottom: 1px solid #e8e3df; }
  .step-desc { padding: 8px 14px; font-size: 12px; line-height: 1.5; color: #2a2520; white-space: pre-wrap; min-height: 28px; border-bottom: 1px solid #e8e3df; }
  .footer { max-width: 600px; margin: 16px auto 0; text-align: center; font-size: 10px; color: #9a8a7d; page-break-before: avoid; }
  @media print {
    body { background: #fff; padding: 0; }
    .steps, .report-header, .footer { max-width: 100%; }
    .step { box-shadow: none; border: 1px solid #d4ccc4; margin-bottom: 12px; page-break-inside: avoid; }
    img { max-width: 100% !important; width: 100% !important; height: auto !important; }
    .report-header { background: #2a2520 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="report-header">
  <h1>${escapeHtml(testTitle)}</h1>
  <div class="meta">
    <span><strong>Tarih:</strong> ${now.toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric' })}</span>
    <span><strong>Toplam Adım:</strong> ${steps.length}</span>
  </div>
</div>

<div class="steps">
${stepCards}
</div>

<div class="footer">CosmicTestSteps tarafından oluşturuldu.</div>

</body>
</html>`;
}

// ─── Title editing ────────────────────────────────────────────────────────────

function startTitleEdit() {
  if (document.getElementById('title-edit-input')) return;

  const input = document.createElement('input');
  input.id = 'title-edit-input';
  input.className = 'title-edit-input';
  input.type = 'text';
  input.value = testTitle;
  input.maxLength = 80;
  input.setAttribute('aria-label', 'Test adı');

  titleTextEl.style.display = 'none';
  btnEditTitle.style.display = 'none';
  titleTextEl.parentNode.insertBefore(input, titleTextEl.nextSibling);
  input.focus();
  input.select();

  function saveTitle() {
    const next = input.value.trim() || DEFAULT_TEST_TITLE;
    testTitle = next;
    titleTextEl.textContent = testTitle;
    titleTextEl.style.display = '';
    btnEditTitle.style.display = '';
    input.remove();
    showToast('Test adı güncellendi');
    saveState(true);
  }

  function cancelTitle() {
    titleTextEl.style.display = '';
    btnEditTitle.style.display = '';
    input.remove();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTitle();
    }
  });

  input.addEventListener('blur', saveTitle);
}

function sanitizeFileName(name) {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'test-report';
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function setStatus(msg, active = false) {
  statusText.textContent = msg;
  statusText.className = 'header-status' + (active ? ' active' : '');
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function formatTime(date) {
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Restore steps after URL / page navigation
loadState();

