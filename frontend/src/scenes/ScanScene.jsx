import { useState, useRef, useEffect } from 'react';
import SideNav from '../components/SideNav';
import PolicyCitation from '../components/PolicyCitation';
import ClaimHUD from '../components/ClaimHUD';
import ImmersiveScan from '../components/ImmersiveScan';
import { enableXRLayer } from '../lib/enableXRLayer';
import { checkCoverage, ocrDocument } from '../lib/api';

const isVisionPro = /visionOS/.test(navigator.userAgent);




const inWebSpatial = /WebSpatial\//.test(navigator.userAgent);
const isVisionSpatial = isVisionPro || inWebSpatial;
const SPLAT_URL = `${import.meta.env.VITE_API_URL ?? '/api'}/splat`;
const SPIN = ['◐', '◓', '◑', '◒'];

const CARD = {
  background: 'rgba(93,93,93,0.80)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  borderRadius: 20,
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
  padding: 28,
  width: 480,
};

const DIVIDER = { height: 1, background: 'rgba(255,255,255,0.10)', margin: '16px 0' };

const STATUS_COLORS = { green: '#1a3cef', red: '#f87171', amber: '#fbbf24', gray: '#94a3b8', blue: '#1a3cef' };

// ─── Sub-screens ───────────────────────────────────────────────────────────────

function TaskCard({ onStart, onDismiss }) {
  return (
    <div className="fade-up" style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e', flexShrink: 0 }} />
        <div>
          <div style={{ color: 'white', fontSize: 17, fontWeight: 700 }}>New Task Assigned</div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>20 mins ago · From HQ</div>
        </div>
      </div>
      <div style={DIVIDER} />
      {[
        ['Case ID', 'CLM-2024-8821'],
        ['Vehicle', '2021 Chevrolet Silverado'],
        ['Claimant', 'Jane D. Demo'],
        ['Location', 'I-95 N, Houston TX'],
      ].map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{label}</span>
          <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>{value}</span>
        </div>
      ))}
      <div style={DIVIDER} />
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-secondary spatial-btn" onClick={onDismiss} style={{ flex: 1 }}>Dismiss</button>
        <button className="btn-primary spatial-btn" onClick={onStart} style={{ flex: 1 }}>Start Inspection</button>
      </div>
    </div>
  );
}

function UIQTokenScreen({ onVerify }) {
  const [token, setToken] = useState('');
  return (
    <div className="fade-up" style={CARD}>
      <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>UIQ Token</div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
        Enter the unique inspection token provided by HQ for this claim.
      </div>
      <div style={DIVIDER} />
      <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 6, display: 'block' }}>Token number</label>
      <input
        value={token}
        onChange={e => setToken(e.target.value)}
        placeholder="UIQ - 1 2 3 4 5 - 6 7 8 9"
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 10,
          background: 'rgba(240,241,245,0.95)', fontSize: 14,
          color: '#1a1a2e', marginBottom: 20, fontFamily: 'monospace', boxSizing: 'border-box',
        }}
      />
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
        This helps the company to accurately identify and validate the specific approved policy details tied to this claim.
      </div>
      <button className="btn-primary spatial-btn" onClick={() => onVerify(token)} style={{ borderRadius: 12, width: '100%' }}>
        Verify Token
      </button>
    </div>
  );
}

function DriverDetailsChoice({ onManual, onScan }) {
  return (
    <div className="fade-up" style={CARD}>
      <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Driver Details</div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
        How would you like to input the driver&apos;s details?
      </div>
      <div style={DIVIDER} />
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-secondary spatial-btn" onClick={onManual} style={{ flex: 1 }}>Enter Manually</button>
        <button className="btn-primary spatial-btn" onClick={onScan} style={{ flex: 1 }}>Scan Document</button>
      </div>
    </div>
  );
}

