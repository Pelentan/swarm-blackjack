import { useState, useEffect, useCallback } from 'react';
import { GameState, SSEGameEvent, PlayerAction } from '../types';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080';
const DEMO_TABLE_ID = 'demo-table-00000000-0000-0000-0000-000000000001';

interface UseGameStateReturn {
  gameState: GameState | null;
  connected: boolean;
  error: string | null;
  sendAction: (action: PlayerAction, amount?: number) => Promise<void>;
}

export function useGameState(tableId: string = DEMO_TABLE_ID): UseGameStateReturn {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${GATEWAY_URL}/api/game/${tableId}/stream`;
    console.log(`[useGameState] Connecting to SSE: ${url}`);

    const es = new EventSource(url);

    es.onopen = () => {
      console.log('[useGameState] SSE connected');
      setConnected(true);
      setError(null);
    };

    es.addEventListener('game_state', (evt: MessageEvent) => {
      try {
        const event: SSEGameEvent = JSON.parse(evt.data);
        setGameState(event.data);
      } catch (e) {
        console.error('[useGameState] Failed to parse game state:', e);
      }
    });

    es.onerror = (evt) => {
      console.error('[useGameState] SSE error:', evt);
      setConnected(false);
      setError('Connection lost — reconnecting...');
      // EventSource auto-reconnects
    };

    return () => {
      console.log('[useGameState] Closing SSE connection');
      es.close();
      setConnected(false);
    };
  }, [tableId]);

  const sendAction = useCallback(async (action: PlayerAction, amount?: number) => {
    const playerId = 'stub-player-00000000-0000-0000-0000-000000000001';
    try {
      const response = await fetch(`${GATEWAY_URL}/api/game/${tableId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, action, amount }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Action failed');
      }
    } catch (e) {
      console.error('[useGameState] Action error:', e);
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }, [tableId]);

  return { gameState, connected, error, sendAction };
}
