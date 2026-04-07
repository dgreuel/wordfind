import { SMART_ROUTE_TIERS, isFreeModel, recognizeText, fetchCost, confirmAllergens, setImageProcessor, stripSeparator } from './api.js';
import { startCamera, captureFrame, loadImageToCanvas, isStreamActive } from './camera.js';
import { preprocessImage, clearCache } from './image.js';
import { loadSettings, initApiKeyListener, getApiKey } from './state.js';
import { getAllergens, saveAllergens as saveAllergensUI, initAllergens, addCustomAllergen } from './ui/allergen-ui.js';
import { findAllergensDetailed } from './allergens.js';
import { buildHighlightedHTML, buildTagsHTML, escHtml } from './utils.js';
import { clearStepLog, addStepEntry, updateStepEntry } from './ui/step-log.js';
import { saveSession, loadSession, clearSession } from './session.js';

// ── DOM elements ──
const video = document.getElementById('video');
const canvas = document.getElementById('snapshot');
const cameraWrap = document.getElementById('cameraWrap');
const btnScan = document.getElementById('btnScan');
const btnUpload = document.getElementById('btnUpload');
const fileInput = document.getElementById('fileInput');
const btnRescan = document.getElementById('btnRescan');
const btnReset = document.getElementById('btnReset');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const ocrTextEl = document.getElementById('ocrText');
const loader = document.getElementById('loader');
const apiKeyInput = document.getElementById('apiKeyInput');
const keyStatus = document.getElementById('keyStatus');
const modelSelect = document.getElementById('modelSelect');
const allergenGrid = document.getElementById('allergenGrid');
const allergenCount = document.getElementById('allergenCount');
const newAllergenInput = document.getElementById('newAllergenInput');
const btnAddAllergen = document.getElementById('btnAddAllergen');
const btnToggleAll = document.getElementById('btnToggleAll');
const stepLog = document.getElementById('stepLog');

let stream = null;

// ── Wire image processor to api.js ──
setImageProcessor(() => preprocessImage(canvas));

// ── Allergen state accessors ──
function getAllergensList() {
  return getAllergens();
}

function getActiveTermList() {
  const groups = getAllergensList();
  const terms = [];
  for (const g of groups) {
    if (!g.enabled) continue;
    for (const t of g.terms) {
      if (t.enabled) terms.push(t.term);
    }
  }
  return [...new Set(terms)];
}

// ── Settings ──
function initSettings() {
  loadSettings({ apiKeyInput, modelSelect, keyStatus });
  initApiKeyListener({ apiKeyInput, keyStatus });
}

// ── Allergens ──
function initAllergenUI() {
  initAllergens(allergenGrid, allergenCount, btnToggleAll, {
    onChange: () => saveAllergensUI(),
  });
}

btnAddAllergen.addEventListener('click', () => {
  const name = newAllergenInput.value.trim();
  newAllergenInput.value = '';
  newAllergenInput.focus();
  addCustomAllergen(name);
});

newAllergenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const name = newAllergenInput.value.trim();
    newAllergenInput.value = '';
    addCustomAllergen(name);
  }
});

// ── Camera ──
async function initCamera() {
  await startCamera(video,
    () => {
      stream = video.srcObject;
      btnScan.disabled = false;
      statusEl.textContent = 'Camera ready. Point at an ingredient list and tap "Scan Camera", or upload an image.';
    },
    () => {
      statusEl.textContent = 'No camera available. Upload an image to scan for allergens.';
    }
  );
  stream = video.srcObject;
}

