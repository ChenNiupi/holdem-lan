import type { ActionType, Card, GameState, LegalActions, SeatView } from '../../../shared/protocol';
import { newDeck } from './cards';
import { bestHand, compareScores } from './evaluator';

export interface BotProfile {
  aggression: number;
  bluff: number;
  tightness: number;
}

export interface BotDecision {
  type: ActionType;
  amount?: number;
}

const BOT_NAMES = ['阿尔法', '贝塔', '伽马', '德尔塔', '艾普西隆', '泽塔', '伊塔', '西塔'];

const PROFILES: BotProfile[] = [
  { aggression: 1.18, bluff: 0.14, tightness: 0.02 },
  { aggression: 0.86, bluff: 0.04, tightness: 0.13 },
  { aggression: 1.0, bluff: 0.09, tightness: 0.06 },
  { aggression: 1.3, bluff: 0.18, tightness: 0.0 },
  { aggression: 0.94, bluff: 0.07, tightness: 0.1 },
  { aggression: 1.06, bluff: 0.11, tightness: 0.05 },
  { aggression: 0.8, bluff: 0.03, tightness: 0.16 },
  { aggression: 1.22, bluff: 0.15, tightness: 0.01 },
];

export function botName(index: number): string {
  return `AI·${BOT_NAMES[index % BOT_NAMES.length]}`;
}

export function makeBotProfile(index: number): BotProfile {
  return { ...PROFILES[index % PROFILES.length] };
}

/** All decisions are based on the public state visible to the bot plus its own hole cards. */
export function decideBotAction(state: GameState, profile: BotProfile): BotDecision {
  const legal = state.legal;
  const me = state.seats.find((seat): seat is SeatView => Boolean(seat?.isYou));
  if (!legal || !me?.hole || me.hole.length !== 2) {
    return { type: 'fold' };
  }

  const opponents = Math.max(
    1,
    state.seats.filter((seat) => seat && !seat.isYou && !seat.folded && seat.holeCount > 0).length,
  );

  if (state.street === 'preflop') {
    return preflop(state, me, opponents, legal, profile);
  }
  return postflop(state, me, opponents, legal, profile);
}

function makeRaise(legal: LegalActions, target: number): BotDecision {
  const amount = Math.max(legal.minRaiseTo, Math.min(Math.round(target), legal.maxRaiseTo));
  if (amount >= legal.maxRaiseTo) return { type: 'allin' };
  return { type: 'raise', amount };
}

function chenScore(hole: Card[]): number {
  const [hi, lo] = [...hole].sort((a, b) => b.r - a.r);
  const highValue =
    hi.r === 14 ? 10 : hi.r === 13 ? 8 : hi.r === 12 ? 7 : hi.r === 11 ? 6 : hi.r / 2;
  let score = highValue;

  if (hi.r === lo.r) {
    score = Math.max(5, highValue * 2);
    return score;
  }

  if (hi.s === lo.s) score += 2;
  const gap = hi.r - lo.r - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;
  if (gap <= 1 && hi.r < 12) score += 1;
  return score;
}

function preflop(
  state: GameState,
  me: SeatView,
  opponents: number,
  legal: LegalActions,
  profile: BotProfile,
): BotDecision {
  const strength = chenScore(me.hole!);
  const tight = profile.tightness;
  const openBar = 7 + (opponents - 1) * 0.9 + tight * 5 - (profile.aggression - 1) * 2;
  const callBar = 5.2 + (opponents - 1) * 0.55 + tight * 4 - (profile.aggression - 1) * 1.5;
  const toCall = legal.callAmount;

  // No bet to call (big blind option or everyone limped to us).
  if (toCall === 0) {
    if (
      legal.canRaise &&
      strength >= openBar &&
      Math.random() < 0.45 + profile.aggression * 0.25
    ) {
      const target = state.bb * (3 + Math.random() * 1.2);
      return makeRaise(legal, Math.max(state.bb * 2, target));
    }
    return { type: 'check' };
  }

  const allInCall = toCall >= me.stack;
  if (allInCall) {
    const strong = strength >= 11.5 || (strength >= 9 && toCall <= me.stack * 0.5);
    if (strong && Math.random() > profile.tightness * 0.5) return { type: 'call' };
    if (Math.random() < profile.bluff * 0.35) return { type: 'call' };
    return { type: 'fold' };
  }

  const raised = state.currentBet > state.bb;

  if (raised) {
    if (
      strength >= 11.5 &&
      legal.canRaise &&
      state.currentBet < me.stack * 0.6 &&
      Math.random() < 0.45 + profile.aggression * 0.2
    ) {
      return makeRaise(legal, state.currentBet * (2.2 + Math.random() * 0.6));
    }
    if (strength >= 10) return { type: 'call' };
    if (strength >= callBar && toCall <= me.stack * 0.12) return { type: 'call' };
    if (strength >= 8 && toCall <= state.bb * 4) return { type: 'call' };
    return { type: 'fold' };
  }

  if (strength >= openBar && legal.canRaise) {
    return makeRaise(legal, state.bb * (3 + Math.random() * 1.2));
  }
  if (strength >= callBar) return { type: 'call' };
  if (Math.random() < profile.bluff * 0.5 && toCall <= state.bb * 1.5) return { type: 'call' };
  return { type: 'fold' };
}

