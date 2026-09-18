import { useState, useRef, useEffect, useCallback } from 'react';
import { scanFrame } from '../lib/api';
import { mergeDamageAnalyses } from '../lib/damageMerge';
import { headingFromEvent, createHeadingSmoother, angleDelta } from '../lib/heading';
import { createVoskRecorder } from '../lib/vosk';
import SpatialNotePin from './SpatialNotePin';

// Same bucket system as ImmersiveScan. Indices are NOT comparable to the XR
// flow's: those are measured off world +X, these off the calibrated car front.
const BUCKETS = 12;
const BUCKET_DEG = 360 / BUCKETS;

const DWELL_MS = 700;
const MIN_TRAVEL_DEG = 20;
const HYSTERESIS_DEG = 7;
const MAX_IN_FLIGHT = 2;
const COMPASS_TIMEOUT_MS = 3000;
const MAX_FRAME_WIDTH = 1280;

const DIRS = ['Front', 'Front-R', 'Right', 'Rear-R', 'Rear', 'Rear-L', 'Left', 'Front-L'];
const dirLabel = deg => DIRS[Math.round(deg / 45) % 8];

const PANEL = {
  background: 'rgba(28,28,32,0.82)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 16,
};

function arcPath(cx, cy, r, startDeg, endDeg) {
  const pt = deg => {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [x1, y1] = pt(startDeg);
  const [x2, y2] = pt(endDeg);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${endDeg - startDeg > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

function ProgressRing({ filled, current, size = 132 }) {
  const c = size / 2;
  const r = c - 12;
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      {Array.from({ length: BUCKETS }, (_, i) => {
        const isCurrent = i === current;
        const color = filled[i] ? '#22c55e' : isCurrent ? '#1a3cef' : 'rgba(255,255,255,0.18)';
        return (
          <path
            key={i}
            d={arcPath(c, c, r, i * BUCKET_DEG + 3, (i + 1) * BUCKET_DEG - 3)}
            stroke={color}
            strokeWidth={isCurrent ? 9 : 7}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
      <text x={c} y={c - 2} textAnchor="middle" fill="white" fontSize="26" fontWeight="700">
        {filled.filter(Boolean).length}
      </text>
      <text x={c} y={c + 16} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="12">
        of {BUCKETS}
      </text>
    </svg>
  );
}

export default function MobileScan({ onCapture, onExit }) {
  const [phase, setPhase] = useState('starting'); // starting | calibrate | scanning
  const [error, setError] = useState('');
  const [mode, setMode] = useState('manual'); // compass | manual
  const [filled, setFilled] = useState(() => new Array(BUCKETS).fill(false));
  const [currentBucket, setCurrentBucket] = useState(0);
  const [azimuth, setAzimuth] = useState(0);
  const [notes, setNotes] = useState([]);
  const [aiAreas, setAiAreas] = useState([]);
  const [recording, setRecording] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [micStatus, setMicStatus] = useState('');
  const [paused, setPaused] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const diffCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const activeNoteRef = useRef(null);
  const geoRef = useRef(null);

  const bucketsRef = useRef(new Array(BUCKETS).fill(null));
  const analysesRef = useRef([]);
  const inFlightRef = useRef(0);
  const scanIdRef = useRef(null); // assigned on mount — impure during render

  const smootherRef = useRef(createHeadingSmoother(0.15));
  const smoothHeadingRef = useRef(null);
  const frontHeadingRef = useRef(0);
  const azRef = useRef(0);
  const bucketRef = useRef(0);
  const dwellSinceRef = useRef(0);
  const lastCaptureAzRef = useRef(null);
  const lastSigRef = useRef(null);
  const manualNextRef = useRef(0);
  const modeRef = useRef('manual');
  const pausedRef = useRef(false);
  const recordingRef = useRef(false);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // ── Camera + mic (one getUserMedia; the audio track stays disabled until use) ──
  useEffect(() => {
    let cancelled = false;
    scanIdRef.current = Date.now();
    (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: true,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        } catch (e2) {
          if (!cancelled) setError(`Camera unavailable: ${e2.message}`);
          return;
        }
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      stream.getAudioTracks().forEach(t => { t.enabled = false; });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setPhase('calibrate');
    })();

    navigator.geolocation?.getCurrentPosition(
      p => { geoRef.current = { lat: p.coords.latitude, lng: p.coords.longitude }; },
      () => {},
      { timeout: 8000, maximumAge: 60000 }
    );

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      recorderRef.current?.dispose();
    };
  }, []);

  // Backgrounding mutes tracks and stops sensors; resuming mid-scan would
  // silently capture stale angles, so make the user re-center.
  useEffect(() => {
    const onVis = () => { if (document.hidden) setPaused(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── Compass ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'scanning' || mode !== 'compass') return;
    const handler = e => {
      const h = headingFromEvent(e);
      if (h == null) return;
      smoothHeadingRef.current = smootherRef.current.push(h);
    };
    window.addEventListener('deviceorientationabsolute', handler);
    window.addEventListener('deviceorientation', handler);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handler);
      window.removeEventListener('deviceorientation', handler);
    };
  }, [phase, mode]);

  const grabFrameBase64 = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, MAX_FRAME_WIDTH / v.videoWidth);
    const c = canvasRef.current;
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }, []);

  // Tiny grayscale signature, used to reject a phone that isn't actually moving.
  const frameSignature = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = diffCanvasRef.current;
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    const sig = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      sig[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
    }
    return sig;
  }, []);

  const capture = useCallback((bIdx, angleDeg) => {
    if (bucketsRef.current[bIdx]) return false;
    if (inFlightRef.current >= MAX_IN_FLIGHT) return false;
    const b64 = grabFrameBase64();
    if (!b64) return false;

    bucketsRef.current[bIdx] = { angle: angleDeg }; // claim before any async
    setFilled(bucketsRef.current.map(Boolean));
    lastCaptureAzRef.current = angleDeg;
    lastSigRef.current = frameSignature();
    inFlightRef.current += 1;

    scanFrame({ frameBase64: b64, angle: angleDeg, bucketIndex: bIdx, scanId: scanIdRef.current })
      .then(damage => {
        const stored = { ...damage, scan_angle: angleDeg, bucket_index: bIdx };
        analysesRef.current.push(stored);
        if (bucketsRef.current[bIdx]) bucketsRef.current[bIdx].damage = stored;
        const areas = damage?.affected_areas || damage?.damaged_areas || [];
        if (areas.length) {
          setAiAreas(prev => [
            ...prev,
            ...areas.map(a => ({
              id: `${bIdx}-${a.name || a.area_name || 'area'}-${Math.random()}`,
              name: a.name || a.area_name || a.area || 'Unknown area',
              severity: a.severity || damage.severity || '',
            })),
          ]);
        }
      })
      .catch(e => console.warn('[MobileScan] scanFrame:', e.message))
      .finally(() => { inFlightRef.current -= 1; });

    return true;
  }, [grabFrameBase64, frameSignature]);

  // ── Gating loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'scanning' || mode !== 'compass') return;
    const id = setInterval(() => {
      if (pausedRef.current || recordingRef.current) return;
      const h = smoothHeadingRef.current;
      if (h == null) return;

      const az = (h - frontHeadingRef.current + 360) % 360;
      azRef.current = az;
      setAzimuth(az);

      const raw = Math.floor(az / BUCKET_DEG) % BUCKETS;
      let bucket = bucketRef.current;
      if (raw !== bucket) {
        // Only adopt a new bucket well clear of both edges, so a heading sitting
        // on a boundary doesn't flip back and forth.
        const into = az - raw * BUCKET_DEG;
        if (Math.min(into, BUCKET_DEG - into) >= HYSTERESIS_DEG) {
          bucket = raw;
          bucketRef.current = raw;
          dwellSinceRef.current = Date.now();
          setCurrentBucket(raw);
        }
      }

      if (bucketsRef.current[bucket]) return;
      if (!dwellSinceRef.current) { dwellSinceRef.current = Date.now(); return; }
      if (Date.now() - dwellSinceRef.current < DWELL_MS) return;
      if (lastCaptureAzRef.current != null && angleDelta(az, lastCaptureAzRef.current) < MIN_TRAVEL_DEG) return;

      // Reject a stationary phone: the view must have actually changed.
      const sig = frameSignature();
      if (sig && lastSigRef.current) {
        let diff = 0;
        for (let i = 0; i < sig.length; i++) diff += Math.abs(sig[i] - lastSigRef.current[i]);
        if (diff / sig.length < 6) return;
      }

      capture(bucket, Math.round(az));
    }, 150);
    return () => clearInterval(id);
  }, [phase, mode, capture, frameSignature]);

  // ── Calibration ────────────────────────────────────────────────────────────
  function beginScan(useCompass, heading) {
    if (useCompass) {
      frontHeadingRef.current = heading;
      smootherRef.current.reset();
      smoothHeadingRef.current = heading;
      setMode('compass');
    } else {
      setMode('manual');
    }
    bucketRef.current = 0;
    setCurrentBucket(0);
    dwellSinceRef.current = Date.now();
    setPaused(false);
    setPhase('scanning');
  }

  async function handleSetFront() {
    // requestPermission must be reached synchronously from the tap on iOS.
    let granted = true;
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try { granted = (await DOE.requestPermission()) === 'granted'; } catch { granted = false; }
    }
    if (!granted) { beginScan(false); return; }

    const heading = await new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; cleanup(); resolve(v); } };
      const handler = e => {
        const h = headingFromEvent(e);
        if (h != null) finish(h);
      };
      const cleanup = () => {
        window.removeEventListener('deviceorientationabsolute', handler);
        window.removeEventListener('deviceorientation', handler);
        clearTimeout(timer);
      };
      window.addEventListener('deviceorientationabsolute', handler);
      window.addEventListener('deviceorientation', handler);
      const timer = setTimeout(() => finish(null), COMPASS_TIMEOUT_MS);
    });

    beginScan(heading != null, heading);
  }

  // ── Voice notes ────────────────────────────────────────────────────────────
  function startNote() {
    if (recordingRef.current) return;
    recordingRef.current = true; // set eagerly — state lags a render behind the next pointer event
    if (!recorderRef.current) recorderRef.current = createVoskRecorder();
    recorderRef.current.prime(); // synchronous — iOS unlocks audio only in the gesture
    const note = {
      id: String(Date.now()),
      text: '',
      angle: Math.round(azRef.current),
      lat: geoRef.current?.lat ?? null,
      lng: geoRef.current?.lng ?? null,
    };
    activeNoteRef.current = note;
    setRecording(true);
    setLiveText('');
    setMicStatus('Starting…');
    recorderRef.current.start({
      stream: streamRef.current,
      onStatus: setMicStatus,
      onText: t => { setLiveText(t); if (activeNoteRef.current) activeNoteRef.current.text = t; },
    });
  }

  async function endNote() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    const note = activeNoteRef.current;
    activeNoteRef.current = null;
    const { text, audioUrl } = await recorderRef.current.stop({ stream: streamRef.current });
    setMicStatus('');
    setLiveText('');
    if (!note) return;
    const finalNote = { ...note, text: text || note.text, audioUrl, timestamp: new Date().toLocaleString() };
    if (!finalNote.text) return;
    setNotes(prev => {
      const next = [...prev, finalNote];
      fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: scanIdRef.current, notes: next }),
      }).catch(() => {});
      return next;
    });
  }

  function handleManualCapture() {
    // With a live compass the angle is known, so fill the bucket the user is
    // actually standing in rather than the next sequential one.
    if (mode === 'compass' && smoothHeadingRef.current != null) {
      const idx = bucketRef.current;
      if (bucketsRef.current[idx]) return;
      if (capture(idx, Math.round(azRef.current))) setCurrentBucket(idx);
      return;
    }
    let idx = manualNextRef.current;
    for (let i = 0; i < BUCKETS && bucketsRef.current[idx]; i++) idx = (idx + 1) % BUCKETS;
    if (bucketsRef.current[idx]) return;
    if (capture(idx, Math.round(idx * BUCKET_DEG))) {
      manualNextRef.current = (idx + 1) % BUCKETS;
      setCurrentBucket(idx);
    }
  }

  function handleFinish() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    recorderRef.current?.dispose();
    onCapture(bucketsRef.current.filter(Boolean), notes, mergeDamageAnalyses(analysesRef.current));
  }

  const capturedCount = filled.filter(Boolean).length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: '#000', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <canvas ref={diffCanvasRef} style={{ display: 'none' }} />

      {/* Top status bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
        padding: 'max(12px, env(safe-area-inset-top)) 14px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        background: 'linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0))',
      }}>
        <div style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>
          {capturedCount} / {BUCKETS} angles
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 400 }}>
            {mode === 'compass' ? `${dirLabel(azimuth)} · ${Math.round(azimuth)}°` : 'Manual mode'}
          </div>
        </div>
        <button
          onClick={onExit}
          style={{
            background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 10, color: 'white', padding: '8px 14px', fontSize: 13, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Progress ring */}
      {phase === 'scanning' && (
        <div style={{ position: 'absolute', top: 72, right: 14 }}>
          <ProgressRing filled={filled} current={currentBucket} />
        </div>
      )}

      {/* AI findings */}
      {phase === 'scanning' && aiAreas.length > 0 && (
        <div style={{
          ...PANEL, position: 'absolute', top: 72, left: 14,
          padding: 12, maxWidth: 200, maxHeight: 190, overflowY: 'auto',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Detected
          </div>
          {aiAreas.slice(-6).map(a => (
            <div key={a.id} style={{ color: 'white', fontSize: 12, marginBottom: 6, lineHeight: 1.35 }}>
              {a.name}
              {a.severity && <span style={{ color: 'rgba(255,255,255,0.45)' }}> · {a.severity}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {phase === 'scanning' && notes.length > 0 && (
        <div style={{
          position: 'absolute', left: 14, bottom: 170,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxHeight: '32vh', overflowY: 'auto',
        }}>
          {notes.map(n => (
            <SpatialNotePin
              key={n.id}
              note={n}
              onRedo={id => setNotes(prev => prev.filter(x => x.id !== id))}
            />
          ))}
        </div>
      )}

      {/* Live transcript */}
      {recording && (
        <div style={{ ...PANEL, position: 'absolute', left: 14, right: 14, bottom: 150, padding: 14 }}>
          <div style={{ color: '#1a3cef', fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            {micStatus || 'Listening…'}
          </div>
          <div style={{ color: 'white', fontSize: 14, lineHeight: 1.45, minHeight: 20 }}>
            {liveText || 'Speak now…'}
          </div>
        </div>
      )}

      {/* Bottom controls */}
      {phase === 'scanning' && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: '16px 14px max(16px, env(safe-area-inset-bottom))',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.75))',
        }}>
          <button
            onClick={handleManualCapture}
            style={{
              flex: 1, padding: '14px', borderRadius: 14, fontSize: 14, fontWeight: 600,
              background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.24)',
              color: 'white', cursor: 'pointer',
            }}
          >
            Capture angle
          </button>

          <button
            onPointerDown={startNote}
            onPointerUp={endNote}
            onPointerCancel={endNote}
            onContextMenu={e => e.preventDefault()}
            style={{
              width: 62, height: 62, borderRadius: '50%', flexShrink: 0,
              background: recording ? '#ef4444' : 'rgba(255,255,255,0.16)',
              border: '1px solid rgba(255,255,255,0.28)',
              color: 'white', fontSize: 22, cursor: 'pointer', touchAction: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Hold to record a voice note"
          >
            ●
          </button>

          <button
            onClick={handleFinish}
            style={{
              flex: 1, padding: '14px', borderRadius: 14, fontSize: 14, fontWeight: 700,
              background: '#1a3cef', border: 'none', color: 'white', cursor: 'pointer',
            }}
          >
            Finish scan
          </button>
        </div>
      )}

      {/* Overlays */}
      {(phase !== 'scanning' || paused || error) && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(0,0,0,0.66)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ ...PANEL, padding: 24, width: 'min(420px, 100%)', textAlign: 'center' }}>
            {error ? (
              <>
                <div style={{ color: 'white', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Camera unavailable</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>{error}</div>
                <button className="btn-primary" onClick={onExit} style={{ width: '100%', padding: 13, borderRadius: 12 }}>
                  Go back
                </button>
              </>
            ) : paused ? (
              <>
                <div style={{ color: 'white', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Scan paused</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>
                  Stand facing the front of the vehicle to re-center, then resume.
                </div>
                <button className="btn-primary" onClick={handleSetFront} style={{ width: '100%', padding: 13, borderRadius: 12 }}>
                  Re-center and resume
                </button>
              </>
            ) : phase === 'starting' ? (
              <>
                <div style={{ color: 'white', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Starting camera…</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Allow camera and microphone access to continue.</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, letterSpacing: 4, color: '#1a3cef', marginBottom: 14, textTransform: 'uppercase', fontWeight: 600 }}>
                  Lumen
                </div>
                <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 8 }}>Set the vehicle front</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 1.55, marginBottom: 20 }}>
                  Stand about 2–3 m away, facing the front of the vehicle, and tap Set Front.
                  Then walk a full circle around it, keeping the vehicle in frame — angles are
                  captured automatically as you go.
                </div>
                <button className="btn-primary" onClick={handleSetFront} style={{ width: '100%', padding: 14, borderRadius: 12, marginBottom: 10 }}>
                  Set Front &amp; start
                </button>
                <button
                  onClick={() => beginScan(false)}
                  style={{
                    width: '100%', padding: 12, borderRadius: 12, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.6)',
                    fontSize: 13, cursor: 'pointer',
                  }}
                >
                  Capture manually instead
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
