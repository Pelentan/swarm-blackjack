import { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, SSEGameEvent, PlayerAction, RoundSnapshot } from '../types';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || '';
export const DEMO_TABLE_ID = 'demo-table-00000000-0000-0000-0000-000000000001';
export const DEMO_PLAYER_ID = 'player-00000000-0000-0000-0000-000000000001';

interface UseGameStateConfig {
  tableId?: string;
  playerId?: string;
  token?: string;
}

interface UseGameStateReturn {
  gameState: GameState | null;
  connected: boolean;
  error: string | null;
  rounds: RoundSnapshot[];
  sendAction: (action: PlayerAction, amount?: number) => Promise<void>;
}

export function useGameState(config: UseGameStateConfig = {}): UseGameStateReturn {
  const tableId  = config.tableId  ?? DEMO_TABLE_ID;
  const playerId = config.playerId ?? DEMO_PLAYER_ID;
  const token    = config.token;

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [rounds, setRounds]       = useState<RoundSnapshot[]>([]);
  const lastPhaseRef              = useRef<string | null>(null);

  // Reset state when table switches
  useEffect(() => {
    setGameState(null);
    setConnected(false);
    lastPhaseRef.current = null;
  }, [tableId]);

  useEffect(() => {
    const url = `${GATEWAY_URL}/api/game/${tableId}/stream`;
    console.log(`[useGameState] Connecting to SSE: ${url}`);
    const es = new EventSource(url);

    es.onopen = () => { setConnected(true); setError(null); };

    es.addEventListener('game_state', (evt: MessageEvent) => {
      try {
        const event: SSEGameEvent = JSON.parse(evt.data);
        const gs = event.data;
        setGameState(gs);
        if (gs.phase === 'payout' && lastPhaseRef.current !== 'payout') {
          const snapshot: RoundSnapshot = {
            id:        `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: gs.timestamp,
            players:   gs.players,
            dealer:    gs.dealer,
          };
          setRounds(prev => [snapshot, ...prev].slice(0, 20));
        }
        lastPhaseRef.current = gs.phase;
      } catch (e) {
        console.error('[useGameState] Failed to parse game state:', e);
      }
    });

    es.onerror = () => { setConnected(false); setError('Connection lost — reconnecting...'); };

    return () => { es.close(); setConnected(false); };
  }, [tableId]);

  const sendAction = useCallback(async (action: PlayerAction, amount?: number) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const response = await fetch(`${GATEWAY_URL}/api/game/${tableId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ playerId, action, amount }),
      });
      if (!response.ok && response.status !== 202) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `Action failed: ${response.status}`);
      }
    } catch (e) {
      console.error('[useGameState] Action error:', e);
      setError(e instanceof Error ? e.message : 'Action failed');
      setTimeout(() => setError(null), 3000);
    }
  }, [tableId, playerId, token]);

  return { gameState, connected, error, rounds, sendAction };
}
