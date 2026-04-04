/**
 * Image preprocessing: resize, grayscale, base64 encoding.
 * Takes canvas element as parameter to keep DOM coupling outside this module.
 */

const MAX_DIM = 1024;
const JPEG_QUALITY = 0.75;

let _cachedBase64 = null;

export function clearCache() {
  _cachedBase64 = null;
}

export function preprocessImage(canvasEl) {
  if (_cachedBase64) return _cachedBase64;

  const src = { w: canvasEl.width, h: canvasEl.height };

  const scale = Math.min(1, MAX_DIM / Math.max(src.w, src.h));
  const w = Math.round(src.w * scale);
  const h = Math.round(src.h * scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const octx = offscreen.getContext('2d');

  octx.drawImage(canvasEl, 0, 0, w, h);

  const id = octx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = lum;
  }
  octx.putImageData(id, 0, 0);

  _cachedBase64 = offscreen.toDataURL('image/jpeg', JPEG_QUALITY);
  return _cachedBase64;
}

export function resizeCanvas(sourceCanvas, targetCanvas, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(sourceCanvas.width, sourceCanvas.height));
  targetCanvas.width = Math.round(sourceCanvas.width * scale);
  targetCanvas.height = Math.round(sourceCanvas.height * scale);
  targetCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
}

export function toGrayscale(canvasEl) {
  const offscreen = document.createElement('canvas');
  offscreen.width = canvasEl.width;
  offscreen.height = canvasEl.height;
  const octx = offscreen.getContext('2d');

  octx.drawImage(canvasEl, 0, 0);

  const id = octx.getImageData(0, 0, offscreen.width, offscreen.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = lum;
  }
  octx.putImageData(id, 0, 0);
  return offscreen;
}

export function toBase64(canvasEl, format, quality) {
  return canvasEl.toDataURL(format || 'image/jpeg', quality || JPEG_QUALITY);
}
