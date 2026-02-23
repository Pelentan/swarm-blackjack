import React from 'react';
import { useGameState } from './hooks/useGameState';
import { GameTable } from './components/GameTable';
import { ObservabilityPanel } from './components/ObservabilityPanel';

function App() {
  const { gameState, connected, error, sendAction } = useGameState();

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d1117',
      color: '#e6edf3',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      maxWidth: 900,
      margin: '0 auto',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: connected ? '#38a169' : '#e53e3e',
            boxShadow: connected ? '0 0 8px #38a169' : undefined,
          }} />
          <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>
            {connected ? 'Connected via SSE' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: '#fc8181',
          color: '#1a202c',
          padding: '8px 16px',
          borderRadius: 6,
          fontSize: '0.8rem',
          fontWeight: 600,
        }}>
          {error}
        </div>
      )}

      {/* Game table */}
      {gameState ? (
        <GameTable
          gameState={gameState}
          onAction={sendAction}
        />
      ) : (
        <div style={{
          background: 'radial-gradient(ellipse at center, #1a4731 0%, #0d2818 100%)',
          borderRadius: 24,
          padding: 48,
          textAlign: 'center',
          border: '3px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: '#68d391', fontSize: '1.5rem', marginBottom: 8 }}>⟳</div>
          <div style={{ color: '#a0aec0' }}>Connecting to game state service...</div>
        </div>
      )}

      {/* Service attribution */}
      {gameState && (
        <div style={{
          display: 'flex',
          gap: 16,
          fontSize: '0.65rem',
          color: '#4a5568',
          fontFamily: 'monospace',
          flexWrap: 'wrap',
        }}>
          <span>Table: {gameState.tableId.slice(0, 8)}...</span>
          <span>Phase: {gameState.phase}</span>
          <span>Handled by: <strong style={{ color: '#38a169' }}>{gameState.handledBy}</strong></span>
          <span>Updated: {new Date(gameState.timestamp).toLocaleTimeString()}</span>
        </div>
      )}

      {/* Observability panel — embedded in UI, not a separate port */}
      <ObservabilityPanel />

      {/* Stack legend */}
      <div style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        background: '#161b22',
        borderRadius: 8,
        border: '1px solid #21262d',
      }}>
        {[
          { name: 'Gateway', lang: 'Go', color: '#4a9eff' },
          { name: 'Game State', lang: 'Go', color: '#38a169' },
          { name: 'Deck', lang: 'Go', color: '#d69e2e' },
          { name: 'Hand Eval', lang: 'Haskell', color: '#a855f7' },
          { name: 'Dealer AI', lang: 'Python', color: '#84cc16' },
          { name: 'Bank', lang: 'Java', color: '#ef4444' },
          { name: 'Auth', lang: 'TypeScript', color: '#0ea5e9' },
          { name: 'Chat', lang: 'Elixir', color: '#e879f9' },
        ].map(({ name, lang, color }) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ fontSize: '0.65rem', color: '#8b949e' }}>{name}</span>
            <span style={{ fontSize: '0.6rem', color: '#4a5568' }}>({lang})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