function ScanLicenseScreen({ onCapture, onManual }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isVisionSpatial) return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      })
      .catch(() => { });
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  function stopStream() { streamRef.current?.getTracks().forEach(t => t.stop()); }

  async function handleTrigger() {
    if (isVisionSpatial) { onCapture(null); return; }
    if (!videoRef.current || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      stopStream();
      const data = await ocrDocument(b64, 'drivers_license');
      onCapture(data);
    } catch {
      stopStream();
      onCapture(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up" style={CARD}>
      <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Scan Driver's License</div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
        Point the camera at the license, then pull the trigger.
      </div>
      <div style={DIVIDER} />
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      <button className="btn-primary spatial-btn" onClick={handleTrigger}
        style={{ borderRadius: 12, width: '100%', marginBottom: 10 }} disabled={busy}>
        {busy ? 'Reading…' : isVisionSpatial ? 'Continue' : 'Capture'}
      </button>
      <button className="spatial-btn" onClick={() => { stopStream(); onManual(); }} style={{
        marginTop: 10, width: '100%', padding: '11px',
        background: 'rgba(30,30,40,0.88)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12, color: 'rgba(255,255,255,0.55)', fontSize: 14, cursor: 'pointer',
      }}>
        Enter Manually Instead
      </button>
      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Step 1 of 3</span>
      </div>
    </div>
  );
}

function DriverDetailsResult({ driver, onCapturePhoto, onManual }) {
  return (
    <div className="fade-up" style={CARD}>
      <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 16 }}>Driver Details</div>
      <div style={DIVIDER} />
      {[
        ['Name', driver.name || 'Jane D. Demo'],
        ['Age', driver.age || '26 years'],
        ['License No.', driver.license || '5463-78-7214'],
        ['Address', driver.address || '123 Sample St, City, ST 12345'],
        ['Valid Until', driver.validity || 'December 31, 2030'],
      ].map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 11 }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{label}</span>
          <span style={{ color: 'white', fontSize: 14, fontWeight: 500, textAlign: 'right', maxWidth: '55%' }}>{value}</span>
        </div>
      ))}
      <div style={DIVIDER} />
      <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 12 }}>
        A photo of the driver is required to complete verification.
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-secondary spatial-btn" onClick={onManual} style={{ flex: 1 }}>Edit Details</button>
        <button className="btn-primary spatial-btn" onClick={onCapturePhoto} style={{ flex: 1 }}>Continue</button>
      </div>
      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Step 1 of 3</span>
      </div>
    </div>
  );
}

function CapturePhotoScreen({ onCapture, onBack }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (isVisionSpatial) return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      })
      .catch(() => { });
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const DUMMY_PHOTO = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#1e293b"/><circle cx="320" cy="180" r="80" fill="#334155"/><ellipse cx="320" cy="400" rx="160" ry="100" fill="#334155"/><text x="320" y="470" text-anchor="middle" fill="#64748b" font-size="20" font-family="sans-serif">Driver Photo</text></svg>`);

  function handleCapture() {
    if (isVisionSpatial) { setPreview(DUMMY_PHOTO); return; }
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    streamRef.current?.getTracks().forEach(t => t.stop());
    setPreview(canvas.toDataURL('image/jpeg', 0.85));
  }

  function handleRetake() {
    setPreview(null);
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      })
      .catch(() => { });
  }

  return (
    <div className="fade-up" style={CARD}>
      <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Driver Photo</div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
        {preview ? 'Review the photo before continuing.' : 'Point the camera at the driver, then pull the trigger.'}
      </div>
      <div style={DIVIDER} />
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      {preview && (
        <img src={preview} alt="captured" style={{
          width: '100%', height: 200, objectFit: 'cover', borderRadius: 12, marginBottom: 16, display: 'block',
        }} />
      )}
      {preview ? (
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-secondary spatial-btn" onClick={handleRetake} style={{ flex: 1 }}>Retake</button>
          <button className="btn-primary spatial-btn" onClick={onCapture} style={{ flex: 1 }}>Continue</button>
        </div>
      ) : (
        <button className="btn-primary spatial-btn" onClick={handleCapture}
          style={{ borderRadius: 12, width: '100%' }}>
          {isVisionSpatial ? 'Continue' : 'Capture'}
        </button>
      )}
      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Step 2 of 3</span>
      </div>
    </div>
  );
}