// ── Allergen resolution: AI list + regex backstop + text-only confirmation ──
//
// After AI returns its allergen list, we run regex on the extracted text. Any
// terms that regex found but AI didn't report get sent to a fast text-only
// confirmation call (no image, free model). This catches cases where the AI
// correctly extracted the text but missed a term in the structured output.
// The confirmation call also respects "free from" context, so it won't add
// false positives from things like "gluten free".
async function resolveAllergens(text, aiAllergens, allergens, apiKey, onStatus) {
  const { matches: regexMatches } = findAllergensDetailed(text, allergens);

  // If AI gave us a structured list, use it as the authoritative base
  let baseTerms = Array.isArray(aiAllergens) ? aiAllergens.map(t => t.toLowerCase()) : null;

  if (baseTerms !== null) {
    // Find what regex caught that AI didn't confirm
    const aiTermSet = new Set(baseTerms);
    const extras = [...new Set(regexMatches.map(m => m.term))].filter(t => !aiTermSet.has(t));

    if (extras.length > 0) {
      onStatus?.(`Verifying ${extras.length} potential allergen${extras.length !== 1 ? 's' : ''}…`);
      try {
        const confirmed = await confirmAllergens(text, extras, apiKey);
        baseTerms = [...baseTerms, ...confirmed.map(t => t.toLowerCase())];
      } catch (_) {}
    }
  }

  if (baseTerms !== null) {
    // Build groups from the merged term list
    const groups = [];
    for (const term of baseTerms) {
      for (const g of allergens) {
        if (!g.enabled) continue;
        if (g.terms.some(t => t.enabled && t.term === term)) {
          let existing = groups.find(fg => fg.label === g.label);
          if (!existing) { existing = { label: g.label, matchedTerms: [] }; groups.push(existing); }
          if (!existing.matchedTerms.includes(term)) existing.matchedTerms.push(term);
          break;
        }
      }
    }
    const confirmedSet = new Set(groups.flatMap(g => g.matchedTerms));
    const matches = regexMatches.filter(m => confirmedSet.has(m.term));
    return { groups, matches };
  }

  // AI gave no structured output — fall back to pure regex
  const { groups } = findAllergensDetailed(text, allergens);
  return { groups, matches: regexMatches };
}

// ── OCR ──
async function runOCR() {
  const isSmartRoute = modelSelect.value === '__smart__';
  if (isSmartRoute) return runSmartOCR();

  loader.classList.remove('hidden');
  cameraWrap.classList.remove('safe', 'danger');
  resultsEl.classList.remove('visible');
  ocrTextEl.classList.remove('visible');
  clearStepLog(stepLog);
  statusEl.textContent = 'Sending image to AI for text recognition…';
  btnScan.disabled = true;
  btnRescan.classList.add('hidden');
  clearCache();

  const t0 = performance.now();
  const apiKey = getApiKey();
  const allergens = getAllergensList();
  const allergenTerms = getActiveTermList();

  try {
    const { text, aiAllergens, aiSummary, generationId, model: finalModel } = await recognizeText(modelSelect.value, apiKey, {
      allergenTerms,
      onChunk: (partialText) => {
        // Stream preview: show regex highlights as the text comes in
        const displayText = stripSeparator(partialText);
        const { groups, matches } = findAllergensDetailed(displayText, allergens);
        ocrTextEl.innerHTML = buildHighlightedHTML(displayText, matches);
        ocrTextEl.classList.add('visible');
        if (groups.length > 0) {
          cameraWrap.classList.remove('safe');
          cameraWrap.classList.add('danger');
          const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
          statusEl.textContent = `Allergens detected! (${elapsed}s…)`;
          resultsEl.innerHTML = `<h3>Allergens found:</h3>` + buildTagsHTML(groups);
          resultsEl.classList.add('visible');
        }
      },
    });

    loader.classList.add('hidden');
    btnScan.disabled = !isStreamActive();
    btnRescan.classList.remove('hidden');

    // Resolve final allergen list: AI + regex backstop + confirmation
    const { groups: finalGroups, matches: finalMatches } = await resolveAllergens(
      text, aiAllergens, allergens, apiKey, (msg) => { statusEl.textContent = msg; }
    );

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    ocrTextEl.innerHTML = buildHighlightedHTML(text, finalMatches);
    ocrTextEl.classList.add('visible');

    // Clear streaming early-detection; show authoritative result
    cameraWrap.classList.remove('safe', 'danger');
    resultsEl.classList.remove('visible');

    if (finalGroups.length > 0) {
      cameraWrap.classList.add('danger');
      statusEl.textContent = `Allergens detected (${finalGroups.length})! (${elapsed}s)`;
      resultsEl.innerHTML = `<h3>Allergens found:</h3>` + buildTagsHTML(finalGroups);
    } else {
      cameraWrap.classList.add('safe');
      statusEl.textContent = `No allergens detected. (${elapsed}s)`;
      resultsEl.innerHTML = `<h3>Result:</h3><span class="tag clear">No allergens found</span>`;
    }

    if (aiSummary) {
      resultsEl.innerHTML += `<p class="ai-summary">${escHtml(aiSummary)}</p>`;
    }

    resultsEl.classList.add('visible');

    saveSession({
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.7),
      ocrText: text,
      groups: finalGroups,
      aiSummary,
      model: finalModel,
      hasAllergens: finalGroups.length > 0,
    });

    if (generationId && !isFreeModel(finalModel)) {
      fetchCost(generationId, apiKey, (cost) => {
        const costStr = ` · $${cost < 0.001 ? cost.toFixed(6) : cost.toFixed(4)}`;
        statusEl.textContent = finalGroups.length > 0
          ? `Allergens detected (${finalGroups.length})! (${elapsed}s${costStr})`
          : `No allergens detected. (${elapsed}s${costStr})`;
      });
    }
  } catch (err) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    statusEl.textContent = `Error: ${err.message} (${elapsed}s)`;
    loader.classList.add('hidden');
    btnScan.disabled = !isStreamActive();
    btnRescan.classList.remove('hidden');
  }
}

