import { enableXRLayer } from '../lib/enableXRLayer';

export default function ClaimHUD({ claimId, adjuster, stage, progress }) {
  return (
    <div style={{
      position: 'fixed', top: 'max(20px, env(safe-area-inset-top))', left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 24px',
      background: 'rgba(26,60,239,0.15)',
      backdropFilter: 'blur(20px)',
      borderRadius: 40,
      border: '1px solid rgba(26,60,239,0.4)',
      color: 'white', fontFamily: 'Arial',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Headsets render this wide; phones need it to shrink and wrap instead of
      // overflowing the viewport.
      gap: 'clamp(8px, 3vw, 24px)', rowGap: 4, flexWrap: 'wrap',
      maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box',
      ...enableXRLayer({ zOffset: 0.1 })
    }}>
      <span style={{ fontSize: 12, opacity: 0.7 }}>Claim</span>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{claimId}</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{adjuster}</span>
      <span style={{ fontSize: 12, color: '#1a3cef' }}>{stage}</span>
      {progress !== undefined && (
        <div style={{ width: 80, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2 }}>
          <div style={{ width: `${progress}%`, height: '100%', background: '#1a3cef', borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
}