function ScanVehicleRegScreen({ onCapture, onManual }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isVisionSpatial) return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      })
      .catch(() => { });
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  function stopStream() { streamRef.current?.getTracks().forEach(t => t.stop()); }

  async function handleTrigger() {
    if (isVisionSpatial) { onCapture(null); return; }
    if (!videoRef.current || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      stopStream();
      const data = await ocrDocument(b64, 'vehicle_registration');
      onCapture(data);
    } catch {
      stopStream();
      onCapture(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up" style={CARD}>
      <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Scan Vehicle Registration</div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
        Point the camera at the registration card, then pull the trigger.
      </div>
      <div style={DIVIDER} />
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      <button className="btn-primary spatial-btn" onClick={handleTrigger}
        style={{ borderRadius: 12, width: '100%', marginBottom: 10 }} disabled={busy}>
        {busy ? 'Reading…' : isVisionSpatial ? 'Continue' : 'Capture'}
      </button>
      <button className="spatial-btn" onClick={() => { stopStream(); onManual(); }} style={{
        marginTop: 4, width: '100%', padding: '11px',
        background: 'rgba(30,30,40,0.88)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12, color: 'rgba(255,255,255,0.55)', fontSize: 14, cursor: 'pointer',
      }}>
        Enter Manually Instead
      </button>
      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Step 3 of 3</span>
      </div>
    </div>
  );
}

function RegistrationDetailsResult({ reg, onContinue }) {
  return (
    <div className="fade-up" style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ color: 'white', fontSize: 19, fontWeight: 700 }}>Registration Details</div>
      </div>
      <div style={DIVIDER} />
      {[
        ['Name', reg.name || 'Jane D. Demo'],
        ['Age', reg.age || '26 years'],
        ['Vehicle Identification Number (VIN)', reg.vin || '5NMS3CLBJNH033803'],
        ['License Plate Number', reg.plate || 'SEA MTR'],
        ['Vehicle Year, Make', reg.vehicle || '2021 Chevrolet Silverado'],
        ['Registration Expiry Date', reg.expiry || 'Midnight Tue 11/30/2021'],
      ].map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 11, alignItems: 'flex-start' }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, flexShrink: 0, maxWidth: '45%' }}>{label}</span>
          <span style={{ color: 'white', fontSize: 14, fontWeight: 500, textAlign: 'right', maxWidth: '52%' }}>{value}</span>
        </div>
      ))}
      <div style={DIVIDER} />
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-secondary spatial-btn" onClick={() => { }} style={{ flex: 1 }}>Edit Details</button>
        <button className="btn-primary spatial-btn" onClick={onContinue} style={{ flex: 1, borderRadius: 12, padding: '13px' }}>Continue</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14 }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>Step 3 of 3</span>
      </div>
    </div>
  );
}

function VerifyPolicyDialog({ onDismiss, onVerify }) {
  return (
    <div className="fade-up" style={{ ...CARD, textAlign: 'center' }}>
      <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 8 }}>Verify Policy</div>
      <div style={{ color: 'rgba(255,255,255,0.50)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
        Verify the captured information and check if coverage is active or not.
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-secondary spatial-btn" onClick={onDismiss} style={{ flex: 1 }}>Dismiss</button>
        <button className="btn-primary spatial-btn" onClick={onVerify} style={{ flex: 1 }}>Verify</button>
      </div>
    </div>
  );
}

function PolicyActiveScreen({ policyData, onProceed }) {
  const [loading, setLoading] = useState(false);
  const info = [
    ['Claimant', policyData.claimant || 'Jane D. Demo'],
    ['Policy #', policyData.policy_number || 'ALLST-2024-TX-00925'],
    ['Coverage', policyData.coverage || 'Comprehensive + collision'],
    ['Valid through', policyData.valid_through || 'Dec 31, 2030'],
    ['Open Claims', policyData.open_claims || 'None'],
  ];
  async function handleProceed() {
    setLoading(true);
    await onProceed();
  }
  return (
    <div className="fade-up" style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e', flexShrink: 0 }} />
        <div style={{ color: 'white', fontSize: 19, fontWeight: 700 }}>Policy Active</div>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 20 }}>
        Coverage is verified and eligible
      </div>
      <div style={DIVIDER} />
      {info.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{label}</span>
          <span style={{ color: 'white', fontSize: 14, fontWeight: 500, textAlign: 'right', maxWidth: '55%' }}>{value}</span>
        </div>
      ))}
      <div style={DIVIDER} />
      <button className="btn-primary spatial-btn" onClick={handleProceed} disabled={loading}
        style={{ width: '100%', borderRadius: 12, padding: '14px', opacity: loading ? 0.7 : 1 }}>
        {loading ? 'Starting…' : 'Proceed to Scan Vehicle'}
      </button>
    </div>
  );
}

