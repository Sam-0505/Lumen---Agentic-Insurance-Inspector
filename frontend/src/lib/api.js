const BASE = import.meta.env.VITE_API_URL ?? '/api';

// The backend puts the real reason (bad model, upstream 4xx, parse failure) in
// { error }. Without unwrapping it every failure looked like a bare
// 'checkCoverage failed', which is what hid a dead model behind sample data.
async function post(path, body, label) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch { /* non-JSON body */ }
    throw new Error(detail ? `${label}: ${detail}` : `${label} failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function ocrDocument(imageBase64, document_type = 'auto') {
  return post('/ocr-document', { imageBase64, document_type }, 'Document scan');
}

export async function analyzeDamage(imageBase64) {
  return post('/analyze-damage', { imageBase64 }, 'Damage analysis');
}

export async function checkCoverage(damageJson) {
  return post('/check-coverage', { damageJson }, 'Coverage check');
}

export async function uploadFrames(frames) {
  return post('/upload-frames', { frames }, 'Frame upload'); // { jobId }
}

export async function pollJobStatus(jobId) {
  const res = await fetch(`${BASE}/job-status/${jobId}`);
  if (!res.ok) throw new Error('pollJobStatus failed');
  return res.json(); // { status, progress, splatUrl }
}

// Combined: saves frame to backend/debug-images in background, returns AI damage analysis
export async function scanFrame({ frameBase64, angle, bucketIndex, scanId }) {
  return post('/scan-frame', { frameBase64, angle, bucketIndex, scanId }, 'Frame scan');
}

export function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
