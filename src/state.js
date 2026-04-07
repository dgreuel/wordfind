const STORAGE_KEY = 'openrouter_api_key';
const MODEL_STORAGE_KEY = 'openrouter_model';
const MODELS_CACHE_KEY = 'openrouter_models_cache';

export const STORAGE_KEYS = { STORAGE_KEY, MODEL_STORAGE_KEY, MODELS_CACHE_KEY };

export function initModelSelectListener(modelSelect) {
  modelSelect.addEventListener('change', () => {
    localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value);
  });
}

export function loadSettings({ apiKeyInput, modelSelect, keyStatus }) {
  apiKeyInput.value = localStorage.getItem(STORAGE_KEY) || '';
  updateKeyStatus(keyStatus, apiKeyInput.value.trim());
  initModelSelectListener(modelSelect);
  fetchModels(apiKeyInput, modelSelect);
}

const RECOMMENDED_MODELS = new Set([
  'google/gemma-3-4b-it:free',
  'qwen/qwen3.6-plus:free',
  'google/gemma-3-12b-it:free',
  'google/gemma-3-12b-it',
  'google/gemini-2.5-flash-lite',
  'google/gemma-3-27b-it',
  'qwen/qwen-vl-max',
  'openai/gpt-5.4-mini',
  'mistralai/mistral-large-3',
]);

export function renderModelSelect(modelSelect, groups) {
  const saved = localStorage.getItem(MODEL_STORAGE_KEY);
  modelSelect.innerHTML = '';

  const smartOpt = document.createElement('option');
  smartOpt.value = '__smart__';
  smartOpt.textContent = 'Smart routing (free → cheap → mid)';
  modelSelect.appendChild(smartOpt);

  const addGroup = (label, items) => {
    if (!items || items.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = label;
    const sorted = [...items].sort((a, b) => {
      const aRec = RECOMMENDED_MODELS.has(a.id) ? 0 : 1;
      const bRec = RECOMMENDED_MODELS.has(b.id) ? 0 : 1;
      return aRec - bRec;
    });
    for (const item of sorted) {
      const opt = document.createElement('option');
      opt.value = item.id;
      const price = item.pricePerM === 0
        ? 'free'
        : `$${item.pricePerM < 0.01 ? item.pricePerM.toFixed(4) : item.pricePerM.toFixed(2)}/M`;
      const star = RECOMMENDED_MODELS.has(item.id) ? '★ ' : '';
      opt.textContent = `${star}${item.name} (${price})`;
      group.appendChild(opt);
    }
    modelSelect.appendChild(group);
  };

  addGroup('Free', groups.free);
  addGroup('Low cost (<$1/M input)', groups.low);
  addGroup('Mid range ($1–5/M input)', groups.mid);

  if (saved && [...modelSelect.options].some(o => o.value === saved)) {
    modelSelect.value = saved;
  }
}

export async function fetchModels(apiKeyInput, modelSelect) {
  const cached = localStorage.getItem(MODELS_CACHE_KEY);
  if (cached) {
    try { renderModelSelect(modelSelect, JSON.parse(cached)); } catch {}
  }

  const apiKey = apiKeyInput.value.trim();
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models?output_modalities=text', { headers });
    if (!res.ok) throw new Error(`${res.status}`);
    const { data } = await res.json();

    data.sort((a, b) => {
      const pa = parseFloat(a.pricing?.prompt || '999');
      const pb = parseFloat(b.pricing?.prompt || '999');
      return pa - pb;
    });

    const groups = { free: [], low: [], mid: [], high: [] };

    for (const m of data) {
      const pricePerM = parseFloat(m.pricing?.prompt || '0') * 1_000_000;
      const entry = { id: m.id, name: m.name || m.id, pricePerM };
      if (pricePerM === 0) groups.free.push(entry);
      else if (pricePerM < 1) groups.low.push(entry);
      else if (pricePerM <= 5) groups.mid.push(entry);
      else groups.high.push(entry);
    }

    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(groups));
    renderModelSelect(modelSelect, groups);

  } catch (err) {
    if (!cached) {
      const fallbackGroups = {
        free: [
          { id: 'google/gemma-3-4b-it:free',              name: '★ Gemma 3 4B',       pricePerM: 0 },
          { id: 'qwen/qwen3.6-plus:free',                 name: '★ Qwen 3.6 Plus',    pricePerM: 0 },
          { id: 'google/gemma-3-12b-it:free',              name: '★ Gemma 3 12B',      pricePerM: 0 },
          { id: 'qwen/qwen2.5-vl-32b-instruct:free',      name: 'Qwen 2.5 VL 32B',   pricePerM: 0 },
          { id: 'meta-llama/llama-4-scout:free',           name: 'Llama 4 Scout',      pricePerM: 0 },
        ],
        low: [
          { id: 'google/gemma-3-12b-it',              name: '★ Gemma 3 12B',            pricePerM: 0.025 },
          { id: 'google/gemini-2.5-flash-lite',        name: '★ Gemini 2.5 Flash Lite', pricePerM: 0.029 },
          { id: 'google/gemma-3-27b-it',               name: '★ Gemma 3 27B',            pricePerM: 0.049 },
          { id: 'qwen/qwen3-vl-8b-instruct',          name: 'Qwen 3 VL 8B',            pricePerM: 0.08 },
          { id: 'google/gemini-2.5-flash-image',       name: 'Gemini 2.5 Flash Image',  pricePerM: 0.10 },
        ],
        mid: [
          { id: 'qwen/qwen-vl-max',                        name: '★ Qwen VL Max',     pricePerM: 2.00 },
          { id: 'openai/gpt-5.4-mini',                     name: '★ GPT-5.4 Mini',    pricePerM: 3.00 },
          { id: 'mistralai/mistral-large-3',                name: '★ Mistral Large 3', pricePerM: 2.00 },
          { id: 'qwen/qwen2.5-vl-72b-instruct',            name: 'Qwen 2.5 VL 72B',  pricePerM: 0.40 },
          { id: 'google/gemini-2.5-pro-preview-03-25',      name: 'Gemini 2.5 Pro',    pricePerM: 1.25 },
        ],
        high: [],
      };
      renderModelSelect(modelSelect, fallbackGroups);
    }
  }
}

export function updateKeyStatus(keyStatus, key) {
  if (key) {
    keyStatus.textContent = 'API key saved.';
    keyStatus.classList.add('ok');
  } else {
    keyStatus.textContent = 'No API key saved. Enter your OpenRouter key above.';
    keyStatus.classList.remove('ok');
  }
}

export function initApiKeyListener({ apiKeyInput, keyStatus }) {
  apiKeyInput.addEventListener('input', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem(STORAGE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    updateKeyStatus(keyStatus, key);
  });
}

export function getApiKey() {
  return document.getElementById('apiKeyInput')?.value.trim() || '';
}
