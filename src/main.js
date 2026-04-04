import { SMART_ROUTE_TIERS, isFreeModel, recognizeText, fetchCost, setImageProcessor, stripSeparator } from './api.js';
import { startCamera, stopCamera, captureFrame, loadImageToCanvas, isStreamActive } from './camera.js';
import { preprocessImage, clearCache } from './image.js';
import { loadSettings, initApiKeyListener, getApiKey } from './state.js';
import { getAllergens, saveAllergens as saveAllergensUI, initAllergens, addCustomAllergen } from './ui/allergen-ui.js';
import { findAllergensDetailed } from './allergens.js';
import { buildHighlightedHTML, buildTagsHTML } from './utils.js';
import { clearStepLog, addStepEntry, updateStepEntry } from './ui/step-log.js';

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

// ── Allergen state accessor ──
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
    onChange: () => {
      saveAllergensUI();
    },
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
    const { text, aiAllergens, generationId, model: finalModel } = await recognizeText(modelSelect.value, apiKey, {
      allergenTerms,
      onChunk: (partialText) => {
        // Strip separator during streaming for clean display
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

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    // Use AI allergen analysis when available; regex as fallback
    if (aiAllergens && aiAllergens.length > 0) {
      // Map AI-detected terms back to group labels for consistent display
      const aiGroups = [];
      for (const term of aiAllergens) {
        const lower = term.toLowerCase();
        for (const g of allergens) {
          if (!g.enabled) continue;
          if (g.terms.some(t => t.enabled && t.term === lower)) {
            if (!aiGroups.some(ag => ag.label === g.label)) {
              aiGroups.push({ label: g.label, matchedTerms: [] });
            }
            const existing = aiGroups.find(ag => ag.label === g.label);
            if (!existing.matchedTerms.includes(lower)) existing.matchedTerms.push(lower);
            break;
          }
        }
      }

      const { matches } = findAllergensDetailed(text, allergens);
      ocrTextEl.innerHTML = buildHighlightedHTML(text, matches);
      ocrTextEl.classList.add('visible');

      if (aiGroups.length > 0) {
        cameraWrap.classList.add('danger');
        statusEl.textContent = `Allergens detected (${aiGroups.length})! (${elapsed}s)`;
        resultsEl.innerHTML = `<h3>Allergens found:</h3>` + buildTagsHTML(aiGroups);
      } else {
        cameraWrap.classList.add('safe');
        statusEl.textContent = `No allergens detected. (${elapsed}s)`;
        resultsEl.innerHTML = `<h3>Result:</h3><span class="tag clear">No allergens found</span>`;
      }
      resultsEl.classList.add('visible');

      // Fetch cost
      if (generationId && !isFreeModel(finalModel)) {
        fetchCost(generationId, apiKey, (cost) => {
          const costStr = ` · $${cost < 0.001 ? cost.toFixed(6) : cost.toFixed(4)}`;
          const base = aiGroups.length > 0
            ? `Allergens detected (${aiGroups.length})! (${elapsed}s${costStr})`
            : `No allergens detected. (${elapsed}s${costStr})`;
          statusEl.textContent = base;
        });
      }
      return;
    }

    // Fallback: regex-based detection
    const { groups, matches } = findAllergensDetailed(text, allergens);
    ocrTextEl.innerHTML = buildHighlightedHTML(text, matches);
    ocrTextEl.classList.add('visible');

    if (groups.length > 0) {
      cameraWrap.classList.add('danger');
      statusEl.textContent = `Allergens detected (${groups.length})! (${elapsed}s)`;
      resultsEl.innerHTML = `<h3>Allergens found:</h3>` + buildTagsHTML(groups);
    } else {
      cameraWrap.classList.add('safe');
      statusEl.textContent = `No allergens detected. (${elapsed}s)`;
      resultsEl.innerHTML = `<h3>Result:</h3><span class="tag clear">No allergens found</span>`;
    }
    resultsEl.classList.add('visible');

    if (generationId && !isFreeModel(finalModel)) {
      fetchCost(generationId, apiKey, (cost) => {
        const costStr = ` · $${cost < 0.001 ? cost.toFixed(6) : cost.toFixed(4)}`;
        const base = groups.length > 0
          ? `Allergens detected (${groups.length})! (${elapsed}s${costStr})`
          : `No allergens detected. (${elapsed}s${costStr})`;
        statusEl.textContent = base;
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
      const { text, aiAllergens, generationId, model: actualModel } = await recognizeText(tier.model, apiKey, {
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
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

      // Use AI allergens if available, otherwise regex fallback
      let foundGroups, foundLabels, foundMatches;
      if (aiAllergens) {
        foundGroups = [];
        for (const term of aiAllergens) {
          const lower = term.toLowerCase();
          for (const g of allergens) {
            if (!g.enabled) continue;
            if (g.terms.some(t => t.enabled && t.term === lower)) {
              let existing = foundGroups.find(fg => fg.label === g.label);
              if (!existing) {
                existing = { label: g.label, matchedTerms: [] };
                foundGroups.push(existing);
              }
              if (!existing.matchedTerms.includes(lower)) existing.matchedTerms.push(lower);
              break;
            }
          }
        }
        foundLabels = foundGroups.map(g => g.label);
        foundMatches = findAllergensDetailed(text, allergens).matches;
      } else {
        const detailed = findAllergensDetailed(text, allergens);
        foundGroups = detailed.groups;
        foundLabels = foundGroups.map(g => g.label);
        foundMatches = detailed.matches;
      }

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
        allergenResult = { found: foundLabels, groups: foundGroups, text, tier: tier.label, model: actualModel || tier.model };
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

  if (allergenResult) {
    cameraWrap.classList.add('danger');
    statusEl.textContent = `Allergens found by ${allergenResult.tier} tier! (${totalElapsed}s)`;
    resultsEl.innerHTML = `<h3>Allergens found (${allergenResult.model}):</h3>` + buildTagsHTML(allergenResult.groups);
  } else {
    cameraWrap.classList.add('safe');
    statusEl.textContent = `No allergens detected across all tiers. (${totalElapsed}s)`;
    resultsEl.innerHTML = `<h3>Result:</h3><span class="tag clear">No allergens found (checked ${tiers.length} models)</span>`;
  }
  resultsEl.classList.add('visible');
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
