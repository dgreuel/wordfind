const SESSION_KEY = 'allergen_session_v1';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function saveSession({ imageDataUrl, ocrText, groups, aiSummary, model, hasAllergens }) {
  const data = { imageDataUrl, ocrText, groups, aiSummary, model, hasAllergens, ts: Date.now() };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // localStorage quota exceeded — retry without the image
    try {
      const { imageDataUrl: _, ...rest } = data;
      localStorage.setItem(SESSION_KEY, JSON.stringify(rest));
    } catch {}
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return data;
  } catch { return null; }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