function postflop(
  state: GameState,
  me: SeatView,
  opponents: number,
  legal: LegalActions,
  profile: BotProfile,
): BotDecision {
  const hole = me.hole!;
  const sims = opponents >= 3 ? 110 : 170;
  const equity = estimateEquity(hole, state.community, opponents, sims);
  const toCall = legal.callAmount;
  const pot = Math.max(state.pot, state.currentBet + state.bb);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  if (toCall === 0) {
    const value = equity > 0.66 + opponents * 0.015;
    const semiBluff = equity > 0.34 && Math.random() < profile.bluff * 0.85;

    if (legal.canRaise && (value || semiBluff)) {
      if (value && Math.random() < 0.16) return { type: 'check' };
      const size = pot * (0.45 + Math.random() * 0.35) * (value ? 1 : 0.75);
      const target = size;
      if (target >= legal.maxRaiseTo && equity < 0.75) return { type: 'check' };
      return makeRaise(legal, target);
    }
    return { type: 'check' };
  }

  const allInCall = toCall >= me.stack;
  if (allInCall) {
    if (equity > potOdds + 0.08) return { type: 'call' };
    if (equity > 0.82 && Math.random() < 0.6) return { type: 'call' };
    return { type: 'fold' };
  }

  if (
    legal.canRaise &&
    equity > 0.8 &&
    Math.random() < 0.5 + profile.aggression * 0.15
  ) {
    const target = state.currentBet + (pot + toCall) * (0.65 + Math.random() * 0.35);
    if (target >= legal.maxRaiseTo && equity < 0.88) {
      return { type: 'call' };
    }
    return makeRaise(legal, target);
  }

  if (equity > potOdds + 0.07) {
    if (
      legal.canRaise &&
      equity > 0.62 &&
      Math.random() < 0.12 * profile.aggression
    ) {
      return makeRaise(legal, state.currentBet + (pot + toCall) * 0.55);
    }
    return { type: 'call' };
  }

  if (equity > potOdds - 0.02 && Math.random() < 0.4) return { type: 'call' };

  if (
    legal.canRaise &&
    equity < 0.3 &&
    Math.random() < profile.bluff * 0.35
  ) {
    const target = state.currentBet + Math.max(state.bb * 2, pot * 0.5);
    if (target < legal.maxRaiseTo) return makeRaise(legal, target);
  }

  return { type: 'fold' };
}

const SUIT_INDEX: Record<Card['s'], number> = { s: 0, h: 1, d: 2, c: 3 };

function cardKey(card: Card): number {
  return card.r * 4 + SUIT_INDEX[card.s];
}

/** Win probability against N random hands, using only cards the bot is allowed to know. */
export function estimateEquity(
  hole: Card[],
  board: Card[],
  opponents: number,
  simulations: number,
): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board].map(cardKey));
  const baseDeck = newDeck().filter((card) => !known.has(cardKey(card)));
  const boardNeed = 5 - board.length;
  const need = opponents * 2 + boardNeed;
  if (need > baseDeck.length) return 0;

  let score = 0;
  for (let sim = 0; sim < simulations; sim++) {
    const pool = baseDeck.slice();
    for (let k = 0; k < need; k++) {
      const j = k + Math.floor(Math.random() * (pool.length - k));
      const tmp = pool[k];
      pool[k] = pool[j];
      pool[j] = tmp;
    }

    let idx = 0;
    const fullBoard = board.slice();
    for (let b = 0; b < boardNeed; b++) fullBoard.push(pool[idx++]);

    const myScore = bestHand([...hole, ...fullBoard]).score;
    let won = true;
    let tied = false;

    for (let o = 0; o < opponents; o++) {
      const oppHole = [pool[idx++], pool[idx++]];
      const cmp = compareScores(bestHand([...oppHole, ...fullBoard]).score, myScore);
      if (cmp > 0) {
        won = false;
        break;
      }
      if (cmp === 0) tied = true;
    }

    if (won) score += tied ? 0.5 : 1;
  }

  return score / simulations;
}