// ── Smart routing OCR ──
async function runSmartOCR() {
  loader.classList.remove('hidden');
  cameraWrap.classList.remove('safe', 'danger');
  resultsEl.classList.remove('visible');
  ocrTextEl.classList.remove('visible');
  clearStepLog(stepLog);
  statusEl.textContent = 'Smart scan: escalating through model tiers…';
  btnScan.disabled = true;
  btnRescan.classList.add('hidden');
  clearCache();

  const tiers = SMART_ROUTE_TIERS;
  let allergenResult = null;
  const t0Global = performance.now();
  const apiKey = getApiKey();
  const allergens = getAllergensList();
  const allergenTerms = getActiveTermList();

  for (const tier of tiers) {
    const entry = addStepEntry(stepLog, tier.model, tier.label);
    const t0 = performance.now();
    try {
      statusEl.textContent = `Smart scan: trying ${tier.label} tier (${tier.model})…`;
      const { text, aiAllergens, aiSummary, generationId, model: actualModel } = await recognizeText(tier.model, apiKey, {
        allergenTerms,
        onChunk: (partialText) => {
          const displayText = stripSeparator(partialText);
          const { groups, matches } = findAllergensDetailed(displayText, allergens);
          if (groups.length > 0) {
            cameraWrap.classList.remove('safe');
            cameraWrap.classList.add('danger');
            const partialElapsed = ((performance.now() - t0) / 1000).toFixed(1);
            statusEl.textContent = `Allergens found via stream! (${partialElapsed}s…)`;
            resultsEl.innerHTML = `<h3>Allergens found:</h3>` + buildTagsHTML(groups);
            resultsEl.classList.add('visible');
          }
        },
      });

      const { groups: foundGroups, matches: foundMatches } = await resolveAllergens(
        text, aiAllergens, allergens, apiKey, (msg) => { statusEl.textContent = msg; }
      );
      const foundLabels = foundGroups.map(g => g.label);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

      updateStepEntry(entry, { elapsed, cost: null, found: foundLabels, text, matches: foundMatches, actualModel, buildHighlightedHTML });

      if (generationId && !isFreeModel(actualModel)) {
        fetchCost(generationId, apiKey, (cost) => {
          const meta = entry.querySelector('.step-meta');
          if (meta) {
            const costStr = `$${cost < 0.001 ? cost.toFixed(6) : cost.toFixed(4)}`;
            meta.innerHTML = `<span>${elapsed}s</span><span>${costStr}</span>`;
          }
        });
      }

      if (foundGroups.length > 0) {
        allergenResult = { found: foundLabels, groups: foundGroups, text, tier: tier.label, model: actualModel || tier.model, aiSummary };
        break;
      }
    } catch (err) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      updateStepEntry(entry, { elapsed, cost: null, found: [], text: '', error: err.message, buildHighlightedHTML });
    }
  }

  loader.classList.add('hidden');
  btnScan.disabled = !isStreamActive();
  btnRescan.classList.remove('hidden');

  const totalElapsed = ((performance.now() - t0Global) / 1000).toFixed(1);

  // Clear any streaming early-detection
  cameraWrap.classList.remove('safe', 'danger');

  if (allergenResult) {
    cameraWrap.classList.add('danger');
    statusEl.textContent = `Allergens found by ${allergenResult.tier} tier! (${totalElapsed}s)`;
    resultsEl.innerHTML = `<h3>Allergens found (${allergenResult.model}):</h3>` + buildTagsHTML(allergenResult.groups);
    if (allergenResult.aiSummary) {
      resultsEl.innerHTML += `<p class="ai-summary">${escHtml(allergenResult.aiSummary)}</p>`;
    }
    saveSession({
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.7),
      ocrText: allergenResult.text,
      groups: allergenResult.groups,
      aiSummary: allergenResult.aiSummary,
      model: allergenResult.model,
      hasAllergens: true,
    });
  } else {
    cameraWrap.classList.add('safe');
    statusEl.textContent = `No allergens detected across all tiers. (${totalElapsed}s)`;
    resultsEl.innerHTML = `<h3>Result:</h3><span class="tag clear">No allergens found (checked ${tiers.length} models)</span>`;
    saveSession({
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.7),
      ocrText: '',
      groups: [],
      aiSummary: null,
      model: 'smart',
      hasAllergens: false,
    });
  }
  resultsEl.classList.add('visible');
}

