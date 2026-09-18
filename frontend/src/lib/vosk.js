// Offline speech-to-text for the mobile scan flow.
// Kept separate from ImmersiveScan's in-XR copy, which is closure-bound to Three.js meshes.

const MODEL_URL = '/assets/vosk-model-small-en-us-0.15.tar.gz';
const MODEL_TIMEOUT_MS = 30000;

let modelPromise = null;

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { createModel } = await import('vosk-browser');
      return Promise.race([
        createModel(MODEL_URL),
        new Promise((_, reject) => setTimeout(() => reject(new Error('vosk model load timed out')), MODEL_TIMEOUT_MS)),
      ]);
    })().catch(err => { modelPromise = null; throw err; });
  }
  return modelPromise;
}

export function createVoskRecorder() {
  let audioCtx = null;
  let recognizer = null;
  let source = null;
  let processor = null;
  let sink = null;
  let mediaRecorder = null;
  let chunks = [];
  let token = 0;
  let finalText = '';
  let active = false;

  // iOS only allows an AudioContext to leave "suspended" if it is created and
  // resumed inside the gesture, so this must be called synchronously on touch.
  function prime() {
    if (!audioCtx || audioCtx.state === 'closed') {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor();
    }
    audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  async function start({ stream, onStatus, onText }) {
    const myToken = ++token;
    finalText = '';
    active = true;

    const audioTracks = stream?.getAudioTracks?.() ?? [];
    if (!audioTracks.length) { onStatus?.('No microphone available.'); active = false; return false; }
    audioTracks.forEach(t => { t.enabled = true; });

    onStatus?.('Loading…');
    let model;
    try {
      model = await loadModel();
    } catch (e) {
      if (myToken !== token) return false;
      onStatus?.(`Speech model unavailable (${e.message}).`);
      active = false;
      return false;
    }
    if (myToken !== token) return false;

    prime();
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch { /* ignore */ } }
    if (myToken !== token) return false;

    chunks = [];
    try {
      mediaRecorder = new MediaRecorder(new MediaStream(audioTracks));
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.start();
    } catch {
      mediaRecorder = null;
    }

    recognizer = new model.KaldiRecognizer(audioCtx.sampleRate);
    recognizer.on('result', msg => {
      if (myToken !== token) return;
      const text = msg.result?.text?.trim();
      if (!text) return;
      finalText = finalText ? `${finalText} ${text}` : text;
      onText?.(finalText);
    });
    recognizer.on('partialresult', msg => {
      if (myToken !== token) return;
      const partial = msg.result?.partial?.trim();
      if (!partial) return;
      onText?.(finalText ? `${finalText} ${partial}` : partial);
    });

    source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = e => { recognizer?.acceptWaveform(e.inputBuffer); };
    // Silent sink: the processor needs a downstream connection to keep running,
    // but routing mic audio to the speaker would echo on a phone.
    sink = audioCtx.createGain();
    sink.gain.value = 0;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(audioCtx.destination);

    onStatus?.('Listening…');
    return true;
  }

  function teardownNodes() {
    try { processor?.disconnect(); } catch { /* ignore */ }
    try { source?.disconnect(); } catch { /* ignore */ }
    try { sink?.disconnect(); } catch { /* ignore */ }
    if (processor) processor.onaudioprocess = null;
    processor = null; source = null; sink = null;
  }

  // Resolves once the recorded audio blob is ready.
  function stop({ stream } = {}) {
    token++;
    active = false;
    if (recognizer) {
      try { recognizer.free(); } catch { /* ignore */ }
      recognizer = null;
    }
    teardownNodes();
    stream?.getAudioTracks?.().forEach(t => { t.enabled = false; });

    const text = finalText.trim();
    return new Promise(resolve => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const mr = mediaRecorder;
        mr.onstop = () => {
          // iOS Safari records mp4, not webm — trusting a hardcoded type breaks playback.
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          mediaRecorder = null;
          resolve({ text, audioUrl: URL.createObjectURL(blob) });
        };
        mr.stop();
      } else {
        mediaRecorder = null;
        resolve({ text, audioUrl: null });
      }
    });
  }

  function dispose() {
    token++;
    active = false;
    try { recognizer?.free(); } catch { /* ignore */ }
    recognizer = null;
    teardownNodes();
    try { mediaRecorder?.stop(); } catch { /* ignore */ }
    mediaRecorder = null;
    try { audioCtx?.close(); } catch { /* ignore */ }
    audioCtx = null;
  }

  return { prime, start, stop, dispose, isActive: () => active };
}
