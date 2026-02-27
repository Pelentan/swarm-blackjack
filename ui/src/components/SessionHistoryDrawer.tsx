import React, { useState } from 'react';
import { RoundSnapshot, PlayerState } from '../types';
import { CardComponent } from './Card';

interface Props {
  rounds: RoundSnapshot[];
  isDemo?: boolean;
}

function winnerBorder(status: PlayerState['status']): React.CSSProperties {
  if (status === 'won' || status === 'blackjack') return {
    border: '2px solid #38a169',
    boxShadow: '0 0 8px rgba(56,161,105,0.45)',
    borderRadius: 8,
    padding: '4px 6px',
    background: 'rgba(56,161,105,0.07)',
  };
  if (status === 'push') return {
    border: '2px solid #f59e0b',
    borderRadius: 8,
    padding: '4px 6px',
    background: 'rgba(245,158,11,0.06)',
  };
  // lost / bust / standing — dimmed
  return {
    border: '2px solid transparent',
    borderRadius: 8,
    padding: '4px 6px',
    opacity: 0.45,
  };
}

function statusBadge(status: PlayerState['status']): React.ReactNode {
  const map: Record<string, [string, string]> = {
    won:       ['WON',  '#38a169'],
    blackjack: ['BJ',   '#ecc94b'],
    push:      ['PUSH', '#f59e0b'],
    lost:      ['LOST', '#fc8181'],
    bust:      ['BUST', '#fc8181'],
  };
  const entry = map[status];
  if (!entry) return null;
  return (
    <span style={{
      fontSize: '0.55rem', fontWeight: 700, color: entry[1],
      letterSpacing: 0.5, marginLeft: 4,
    }}>
      {entry[0]}
    </span>
  );
}

function HandGroup({ label, cards, status, isDealer }: {
  label: string;
  cards: RoundSnapshot['dealer']['hand'];
  status?: PlayerState['status'];
  isDealer?: boolean;
  key?: string;
}) {
  const containerStyle: React.CSSProperties = isDealer
    ? { border: '2px solid transparent', borderRadius: 8, padding: '4px 6px' }
    : (status ? winnerBorder(status) : {});

  return (
    <div style={containerStyle}>
      <div style={{
        fontSize: '0.6rem', color: '#8b949e', fontWeight: 600,
        marginBottom: 3, letterSpacing: 0.5, display: 'flex', alignItems: 'center',
      }}>
        {label}
        {status && statusBadge(status)}
      </div>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {cards.map((card, i) => (
          <CardComponent key={i} card={card} size="xs" />
        ))}
      </div>
    </div>
  );
}

function RoundRow({ round, index }: { round: RoundSnapshot; index: number; key?: string }) {
  const time = new Date(round.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const roundNum = index + 1;

  return (
    <div style={{
      borderBottom: '1px solid #21262d',
      padding: '10px 12px',
    }}>
      <div style={{
        fontSize: '0.6rem', color: '#4a5568', marginBottom: 6,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span style={{ fontWeight: 600, color: '#8b949e' }}>Round {roundNum}</span>
        <span>{time}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Dealer */}
        <HandGroup
          label="Dealer"
          cards={round.dealer.hand}
          isDealer
        />

        {/* Divider */}
        <div style={{
          width: 1, background: '#21262d', alignSelf: 'stretch', margin: '0 2px',
        }} />

        {/* Players */}
        {round.players
          .filter(p => p.hand && p.hand.length > 0)
          .map(player => (
            <HandGroup
              key={player.id}
              label={player.name}
              cards={player.hand}
              status={player.status}
            />
          ))}
      </div>
    </div>
  );
}

export function SessionHistoryDrawer({ rounds, isDemo }: Props) {
  const [open, setOpen] = useState(false);
  const DRAWER_WIDTH = 340;

  return (
    <>
      {/* Persistent tab — always visible on right edge */}
      <div
        onClick={() => setOpen(o => !o)}
        title={open ? 'Close session history' : 'View session history'}
        style={{
          position: 'fixed',
          right: open ? DRAWER_WIDTH : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1200,
          cursor: 'pointer',
          transition: 'right 0.3s ease',
          // Tab shape — extends left from right edge
          background: '#1a2535',
          border: '1px solid #1f6feb',
          borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          padding: '16px 10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          boxShadow: '-4px 0 16px rgba(31,111,235,0.25)',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '1rem' }}>🃏</span>
        <span style={{
          fontSize: '0.6rem',
          color: '#8b949e',
          fontWeight: 700,
          letterSpacing: 1.5,
          writingMode: 'vertical-rl',
          textTransform: 'uppercase',
        }}>
          History
        </span>
        {rounds.length > 0 && (
          <span style={{
            background: '#1f6feb',
            color: '#fff',
            fontSize: '0.6rem',
            fontWeight: 700,
            borderRadius: '50%',
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {rounds.length}
          </span>
        )}
      </div>

      {/* Drawer panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: DRAWER_WIDTH,
        height: '100vh',
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRight: 'none',
        zIndex: 1100,
        transform: open ? 'translateX(0)' : `translateX(${DRAWER_WIDTH}px)`,
        transition: 'transform 0.3s ease',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid #21262d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e6edf3' }}>
                Session History
              </div>
              {isDemo && (
                <span style={{
                  fontSize: '0.6rem', fontWeight: 700, color: '#f59e0b',
                  background: '#f59e0b15', border: '1px solid #f59e0b44',
                  borderRadius: 4, padding: '2px 6px', letterSpacing: 1,
                }}>DEMO</span>
              )}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#8b949e', marginTop: 2 }}>
              {rounds.length === 0
                ? 'Watching demo game...'
                : `${rounds.length} round${rounds.length === 1 ? '' : 's'} captured`}
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#8b949e', fontSize: '1.1rem', lineHeight: 1, padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Rounds list — most recent first */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rounds.length === 0 ? (
            <div style={{
              padding: 24, textAlign: 'center',
              color: '#4a5568', fontSize: '0.75rem',
            }}>
              Rounds will appear here as you play.
            </div>
          ) : (
            rounds.map((round, i) => (
              <RoundRow key={round.id} round={round} index={rounds.length - 1 - i} />
            ))
          )}
        </div>
      </div>

      {/* Backdrop — only when open */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 1099,
          }}
        />
      )}
    </>
  );
}
