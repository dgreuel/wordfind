export const SMART_ROUTE_TIERS = [
  { label: 'Free',      model: 'google/gemma-3-4b-it:free' },
  { label: 'Low cost',  model: 'google/gemma-3-12b-it' },
  { label: 'Mid range', model: 'qwen/qwen-vl-max' },
];

export function isFreeModel(modelId) {
  return modelId === 'openrouter/free' || modelId.endsWith(':free');
}

let _getImageBase64 = null;
export function setImageProcessor(fn) {
  _getImageBase64 = fn;
}

export async function fetchModels(apiKey) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const res = await fetch('https://openrouter.ai/api/v1/models?output_modalities=text', { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  const { data } = await res.json();
  return data;
}

export function groupModelsByPrice(models) {
  const sorted = [...models].sort((a, b) => {
    const pa = parseFloat(a.pricing?.prompt || '999');
    const pb = parseFloat(b.pricing?.prompt || '999');
    return pa - pb;
  });

  const groups = { free: [], low: [], mid: [], high: [] };
  for (const m of sorted) {
    const pricePerM = parseFloat(m.pricing?.prompt || '0') * 1_000_000;
    const entry = { id: m.id, name: m.name || m.id, pricePerM };
    if (pricePerM === 0)      groups.free.push(entry);
    else if (pricePerM < 1)  groups.low.push(entry);
    else if (pricePerM <= 5) groups.mid.push(entry);
    else                      groups.high.push(entry);
  }
  return groups;
}

const SEPARATOR = '---ALLERGENS---';
const SUMMARY_SEPARATOR = '---SUMMARY---';

function buildPrompt(allergenTerms) {
  const list = allergenTerms.join(', ');
  return `You are an allergen detection assistant analyzing a food ingredient label image.

STEP 1: Extract ALL text from the image exactly as written. Preserve line breaks.

STEP 2: Analyze the extracted text for these allergens: ${list}

IMPORTANT context rules:
- "gluten free", "nut free", "dairy free", etc. mean the allergen is ABSENT — do NOT flag it
- "may contain traces of X" SHOULD be flagged — it indicates possible presence
- "almond milk" or "coconut milk" should flag the plant (almond/coconut) but NOT dairy milk
- "soy lecithin" should flag soy
- Consider ingredient aliases (e.g. "casein" = milk protein, "semolina" = wheat)

OUTPUT FORMAT — you MUST use this exact format with the separators:
<raw text from the image>
${SEPARATOR}
["allergen1", "allergen2"]
${SUMMARY_SEPARATOR}
<1-2 sentence summary explaining which allergens were found and why, or why none were found. Note any "free from" claims or "may contain" warnings.>

If no allergens are found, output an empty array: []
The array must only contain allergens from the provided list. Use lowercase.`;
}

export function parseStructuredResponse(fullText) {
  const sepIdx = fullText.indexOf(SEPARATOR);
  if (sepIdx === -1) return { rawText: fullText, aiAllergens: null, aiSummary: null };

  const rawText = fullText.slice(0, sepIdx).trim();
  let remainder = fullText.slice(sepIdx + SEPARATOR.length).trim();

  // Split off summary if present
  let aiSummary = null;
  const sumIdx = remainder.indexOf(SUMMARY_SEPARATOR);
  if (sumIdx !== -1) {
    aiSummary = remainder.slice(sumIdx + SUMMARY_SEPARATOR.length).trim();
    remainder = remainder.slice(0, sumIdx).trim();
  }

  let aiAllergens = null;
  try {
    aiAllergens = JSON.parse(remainder);
    if (!Array.isArray(aiAllergens)) aiAllergens = null;
  } catch (_) {
    const match = remainder.match(/\[.*?\]/s);
    if (match) {
      try { aiAllergens = JSON.parse(match[0]); } catch (_2) {}
    }
  }
  return { rawText, aiAllergens, aiSummary };
}

export function stripSeparator(partialText) {
  const sepIdx = partialText.indexOf(SEPARATOR);
  return sepIdx !== -1 ? partialText.slice(0, sepIdx).trim() : partialText;
}

export { SUMMARY_SEPARATOR };

export async function recognizeText(modelId, apiKey, { onChunk, allergenTerms = [] } = {}) {
  if (!apiKey) throw new Error('No API key. Open "API settings" below and paste your OpenRouter key.');

  const base64 = _getImageBase64 ? _getImageBase64() : null;
  if (!base64) throw new Error('Image not ready.');

  const prompt = allergenTerms.length > 0
    ? buildPrompt(allergenTerms)
    : 'Extract ALL text from this image exactly as written. This is a food ingredient label. Output ONLY the raw text, nothing else — no commentary, no formatting, no markdown. Preserve line breaks where they appear.';

  const maxAttempts = isFreeModel(modelId) ? 2 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 5000));

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: base64 } },
          ],
        }],
        max_tokens: 1500,
        temperature: 0,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429 && attempt < maxAttempts - 1) continue;
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let generationId = null;
    let finalModel = modelId;
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (!generationId && data.id) generationId = data.id;
            if (data.model) finalModel = data.model;
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              text += delta;
              if (onChunk) onChunk(text);
            }
          } catch (_) {}
        }
      }
    }

    const { rawText, aiAllergens, aiSummary } = allergenTerms.length > 0
      ? parseStructuredResponse(text)
      : { rawText: text, aiAllergens: null, aiSummary: null };

    return { text: rawText, aiAllergens, aiSummary, generationId, model: finalModel };
  }

  throw new Error('Max retries exceeded');
}

/**
 * Text-only confirmation call: given terms regex found that AI didn't list,
 * ask a free model to confirm which are actual allergens vs "free from" mentions.
 * No image needed — this is fast and cheap.
 */
export async function confirmAllergens(text, candidateTerms, apiKey) {
  if (!apiKey || !candidateTerms.length) return [];
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{
        role: 'user',
        content: `Food ingredient label text:
---
${text}
---
Text matching found these allergen terms: ${candidateTerms.join(', ')}

For each term, is it an ACTUAL allergen present in this product?
Rules:
- "X free", "free from X", "no X", "X-free" → NOT present (exclude)
- "may contain X", "traces of X", listed in ingredients → present (include)

Reply ONLY with a JSON array of confirmed allergen terms, lowercase.
Example: ["egg", "milk"] — or [] if none confirmed.`,
      }],
      max_tokens: 150,
      temperature: 0,
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  try {
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      return Array.isArray(arr) ? arr.map(t => String(t).toLowerCase()) : [];
    }
  } catch {}
  return [];
}

export async function fetchCost(generationId, apiKey, onCost) {
  const delays = [2000, 4000, 6000, 8000, 10000, 15000, 20000, 30000];
  for (let i = 0; i < delays.length; i++) {
    await new Promise(r => setTimeout(r, delays[i]));
    try {
      const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const cost = data?.data?.total_cost ?? null;
        if (cost !== null && cost > 0) { onCost(cost); return; }
      }
    } catch (_) {}
  }
}
