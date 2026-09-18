import { useState } from 'react';

export default function LoginScene({ onLogin }) {
  const [agentId, setAgentId] = useState('');
  const [password, setPassword] = useState('');

  function handleLogin() {
    onLogin({ claimId: agentId || 'CLM-2024-8821', adjuster: agentId || 'Agent Rivera', ocrFields: {} });
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="fade-up" style={{
        position: 'relative', zIndex: 10,
        background: 'rgba(93,93,93,0.80)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 28,
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 12px 60px rgba(0,0,0,0.5)',
        padding: 10,
        width: 'min(420px, calc(100vw - 24px))',
        boxSizing: 'border-box',
      }}>
        {/* Purple inner card */}
        <div style={{
          background: 'linear-gradient(155deg, #9095c8 0%, #7e86be 100%)',
          borderRadius: 20,
          padding: '32px 28px 28px',
        }}>
          <div style={{ textAlign: 'center', fontSize: 30, fontWeight: 800, color: '#1a3ecf', letterSpacing: '-0.02em', marginBottom: 32 }}>
            LUMEN
          </div>
          <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(20,20,50,0.80)', display: 'block', marginBottom: 6 }}>
            Agent ID<span style={{ color: '#cc2222' }}>*</span>
          </label>
          <input
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            placeholder="agentRivera"
            style={{ width: '100%', padding: '11px 14px', background: 'rgba(245,246,252,0.97)', borderRadius: 10, fontSize: 14, color: '#1a1a2e', marginBottom: 16, display: 'block', boxSizing: 'border-box' }}
          />
          <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(20,20,50,0.80)', display: 'block', marginBottom: 6 }}>
            Password<span style={{ color: '#cc2222' }}>*</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="********"
            style={{ width: '100%', padding: '11px 14px', background: 'rgba(245,246,252,0.97)', borderRadius: 10, fontSize: 14, color: '#1a1a2e', display: 'block', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ padding: '14px 14px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button style={{ background: 'rgba(255,255,255,0.10)', color: 'white', fontSize: 13, fontWeight: 500, padding: '7px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)' }}>
              Forgot Password?
            </button>
          </div>
          <button onClick={handleLogin} style={{ width: '100%', padding: '14px', background: '#1a3ecf', border: 'none', borderRadius: 12, color: 'white', fontSize: 16, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.01em' }}>
            Login
          </button>
          <div style={{ width: 48, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.22)', margin: '14px auto 4px' }} />
        </div>
      </div>
    </div>
  );
}
