import React, { useState, useEffect } from 'react';
import { useGameState } from './hooks/useGameState';
import { GameTable } from './components/GameTable';
import { ObservabilityPanel } from './components/ObservabilityPanel';
import { AuthModal } from './components/AuthModal';
import { EnrollmentModal } from './components/EnrollmentModal';

const SESSION_KEY = 'swarm_session';

interface Session {
  accessToken: string;
  playerId:    string;
  playerName:  string;
  email:       string;
  expiresAt:   number; // epoch ms
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s: Session = JSON.parse(raw);
    if (Date.now() > s.expiresAt) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}

function saveSession(data: {
  accessToken: string; expiresIn: number;
  playerId: string; playerName: string; email: string;
}): Session {
  const session: Session = {
    accessToken: data.accessToken,
    playerId:    data.playerId,
    playerName:  data.playerName,
    email:       data.email,
    expiresAt:   Date.now() + data.expiresIn * 1000,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

interface EnrollmentPending {
  bootstrapToken: string;
  playerId:       string;
  playerName:     string;
  email:          string;
}

function App() {
  const { gameState, connected, error, sendAction } = useGameState();
  const [session, setSession]               = useState<Session | null>(loadSession);
  const [showModal, setShowModal]           = useState(false);
  const [enrollment, setEnrollment]         = useState<EnrollmentPending | null>(null);

  // Handle email verification redirect: /?exchange={code}
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('exchange');
    if (!code) return;
    // Clean URL immediately — refresh should not re-attempt exchange
    window.history.replaceState({}, '', window.location.pathname);
    fetch('/api/auth/exchange', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    })
      .then(r => r.json())
      .then((data: any) => {
        if (data.requiresEnrollment && data.bootstrapToken) {
          // Bootstrap token — hold in memory, show mandatory enrollment modal
          setEnrollment({
            bootstrapToken: data.bootstrapToken,
            playerId:       data.playerId,
            playerName:     data.playerName,
            email:          data.email,
          });
        } else if (data.accessToken) {
          // Legacy path (shouldn't happen with current server, but safe fallback)
          setSession(saveSession(data));
        }
      })
      .catch(e => console.error('[auth] exchange failed:', e));
  }, []);

  useEffect(() => {
    if (!session) return;
    const ms = session.expiresAt - Date.now();
    if (ms <= 0) { setSession(null); return; }
    const t = setTimeout(() => setSession(null), ms);
    return () => clearTimeout(t);
  }, [session]);

  const handleDevReset = async () => {
    if (!window.confirm('DEV RESET: wipe all players, sessions, and balances?')) return;
    try {
      const res = await fetch('/dev/reset', { method: 'POST' });
      const data = await res.json();
      console.log('[dev] reset result:', data);
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
      setEnrollment(null);
      const resultLines = Object.entries(data.results ?? {})
        .map(([svc, status]) => `  ${svc}: ${status}`)
        .join('\n');
      alert(`Reset complete:\n${resultLines}`);
    } catch (e) {
      console.error('[dev] reset failed:', e);
      alert('Reset failed — check console');
    }
  };


  const handleAuthSuccess = (result: {
    accessToken: string; expiresIn: number;
    playerId: string; playerName: string; email: string;
  }) => {
    setSession(saveSession(result));
    setShowModal(false);
  };

  const handleSignOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', color: '#e6edf3',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '16px', display: 'flex', flexDirection: 'column',
      gap: 16, maxWidth: 900, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#58a6ff', letterSpacing: 2, textTransform: 'uppercase' }}>
            Swarm Blackjack
          </h1>
          <div style={{ fontSize: '0.65rem', color: '#8b949e', letterSpacing: 1 }}>
            Polyglot Microservices · Zero Trust · PoC
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#38a169' : '#e53e3e',
              boxShadow: connected ? '0 0 8px #38a169' : undefined,
            }} />
            <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>
              {connected ? 'Connected via SSE' : 'Connecting...'}
            </span>
          </div>

          {/* DEV ONLY */}
          <button onClick={handleDevReset} title="DEV: wipe all accounts" style={{
            padding: '5px 10px', background: 'none',
            border: '1px solid #4a1515', borderRadius: 6,
            color: '#6b2929', fontSize: '0.68rem', cursor: 'pointer',
          }}>
            ⚠ Reset DB
          </button>

          {session ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 600 }}>{session.playerName}</div>
                <div style={{ fontSize: '0.65rem', color: '#8b949e' }}>{session.email}</div>
              </div>
              <button onClick={handleSignOut} style={{
                padding: '5px 12px', background: 'none',
                border: '1px solid #30363d', borderRadius: 6,
                color: '#8b949e', fontSize: '0.72rem', cursor: 'pointer',
              }}>
                Sign out
              </button>
            </div>
          ) : (
            <button onClick={() => setShowModal(true)} style={{
              padding: '7px 16px', background: '#1f6feb22',
              border: '1px solid #1f6feb', borderRadius: 8,
              color: '#58a6ff', fontWeight: 600, fontSize: '0.8rem',
              cursor: 'pointer', letterSpacing: 0.5,
            }}>
              Login / Register
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: '#fc8181', color: '#1a202c',
          padding: '8px 16px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600,
        }}>
          {error}
        </div>
      )}

      {gameState ? (
        <GameTable gameState={gameState} onAction={sendAction} myPlayerId={session?.playerId} />
      ) : (
        <div style={{
          background: 'radial-gradient(ellipse at center, #1a4731 0%, #0d2818 100%)',
          borderRadius: 24, padding: 48, textAlign: 'center',
          border: '3px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: '#68d391', fontSize: '1.5rem', marginBottom: 8 }}>⟳</div>
          <div style={{ color: '#a0aec0' }}>Connecting to game state service...</div>
        </div>
      )}

      {gameState && (
        <div style={{ display: 'flex', gap: 16, fontSize: '0.65rem', color: '#4a5568', fontFamily: 'monospace', flexWrap: 'wrap' }}>
          <span>Table: {gameState.tableId.slice(0, 8)}...</span>
          <span>Phase: {gameState.phase}</span>
          <span>Handled by: <strong style={{ color: '#38a169' }}>{gameState.handledBy}</strong></span>
          <span>Updated: {new Date(gameState.timestamp).toLocaleTimeString()}</span>
          {session && <span style={{ color: '#58a6ff' }}>Authenticated: {session.playerName}</span>}
        </div>
      )}

      <ObservabilityPanel />

      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap',
        padding: '8px 12px', background: '#161b22',
        borderRadius: 8, border: '1px solid #21262d',
      }}>
        {[
          { name: 'Gateway',    lang: 'Go',         color: '#4a9eff' },
          { name: 'Game State', lang: 'Go',         color: '#38a169' },
          { name: 'Deck',       lang: 'Go',         color: '#d69e2e' },
          { name: 'Hand Eval',  lang: 'Haskell',    color: '#a855f7' },
          { name: 'Dealer AI',  lang: 'Python',     color: '#84cc16' },
          { name: 'Bank',       lang: 'Java',       color: '#ef4444' },
          { name: 'Auth',       lang: 'TypeScript', color: '#0ea5e9' },
          { name: 'Auth UI',    lang: 'Go',         color: '#06b6d4' },
          { name: 'Chat',       lang: 'Elixir',     color: '#e879f9' },
        ].map(({ name, lang, color }) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ fontSize: '0.65rem', color: '#8b949e' }}>{name}</span>
            <span style={{ fontSize: '0.6rem', color: '#4a5568' }}>({lang})</span>
          </div>
        ))}
      </div>

      {showModal && (
        <AuthModal onSuccess={handleAuthSuccess} onClose={() => setShowModal(false)} />
      )}

      {enrollment && (
        <EnrollmentModal
          bootstrapToken={enrollment.bootstrapToken}
          playerId={enrollment.playerId}
          playerName={enrollment.playerName}
          email={enrollment.email}
          onSuccess={(result) => {
            setEnrollment(null);
            setSession(saveSession(result));
          }}
        />
      )}
    </div>
  );
}

export default App;
