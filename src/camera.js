/**
 * Camera stream management and capture.
 * Takes DOM elements as parameters to keep DOM coupling outside this module.
 */

let _stream = null;
let _videoEl = null;

export async function startCamera(videoEl, onReady, onError) {
  _videoEl = videoEl;

  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    videoEl.srcObject = _stream;
    await videoEl.play();
    onReady?.();
  } catch (err) {
    onError?.(err);
  }
}

export function stopCamera() {
  if (_stream) {
    _stream.getTracks().forEach(track => track.stop());
    _stream = null;
  }
  if (_videoEl) {
    _videoEl.srcObject = null;
  }
}

export function captureFrame(videoEl, canvasEl) {
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  canvasEl.getContext('2d').drawImage(videoEl, 0, 0);
}

export function loadImageToCanvas(file, canvasEl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      canvasEl.width = img.naturalWidth;
      canvasEl.height = img.naturalHeight;
      canvasEl.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      resolve();
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

export function isStreamActive() {
  return _stream !== null && _stream.active;
}
