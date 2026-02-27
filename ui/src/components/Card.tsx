import React from 'react';
import { Card as CardType } from '../types';

interface CardProps {
  card: CardType;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
  hidden: '?',
};

const SUIT_COLORS: Record<string, string> = {
  hearts: '#e53e3e',
  diamonds: '#e53e3e',
  clubs: '#1a202c',
  spades: '#1a202c',
  hidden: '#4a5568',
};

export const CardComponent: React.FC<CardProps> = ({ card, size = 'md' }) => {
  const isHidden = card.suit === 'hidden' || card.rank === 'hidden';
  const symbol = SUIT_SYMBOLS[card.suit] || '?';
  const color = SUIT_COLORS[card.suit] || '#4a5568';

  const sizes = {
    xs: { width: 30, height: 42, rankSize: 0.55, suitSize: '0.7rem' },
    sm: { width: 48, height: 68, rankSize: 0.75, suitSize: '1.2rem' },
    md: { width: 64, height: 90, rankSize: 1, suitSize: '1.6rem' },
    lg: { width: 80, height: 112, rankSize: 1.2, suitSize: '2rem' },
  };

  const s = sizes[size];

  if (isHidden) {
    return (
      <div style={{
        width: s.width,
        height: s.height,
        borderRadius: 8,
        background: 'linear-gradient(135deg, #2b4c7e 25%, #1a3150 75%)',
        border: '2px solid #4a7abd',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '2px 2px 8px rgba(0,0,0,0.4)',
      }}>
        <span style={{ fontSize: s.suitSize, color: '#4a7abd' }}>🂠</span>
      </div>
    );
  }

  return (
    <div style={{
      width: s.width,
      height: s.height,
      borderRadius: 8,
      background: 'white',
      border: '2px solid #e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      padding: '4px 6px',
      boxShadow: '2px 2px 8px rgba(0,0,0,0.3)',
      position: 'relative',
      userSelect: 'none',
    }}>
      <span style={{ fontSize: `${s.rankSize}rem`, fontWeight: 700, color, lineHeight: 1 }}>{card.rank}</span>
      <span style={{ fontSize: `${s.rankSize * 0.8}rem`, color, lineHeight: 1 }}>{symbol}</span>
      <span style={{
        position: 'absolute',
        bottom: 4,
        right: 6,
        fontSize: s.suitSize,
        color,
        transform: 'rotate(180deg)',
        lineHeight: 1,
      }}>{symbol}</span>
    </div>
  );
};