// ── Session restore ──
function restoreSession() {
  const session = loadSession();
  if (!session) return;

  if (session.imageDataUrl) {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      cameraWrap.classList.add('frozen');
    };
    img.src = session.imageDataUrl;
  }

  const groups = session.groups || [];
  cameraWrap.classList.remove('safe', 'danger');

  if (groups.length > 0) {
    cameraWrap.classList.add('danger');
    statusEl.textContent = `Restored: ${groups.length} allergen group(s) found. Tap Rescan to re-analyze.`;
    resultsEl.innerHTML = `<h3>Allergens found:</h3>` + buildTagsHTML(groups);
  } else {
    cameraWrap.classList.add('safe');
    statusEl.textContent = 'Restored: No allergens detected. Tap Rescan to re-analyze.';
    resultsEl.innerHTML = `<h3>Result:</h3><span class="tag clear">No allergens found</span>`;
  }

  if (session.aiSummary) {
    resultsEl.innerHTML += `<p class="ai-summary">${escHtml(session.aiSummary)}</p>`;
  }

  resultsEl.classList.add('visible');

  if (session.ocrText) {
    const allergens = getAllergensList();
    const { matches } = findAllergensDetailed(session.ocrText, allergens);
    const confirmedSet = new Set(groups.flatMap(g => g.matchedTerms || []));
    const filteredMatches = matches.filter(m => confirmedSet.has(m.term));
    ocrTextEl.innerHTML = buildHighlightedHTML(session.ocrText, filteredMatches);
    ocrTextEl.classList.add('visible');
  }

  btnRescan.classList.remove('hidden');
}

// ── Scan actions ──
async function scanCamera() {
  captureFrame(video, canvas);
  cameraWrap.classList.add('frozen');
  await runOCR();
}

async function scanUpload(file) {
  try {
    await loadImageToCanvas(file, canvas);
    cameraWrap.classList.add('frozen');
    await runOCR();
  } catch (err) {
    statusEl.textContent = `Upload error: ${err.message}`;
  }
}

function reset() {
  clearSession();
  cameraWrap.classList.remove('frozen', 'safe', 'danger');
  resultsEl.classList.remove('visible');
  ocrTextEl.classList.remove('visible');
  clearStepLog(stepLog);
  btnRescan.classList.add('hidden');
  clearCache();
  fileInput.value = '';
  statusEl.textContent = isStreamActive()
    ? 'Camera ready. Point at an ingredient list and tap "Scan Camera", or upload an image.'
    : 'Upload an image to scan for allergens.';
}

// ── Events ──
btnScan.addEventListener('click', scanCamera);
btnUpload.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) scanUpload(fileInput.files[0]);
});
btnRescan.addEventListener('click', runOCR);
btnReset.addEventListener('click', reset);

cameraWrap.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (e.dataTransfer.types.includes('Files')) cameraWrap.classList.add('drag-over');
});
cameraWrap.addEventListener('dragover', (e) => {
  e.preventDefault();
});
cameraWrap.addEventListener('dragleave', (e) => {
  if (!cameraWrap.contains(e.relatedTarget)) cameraWrap.classList.remove('drag-over');
});
cameraWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  cameraWrap.classList.remove('drag-over');
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) scanUpload(file);
});

// ── Init ──
initSettings();
initAllergenUI();
initCamera();
restoreSession();
