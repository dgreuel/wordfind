export const SMART_ROUTE_TIERS = [
  { label: 'Free',      model: 'openrouter/free' },
  { label: 'Low cost',  model: 'qwen/qwen3-vl-8b-instruct' },
  { label: 'Mid range', model: 'qwen/qwen2.5-vl-72b-instruct' },
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

export async function recognizeText(modelId, apiKey, { onChunk } = {}) {
  if (!apiKey) throw new Error('No API key. Open "API settings" below and paste your OpenRouter key.');

  const base64 = _getImageBase64 ? _getImageBase64() : null;
  if (!base64) throw new Error('Image not ready.');

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
            {
              type: 'text',
              text: 'Extract ALL text from this image exactly as written. This is a food ingredient label. Output ONLY the raw text, nothing else — no commentary, no formatting, no markdown. Preserve line breaks where they appear.',
            },
            { type: 'image_url', image_url: { url: base64 } },
          ],
        }],
        max_tokens: 1024,
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

    return { text, generationId, model: finalModel };
  }

  throw new Error('Max retries exceeded');
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
