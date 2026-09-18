import { useState, useEffect } from 'react';
import AppBackground from '../components/AppBackground';
import SideNav from '../components/SideNav';
import GaussianViewer from '../components/GaussianViewer';

const CARD = {
  background: 'rgba(93,93,93,0.80)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  borderRadius: 20,
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
};

const DIVIDER = { height: 1, background: 'rgba(255,255,255,0.10)', margin: '16px 0' };
const TEXT_MUTED = 'rgba(255,255,255,0.45)';
const TEXT_SECONDARY = 'rgba(255,255,255,0.6)';

export default function ReviewScene({ claim, damageData, coverageDecisions = [], splatUrl, onView3D }) {
  const [submitted, setSubmitted] = useState(false);
  const [show3D] = useState(true);
  const [frames, setFrames] = useState([]);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  void damageData;
  void coverageDecisions;

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/scan-frames/latest`)
      .then(r => r.json())
      .then(data => {
        const base = import.meta.env.VITE_API_URL ?? '';
        setFrames((data.frames || []).map(f => `${base}${f}`));
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <AppBackground />
      <SideNav active="report" />

      <div style={{
        position: 'relative', zIndex: 10, display: 'flex', gap: 16,
        alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center',
        maxWidth: '100%', padding: '16px', boxSizing: 'border-box',
        maxHeight: '100vh', overflowY: 'auto',
      }}>

        {/* ── Report card ── */}
        <div style={{ ...CARD, padding: 20, width: 'min(300px, calc(100vw - 32px))', boxSizing: 'border-box' }}>
          {/* Header */}
          <div style={{ color: 'white', fontSize: 19, fontWeight: 700 }}>Report Generation</div>
          <div style={{ color: TEXT_MUTED, fontSize: 13, marginTop: 4 }}>
            AI generated claim report of the incident you just recorded.
          </div>
          <div style={DIVIDER} />

          {/* Claim report image */}
          <div style={{
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(240,241,245,0.95)',
          }}>
            <img
              src="/assets/claim-report.png"
              alt="Claim Report"
              style={{ width: '100%', display: 'block' }}
            />
          </div>

          <div style={DIVIDER} />

          {/* Submit */}
          {submitted ? (
            <div style={{
              padding: '12px', borderRadius: 12, textAlign: 'center',
              background: 'rgba(26,60,239,0.20)', border: '1px solid rgba(26,60,239,0.36)',
            }}>
              <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 13 }}>✓ Report Submitted</div>
              <div style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 3 }}>
                Sent to HQ · {claim?.claimId}
              </div>
            </div>
          ) : (
            <button
              className="btn-primary"
              onClick={() => setSubmitted(true)}
              style={{ width: '100%', borderRadius: 12, padding: '12px', fontSize: 14 }}
            >
              Send Report to Headquarters
            </button>
          )}
        </div>

        {/* ── Right column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 'min(260px, calc(100vw - 32px))' }}>

          {/* View in 3D button */}
          <button
            className="btn-primary"
            onClick={onView3D}
            style={{ width: '100%', padding: '11px', borderRadius: 12, fontSize: 14, fontWeight: 600 }}
          >
            View in 3D
          </button>

          {/* GS viewer */}
          <div style={{ ...CARD, height: 160, overflow: 'hidden', position: 'relative' }}>
            {show3D && splatUrl ? (
              <GaussianViewer splatUrl={splatUrl} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: TEXT_MUTED, fontSize: 13,
              }}>
                2D View of GS
              </div>
            )}
          </div>

          {/* Captured frames grid — 4 × 3 */}
          {frames.length > 0 && (
            <div>
              <div style={{ color: TEXT_SECONDARY, fontSize: 11, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Captured · {frames.length}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {frames.slice(0, 12).map((url, i) => (
                  <div
                    key={i}
                    onClick={() => setLightboxIdx(i)}
                    style={{
                      aspectRatio: '1', borderRadius: 8, overflow: 'hidden',
                      background: 'rgba(93,93,93,0.80)',
                      border: '1px solid rgba(255,255,255,0.14)',
                      cursor: 'pointer',
                    }}
                  >
                    <img
                      src={url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {frames.length === 0 && (
            <div style={{ color: TEXT_MUTED, fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
              No captured images found.<br />Restart task to capture images.
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          onClick={() => setLightboxIdx(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img
            src={frames[lightboxIdx]}
            alt="frame"
            style={{ maxWidth: '88vw', maxHeight: '82vh', borderRadius: 12, boxShadow: '0 0 60px rgba(0,0,0,0.8)' }}
            onClick={e => e.stopPropagation()}
          />
          <div style={{ position: 'absolute', top: 20, right: 28, display: 'flex', gap: 10 }}>
            {[
              { label: '←', action: () => setLightboxIdx(i => Math.max(0, i - 1)) },
              { label: '→', action: () => setLightboxIdx(i => Math.min(frames.length - 1, i + 1)) },
              { label: '✕', action: () => setLightboxIdx(null), danger: true },
            ].map(({ label, action, danger }) => (
              <button
                key={label}
                onClick={e => { e.stopPropagation(); action(); }}
                style={{
                  background: danger ? 'rgba(248,113,113,0.30)' : 'rgba(93,93,93,0.80)',
                  border: danger ? '1px solid rgba(248,113,113,0.35)' : '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 8, color: 'white',
                  padding: '8px 14px', cursor: 'pointer', fontSize: 15,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
