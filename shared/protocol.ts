export type Suit = 's' | 'h' | 'd' | 'c';

export interface Card {
  /** 2..14, 14 = Ace */
  r: number;
  s: Suit;
}

export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export const SEAT_COUNT = 9;
export const CHARACTER_COUNT = 9;
export const TURN_MS = 30_000;
export const SHOWDOWN_MS = 6_500;
export const START_DELAY_MS = 2_500;

export const BLIND_LEVELS = [
  { sb: 5, bb: 10, buyIn: 1_000 },
  { sb: 10, bb: 20, buyIn: 2_000 },
  { sb: 25, bb: 50, buyIn: 5_000 },
  { sb: 50, bb: 100, buyIn: 10_000 },
] as const;

export interface LegalActions {
  canCheck: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  shortAllInOnly: boolean;
}

export interface SeatView {
  id: string;
  name: string;
  seat: number;
  stack: number;
  bet: number;
  committed: number;
  folded: boolean;
  allin: boolean;
  connected: boolean;
  waiting: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  hole: Card[] | null;
  holeCount: number;
  isYou: boolean;
  isBot: boolean;
  character: number;
  won: number;
}

export interface PotResult {
  amount: number;
  winners: {
    id: string;
    name: string;
    amount: number;
    handName: string;
  }[];
}

export interface HandResult {
  showdown: boolean;
  pots: PotResult[];
}

export interface LogEntry {
  id: number;
  text: string;
  tone: 'info' | 'action' | 'win' | 'system';
}

export interface GameState {
  code: string;
  hostId: string;
  sb: number;
  bb: number;
  buyIn: number;
  seats: (SeatView | null)[];
  dealerSeat: number;
  street: Street;
  community: Card[];
  pot: number;
  currentBet: number;
  toAct: string | null;
  toActName: string | null;
  turnDeadline: number | null;
  turnMs: number;
  handId: number;
  nextHandAt: number | null;
  startAt: number | null;
  result: HandResult | null;
  revealed: Record<string, { cards: Card[]; handName: string }>;
  legal: LegalActions | null;
  youId: string;
  handInProgress: boolean;
  readyCount: number;
  log: LogEntry[];
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  at: number;
}

export interface JoinResponse {
  ok: boolean;
  error?: string;
  token?: string;
  code?: string;
  state?: GameState;
}

export interface ActionResponse {
  ok: boolean;
  error?: string;
}

export interface ServerInfo {
  lanUrls: string[];
  port: number;
}

export interface ClientToServerEvents {
  createRoom: (
    payload: { name: string; sb: number; bb: number; bots?: number },
    ack: (res: JoinResponse) => void,
  ) => void;
  joinRoom: (payload: { code: string; name: string }, ack: (res: JoinResponse) => void) => void;
  resume: (payload: { code: string; token: string }, ack: (res: JoinResponse) => void) => void;
  action: (payload: { type: ActionType; amount?: number }, ack: (res: ActionResponse) => void) => void;
  rebuy: (ack: (res: ActionResponse) => void) => void;
  leaveRoom: (ack: (res: ActionResponse) => void) => void;
  chat: (payload: { text: string }) => void;
}

export interface ServerToClientEvents {
  state: (state: GameState) => void;
  chat: (msg: ChatMessage) => void;
  toast: (payload: { kind: 'error' | 'info'; text: string }) => void;
}