function LoadingScreen() {
  const [spinIdx, setSpinIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSpinIdx(i => (i + 1) % 4), 220);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fade-up" style={CARD}>
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <div style={{ fontSize: 38, color: '#1a3cef', marginBottom: 16 }}>{SPIN[spinIdx]}</div>
        <div style={{ color: 'white', fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Preparing Scan</div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>Starting immersive session…</div>
      </div>
    </div>
  );
}

// ─── Main ScanScene ───────────────────────────────────────────────────────────

export default function ScanScene({ claim, onComplete }) {
  const [step, setStep] = useState('task');
  const [driver, setDriver] = useState({});
  const [reg, setReg] = useState({});
  const [xrSession, setXrSession] = useState(null);
  const [coverageDecisions, setCoverageDecisions] = useState([]);
  const [damageData, setDamageData] = useState(null);
  const [voiceNotes, setVoiceNotes] = useState([]);
  const [spinIdx, setSpinIdx] = useState(0);
  const [scanError, setScanError] = useState('');

  useEffect(() => {
    const t = setInterval(() => setSpinIdx(i => (i + 1) % 4), 220);
    return () => clearInterval(t);
  }, []);

  const [policyData] = useState({
    claimant: claim?.adjuster || 'Jane D. Demo',
    policy_number: 'ALLST-2024-TX-00925',
    coverage: 'Comprehensive + collision',
    valid_through: 'Dec 31, 2026',
    open_claims: 'None',
  });

  async function handleImmersiveScan(frames, notes, scanDamage) {
    setVoiceNotes(notes);
    setStep('generating');
    try {
      const damage = scanDamage || {
        damaged_areas: [],
        affected_areas: [],
        damage_type: 'unknown',
        severity: 'unknown',
      };
      setDamageData(damage);
      let coverageResult = { coverage_decisions: [] };
      try { coverageResult = await checkCoverage(damage); } catch (e) { console.warn('[ScanScene] checkCoverage failed:', e.message); }
      setCoverageDecisions(coverageResult.coverage_decisions || []);
      setStep('coverage');
    } catch (err) {
      console.error('[ScanScene] immersive error:', err);
      setScanError('Analysis failed. Check your connection and try again.');
      setStep('retry');
    }
  }

  const covMap = {};
  coverageDecisions.forEach(d => { covMap[d.area_name] = d.coverage_status; });

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <SideNav />

      {(step === 'generating' || step === 'generating-report') && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="fade-up" style={CARD}>
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 11, letterSpacing: 4, color: '#1a3cef', marginBottom: 16, textTransform: 'uppercase', fontWeight: 600 }}>
                Lumen
              </div>
              <div style={{ fontSize: 38, marginBottom: 12, color: '#1a3cef' }}>{SPIN[spinIdx]}</div>
              <div style={{ color: 'white', fontSize: 19, fontWeight: 700 }}>
                {step === 'generating-report' ? 'Generating 3D worlds' : 'Generating 3D Reconstruction'}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 8 }}>
                {step === 'generating-report' ? 'Preparing report…' : 'Analysing coverage…'}
              </div>
            </div>
          </div>
        </div>
      )}

      {(step === 'generating' || step === 'generating-report') && (
        <ClaimHUD
          claimId={claim.claimId}
          adjuster={claim.adjuster}
          stage={step === 'generating-report' ? 'Generating' : 'Processing'}
        />
      )}

      {step === 'scan' && (
        <ImmersiveScan onCapture={handleImmersiveScan} onExit={() => { setScanError(''); setStep('retry'); }} xrSession={xrSession} />
      )}

      <div style={{ position: 'relative', zIndex: 10 }}>
        {step === 'task' && (
          <TaskCard onStart={() => setStep('uiq')} onDismiss={() => { }} />
        )}
        {step === 'uiq' && (
          <UIQTokenScreen onVerify={() => setStep('driver-choice')} />
        )}
        {step === 'driver-choice' && (
          <DriverDetailsChoice onManual={() => setStep('driver')} onScan={() => setStep('license')} />
        )}
        {step === 'license' && (
          <ScanLicenseScreen
            onCapture={(data) => {
              if (data) {
                const fields = data.extracted_fields || data;
                setDriver({
                  name: fields.name,
                  age: fields.age || fields.dob,
                  license: fields.license || fields.license_number,
                  address: fields.address,
                  validity: fields.validity || fields.expiration_date || fields.valid_until
                });
              }
              setStep('driver');
            }}
            onManual={() => setStep('driver')}
          />
        )}
        {step === 'driver' && (
          <DriverDetailsResult driver={driver} onCapturePhoto={() => setStep('photo')} onManual={() => setStep('driver')} />
        )}
        {step === 'photo' && (
          <CapturePhotoScreen onCapture={() => setStep('vehicle-reg')} onBack={() => setStep('vehicle-reg')} />
        )}
        {step === 'vehicle-reg' && (
          <ScanVehicleRegScreen onCapture={(data) => { if (data) setReg(data); setStep('reg-details'); }} onManual={() => setStep('reg-details')} />
        )}
        {step === 'reg-details' && (
          <RegistrationDetailsResult reg={reg} onContinue={() => setStep('verify-claim')} />
        )}
        {step === 'verify-claim' && (
          <VerifyPolicyDialog onDismiss={() => setStep('vehicle-reg')} onVerify={() => setStep('policy-active')} />
        )}
        {step === 'policy-active' && (
          <PolicyActiveScreen policyData={policyData} onProceed={async () => {
            if (isVisionSpatial) {
              const damage = { damaged_areas: [], damage_type: 'unknown', severity: 'unknown' };
              setDamageData(damage);
              setCoverageDecisions([]);
              setVoiceNotes([]);
              setStep('generating-report');
              await new Promise(resolve => setTimeout(resolve, 1800));
              onComplete(damage, [], {}, SPLAT_URL, [], { nextScene: 'review' });
              return;
            }
            setStep('loading');
            // Start XR session immediately — must be called within user gesture context before any await
            const sessionPromise = navigator.xr?.requestSession('immersive-ar', {
              requiredFeatures: ['local-floor', 'unbounded'],
              optionalFeatures: ['hit-test', 'hand-tracking'],
            }).catch(e => { console.warn('[ScanScene] requestSession failed:', e.message); return null; });
            // Geolocation in parallel — permission dialogs during XR exit the session on Quest
            if (navigator.geolocation) {
              await new Promise(resolve => {
                const id = navigator.geolocation.watchPosition(
                  () => { navigator.geolocation.clearWatch(id); resolve(); },
                  () => resolve(),
                  { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true }
                );
                setTimeout(resolve, 8000);
              });
            }
            const session = await sessionPromise;
            setXrSession(session);
            setStep('scan');
          }} />
        )}
        {step === 'loading' && <LoadingScreen />}
        {step === 'retry' && (
          <div className="fade-up" style={{ ...CARD, position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10000 }}>
            <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 8 }}>AR Session Ended</div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 20 }}>
              {scanError || 'The immersive session was closed. Tap retry to start again.'}
            </div>
            <button className="btn-primary spatial-btn" onClick={() => { setScanError(''); setStep('scan'); }}
              style={{ width: '100%', borderRadius: 12, padding: '13px' }}>
              Retry
            </button>
          </div>
        )}
        {step === 'coverage' && (
          <div style={{ ...CARD, maxHeight: '80vh', overflowY: 'auto', position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10000 }}>
            <div style={{ color: 'white', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Coverage Analysis</div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
              {coverageDecisions.length > 0 ? `${coverageDecisions.length} area${coverageDecisions.length !== 1 ? 's' : ''} assessed` : 'Sample data'}
            </div>
            <div style={DIVIDER} />
            {coverageDecisions.length > 0 ? coverageDecisions.map((d, i) => (
              <div key={i} style={{
                marginBottom: 10, padding: '10px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                borderLeft: `3px solid ${STATUS_COLORS[d.color] || '#94a3b8'}`,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'white', marginBottom: 2 }}>{d.area_name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{d.reason}</div>
                {d.estimated_payout_usd && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                    Est. payout: ${d.estimated_payout_usd.min}–${d.estimated_payout_usd.max}
                  </div>
                )}
              </div>
            )) : ([
              { area_name: 'Rear bumper', color: 'green', reason: 'Collision damage covered under comprehensive policy.' },
              { area_name: 'Left rear door', color: 'amber', reason: 'Partial coverage — pre-existing damage noted, adjuster review required.' },
              { area_name: 'Rear windshield', color: 'green', reason: 'Glass damage excluded under current deductible threshold.' },
            ].map((d, i) => (
              <div key={i} style={{
                marginBottom: 10, padding: '10px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                borderLeft: `3px solid ${STATUS_COLORS[d.color] || '#94a3b8'}`,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'white', marginBottom: 2 }}>{d.area_name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{d.reason}</div>
              </div>
            )))}
            <div style={DIVIDER} />
            <button
              className="btn-primary spatial-btn"
              onClick={() => onComplete(damageData, coverageDecisions, covMap, SPLAT_URL, voiceNotes)}
              style={{ width: '100%', borderRadius: 12, padding: '13px' }}
            >
              Generate Report
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
