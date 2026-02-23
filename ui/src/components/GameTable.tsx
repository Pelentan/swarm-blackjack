import React from 'react';
import { GameState, PlayerState, DealerState } from '../types';
import { CardComponent } from './Card';

interface GameTableProps {
  gameState: GameState;
  onAction: (action: string, amount?: number) => void;
  myPlayerId?: string;
}

const PHASE_LABELS: Record<string, string> = {
  waiting: 'Waiting for players...',
  betting: 'Place your bets',
  dealing: 'Dealing...',
  player_turn: "Player's turn",
  dealer_turn: "Dealer's turn",
  payout: 'Payouts',
  complete: 'Round complete',
};

const STATUS_COLORS: Record<string, string> = {
  waiting: '#718096',
  betting: '#d69e2e',
  playing: '#3182ce',
  standing: '#718096',
  bust: '#e53e3e',
  blackjack: '#d4af37',
  won: '#38a169',
  lost: '#e53e3e',
  push: '#718096',
};

const DealerView: React.FC<{ dealer: DealerState }> = ({ dealer }) => (
  <div style={{ textAlign: 'center', marginBottom: 24 }}>
    <div style={{ color: '#a0aec0', fontSize: '0.75rem', letterSpacing: 2, marginBottom: 8 }}>
      DEALER {dealer.isRevealed ? `— ${dealer.handValue}` : ''}
    </div>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {dealer.hand.map((card, i) => (
        <CardComponent key={i} card={card} size="md" />
      ))}
    </div>
  </div>
);

const PlayerView: React.FC<{ player: PlayerState; isActive: boolean; isMe: boolean }> = ({
  player, isActive, isMe
}) => (
  <div style={{
    background: isActive ? 'rgba(49, 130, 206, 0.15)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${isActive ? '#3182ce' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 12,
    padding: '16px 20px',
    minWidth: 180,
    transition: 'all 0.3s',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontWeight: 600, color: isMe ? '#63b3ed' : '#e2e8f0', fontSize: '0.9rem' }}>
        {player.name} {isMe ? '(you)' : ''}
      </span>
      <span style={{
        fontSize: '0.65rem',
        fontWeight: 700,
        color: STATUS_COLORS[player.status] || '#718096',
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}>
        {player.status}
      </span>
    </div>

    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {player.hand.map((card, i) => (
        <CardComponent key={i} card={card} size="sm" />
      ))}
    </div>

    {player.handValue > 0 && (
      <div style={{ fontSize: '0.8rem', color: '#a0aec0', marginBottom: 4 }}>
        Hand: <strong style={{ color: player.handValue > 21 ? '#fc8181' : '#e2e8f0' }}>
          {player.handValue}
        </strong>
        {player.isSoftHand && <span style={{ color: '#a0aec0' }}> (soft)</span>}
      </div>
    )}

    <div style={{ fontSize: '0.8rem', color: '#a0aec0' }}>
      Chips: <strong style={{ color: '#e2e8f0' }}>{player.chips}</strong>
      {player.currentBet > 0 && (
        <span> · Bet: <strong style={{ color: '#d69e2e' }}>{player.currentBet}</strong></span>
      )}
    </div>
  </div>
);

export const GameTable: React.FC<GameTableProps> = ({
  gameState,
  onAction,
  myPlayerId = 'stub-player-00000000-0000-0000-0000-000000000001',
}) => {
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  const isMyTurn = gameState.activePlayerId === myPlayerId;
  const phase = gameState.phase;

  return (
    <div style={{
      background: 'radial-gradient(ellipse at center, #1a4731 0%, #0d2818 100%)',
      borderRadius: 24,
      padding: '32px 24px',
      border: '3px solid rgba(255,255,255,0.1)',
      boxShadow: 'inset 0 0 60px rgba(0,0,0,0.5)',
      position: 'relative',
    }}>
      {/* Phase indicator */}
      <div style={{
        textAlign: 'center',
        marginBottom: 24,
        padding: '6px 16px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 20,
        display: 'inline-block',
        left: '50%',
        position: 'relative',
        transform: 'translateX(-50%)',
      }}>
        <span style={{ color: '#d69e2e', fontSize: '0.8rem', fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>
          {PHASE_LABELS[phase] || phase}
        </span>
      </div>

      {/* Service attribution - observability hook */}
      <div style={{
        position: 'absolute',
        top: 12,
        right: 16,
        fontSize: '0.6rem',
        color: 'rgba(255,255,255,0.3)',
        fontFamily: 'monospace',
      }}>
        {gameState.handledBy}
      </div>

      {/* Dealer area */}
      <DealerView dealer={gameState.dealer} />

      {/* Table felt divider */}
      <div style={{
        borderTop: '1px dashed rgba(255,255,255,0.15)',
        margin: '16px 0',
      }} />

      {/* Players */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
        {gameState.players.map(player => (
          <PlayerView
            key={player.id}
            player={player}
            isActive={gameState.activePlayerId === player.id}
            isMe={player.id === myPlayerId}
          />
        ))}
      </div>

      {/* Action buttons */}
      {isMyTurn && myPlayer?.status === 'playing' && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {[
            { label: 'Hit', action: 'hit', color: '#3182ce' },
            { label: 'Stand', action: 'stand', color: '#718096' },
            { label: 'Double', action: 'double', color: '#d69e2e' },
          ].map(({ label, action, color }) => (
            <button
              key={action}
              onClick={() => onAction(action)}
              style={{
                padding: '10px 24px',
                borderRadius: 8,
                border: `1px solid ${color}`,
                background: `${color}22`,
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.9rem',
                transition: 'all 0.2s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {phase === 'betting' && myPlayer?.status === 'betting' && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {[10, 25, 50, 100].map(amount => (
            <button
              key={amount}
              onClick={() => onAction('bet', amount)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #d69e2e',
                background: '#d69e2e22',
                color: '#d69e2e',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ${amount}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
