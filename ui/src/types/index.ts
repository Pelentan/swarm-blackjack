// Types derived from OpenAPI contracts — these ARE the contracts for the UI

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'hidden';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'hidden';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type PlayerStatus =
  | 'waiting' | 'betting' | 'playing' | 'standing'
  | 'bust' | 'blackjack' | 'won' | 'lost' | 'push';

export interface PlayerState {
  id: string;
  name: string;
  chips: number;
  currentBet: number;
  hand: Card[];
  handValue: number;
  isSoftHand: boolean;
  status: PlayerStatus;
}

export interface DealerState {
  hand: Card[];
  handValue: number;
  isRevealed: boolean;
}

export type GamePhase =
  | 'waiting' | 'betting' | 'dealing'
  | 'player_turn' | 'dealer_turn' | 'payout' | 'complete';

export interface GameState {
  tableId: string;
  phase: GamePhase;
  players: PlayerState[];
  dealer: DealerState;
  activePlayerId: string | null;
  minBet: number;
  maxBet: number;
  handledBy: string;  // container hostname — shown in observability
  timestamp: string;
}

export interface SSEGameEvent {
  type: 'game_state' | 'phase_change' | 'player_joined' | 'player_left' | 'error';
  data: GameState;
}

export type PlayerAction = 'bet' | 'hit' | 'stand' | 'double' | 'split' | 'insurance';

export interface ObservabilityEvent {
  id: string;
  timestamp: string;
  caller: string;
  callee: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  protocol: 'http' | 'https' | 'sse' | 'websocket' | 'mtls';
}
