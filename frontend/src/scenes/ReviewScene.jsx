import { useState, useEffect } from 'react';
import AppBackground from '../components/AppBackground';
import SideNav from '../components/SideNav';
import GaussianViewer from '../components/GaussianViewer';
import { getColor } from '../lib/coverageColors';

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

  // Roll the per-area payout ranges up into a claim total.
  const payout = coverageDecisions.reduce((acc, d) => ({
    min: acc.min + (d.estimated_payout_usd?.min || 0),
    max: acc.max + (d.estimated_payout_usd?.max || 0),
  }), { min: 0, max: 0 });
  const needsReview = coverageDecisions.filter(d => d.requires_human_review || d.color === 'gray');

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

          {/* Claim report — rendered from the live AI coverage decisions.
              This was a static claim-report.png, so the report always looked
              the same no matter what the scan actually found. */}
          {coverageDecisions.length === 0 ? (
            <div style={{
              padding: '16px', borderRadius: 10, textAlign: 'center',
              background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)',
            }}>
              <div style={{ color: '#fca5a5', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                No coverage decisions available
              </div>
              <div style={{ color: TEXT_MUTED, fontSize: 11, lineHeight: 1.5 }}>
                The damage analysis returned no assessable areas, so there is nothing to report.
                Re-run the scan before submitting.
              </div>
            </div>
          ) : (
            <div style={{
              borderRadius: 10, padding: 14,
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(0,0,0,0.22)',
            }}>
              {/* Claim header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: TEXT_MUTED, fontSize: 11 }}>Claim</span>
                <span style={{ color: 'white', fontSize: 11, fontWeight: 600 }}>{claim?.claimId || '—'}</span>
              </div>
              {damageData?.damage_type && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ color: TEXT_MUTED, fontSize: 11 }}>Damage</span>
                  <span style={{ color: 'white', fontSize: 11, fontWeight: 600, textAlign: 'right', maxWidth: '62%' }}>
                    {damageData.damage_type}{damageData.severity ? ` · ${damageData.severity}` : ''}
                  </span>
                </div>
              )}

              <div style={{ height: 1, background: 'rgba(255,255,255,0.10)', margin: '10px 0' }} />

              {/* Per-area decisions */}
              {coverageDecisions.map((d, i) => (
                <div key={i} style={{
                  marginBottom: 8, padding: '9px 10px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)',
                  borderLeft: `3px solid ${getColor(d.color).hex}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>{d.area_name}</span>
                    <span style={{ color: getColor(d.color).hex, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {getColor(d.color).label.toUpperCase()}
                    </span>
                  </div>
                  {d.reason && (
                    <div style={{ color: TEXT_SECONDARY, fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>{d.reason}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                    {d.policy_section && (
                      <span style={{ color: TEXT_MUTED, fontSize: 10 }}>§ {d.policy_section}</span>
                    )}
                    {d.estimated_payout_usd && (
                      <span style={{ color: TEXT_MUTED, fontSize: 10 }}>
                        ${d.estimated_payout_usd.min}–${d.estimated_payout_usd.max}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              <div style={{ height: 1, background: 'rgba(255,255,255,0.10)', margin: '10px 0' }} />

              {/* Total */}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>Estimated payout</span>
                <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 700 }}>
                  ${payout.min.toLocaleString()}–${payout.max.toLocaleString()}
                </span>
              </div>
              {needsReview.length > 0 && (
                <div style={{ color: '#fcd34d', fontSize: 10, marginTop: 6 }}>
                  {needsReview.length} area{needsReview.length !== 1 ? 's' : ''} flagged for adjuster review
                </div>
              )}
            </div>
          )}

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
              disabled={coverageDecisions.length === 0}
              style={{
                width: '100%', borderRadius: 12, padding: '12px', fontSize: 14,
                opacity: coverageDecisions.length === 0 ? 0.45 : 1,
                cursor: coverageDecisions.length === 0 ? 'not-allowed' : 'pointer',
              }}
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
