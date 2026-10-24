import { randomInt } from 'node:crypto';
import type {
  ActionType,
  Card,
  GameState,
  HandResult,
  LegalActions,
  LogEntry,
  PotResult,
  SeatView,
  Street,
} from '../../../shared/protocol';
import { SEAT_COUNT, CHARACTER_COUNT, SHOWDOWN_MS, START_DELAY_MS, TURN_MS } from '../../../shared/protocol';
import { cardText, newDeck, shuffle } from './cards';
import { bestHand, compareScores, type HandScore } from './evaluator';
import { botName, decideBotAction, makeBotProfile, type BotDecision, type BotProfile } from './bot';

interface Seat {
  id: string;
  name: string;
  stack: number;
  connected: boolean;
  inHand: boolean;
  hole: Card[];
  bet: number;
  committed: number;
  folded: boolean;
  allin: boolean;
  acted: boolean;
  raiseRights: boolean;
  won: number;
  isBot: boolean;
  botProfile?: BotProfile;
  character: number;
}

interface ActionResult {
  ok: boolean;
  error?: string;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export class Room {
  readonly code: string;
  readonly sb: number;
  readonly bb: number;
  readonly buyIn: number;
  hostId: string;

  seats: (Seat | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  dealerSeat = -1;
  sbSeat = -1;
  bbSeat = -1;

  private deck: Card[] = [];
  community: Card[] = [];
  street: Street = 'waiting';
  handId = 0;
  private currentBet = 0;
  private minRaise: number;
  private hasFullBet = false;
  private toActId: string | null = null;
  private turnDeadline: number | null = null;
  private nextHandAt: number | null = null;
  private startAt: number | null = null;
  private botActAt: number | null = null;
  private result: HandResult | null = null;
  private revealed: Record<string, { cards: Card[]; handName: string }> = {};
  private log: LogEntry[] = [];
  private logSeq = 0;

  onChange: () => void = () => {};

  constructor(code: string, hostId: string, sb: number, bb: number) {
    this.code = code;
    this.hostId = hostId;
    this.sb = sb;
    this.bb = bb;
    this.buyIn = bb * 100;
    this.minRaise = bb;
  }

  // ---------------------------------------------------------------- helpers

  private touch(): void {
    this.onChange();
  }

  private addLog(text: string, tone: LogEntry['tone'] = 'info'): void {
    this.log.push({ id: ++this.logSeq, text, tone });
    if (this.log.length > 80) this.log.splice(0, this.log.length - 80);
  }

  private seatEntries(): { index: number; seat: Seat }[] {
    const out: { index: number; seat: Seat }[] = [];
    this.seats.forEach((s, index) => {
      if (s) out.push({ index, seat: s });
    });
    return out;
  }

  private liveSeats(): Seat[] {
    return this.seatEntries()
      .filter((e) => e.seat.inHand && !e.seat.folded)
      .map((e) => e.seat);
  }

  private nextSeat(from: number, pred: (s: Seat) => boolean): number {
    for (let k = 1; k <= SEAT_COUNT; k++) {
      const i = (from + k + SEAT_COUNT) % SEAT_COUNT;
      const s = this.seats[i];
      if (s && pred(s)) return i;
    }
    return -1;
  }

  private byId(id: string): { index: number; seat: Seat } | null {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s && s.id === id) return { index: i, seat: s };
    }
    return null;
  }

  handInProgress(): boolean {
    return this.street === 'preflop' || this.street === 'flop' || this.street === 'turn' || this.street === 'river';
  }

  readyCount(): number {
    return this.seatEntries().filter((e) => e.seat.stack > 0 && e.seat.connected).length;
  }

  potTotal(): number {
    return this.seatEntries().reduce((sum, e) => sum + e.seat.committed, 0);
  }

  private pickCharacter(): number {
    const used = new Set(this.seatEntries().map((entry) => entry.seat.character));
    const free: number[] = [];
    for (let i = 0; i < CHARACTER_COUNT; i++) {
      if (!used.has(i)) free.push(i);
    }
    if (free.length === 0) return randomInt(CHARACTER_COUNT);
    return free[randomInt(free.length)];
  }

  // ------------------------------------------------------------ membership

  addPlayer(id: string, name: string): { ok: boolean; error?: string } {
    const free = this.seats.findIndex((s) => s === null);
    if (free === -1) return { ok: false, error: '房间已满（最多 9 人）' };
    this.seats[free] = {
      id,
      name,
      stack: this.buyIn,
      connected: true,
      inHand: false,
      hole: [],
      bet: 0,
      committed: 0,
      folded: false,
      allin: false,
      acted: false,
      raiseRights: false,
      won: 0,
      isBot: false,
      character: this.pickCharacter(),
    };
    if (!this.hostId) this.hostId = id;
    this.addLog(`${name} 带 ${fmt(this.buyIn)} 筹码入座`, 'system');
    this.touch();
    return { ok: true };
  }

  addBot(index: number): { ok: boolean; error?: string } {
    const free = this.seats.findIndex((s) => s === null);
    if (free === -1) return { ok: false, error: '房间已满（最多 9 人）' };
    const name = botName(index);
    this.seats[free] = {
      id: `ai-${this.code}-${free}`,
      name,
      stack: this.buyIn,
      connected: true,
      inHand: false,
      hole: [],
      bet: 0,
      committed: 0,
      folded: false,
      allin: false,
      acted: false,
      raiseRights: false,
      won: 0,
      isBot: true,
      botProfile: makeBotProfile(index),
      character: this.pickCharacter(),
    };
    this.addLog(`${name} 入座`, 'system');
    this.touch();
    return { ok: true };
  }

  hasHumanSeats(): boolean {
    return this.seatEntries().some((entry) => !entry.seat.isBot);
  }

  removePlayer(id: string): ActionResult {
    const found = this.byId(id);
    if (!found) return { ok: false, error: '你不在这张牌桌' };
    if (found.seat.isBot) return { ok: false, error: 'AI 玩家不能离开牌桌' };
    if (this.handInProgress() && found.seat.inHand) {
      return { ok: false, error: '牌局进行中，请等本手结束后再离开' };
    }
    this.seats[found.index] = null;
    this.addLog(`${found.seat.name} 离开了牌桌`, 'system');
    if (this.hostId === id) {
      this.hostId = this.seatEntries().find((entry) => !entry.seat.isBot)?.seat.id ?? '';
    }
    if (this.handInProgress() && this.toActId === id) {
      this.toActId = null;
      this.turnDeadline = null;
    }
    this.touch();
    return { ok: true };
  }

  setConnected(id: string, connected: boolean, now: number): void {
    const found = this.byId(id);
    if (!found) return;
    found.seat.connected = connected;
    if (!connected && this.toActId === id && this.turnDeadline !== null) {
      this.turnDeadline = Math.min(this.turnDeadline, now + 5_000);
    }
    this.touch();
  }

  rebuy(id: string): ActionResult {
    const found = this.byId(id);
    if (!found) return { ok: false, error: '你不在这张牌桌' };
    if (found.seat.isBot) return { ok: false, error: 'AI 会自动重新买入' };
    if (found.seat.stack > 0) return { ok: false, error: '还有筹码，不能重新买入' };
    if (this.handInProgress() && found.seat.inHand) {
      return { ok: false, error: '本手结束后才能重新买入' };
    }
    found.seat.stack = this.buyIn;
    found.seat.won = 0;
    this.addLog(`${found.seat.name} 重新买入 ${fmt(this.buyIn)}`, 'system');
    this.touch();
    return { ok: true };
  }

  // -------------------------------------------------------------- lifecycle

  startHand(now: number): boolean {
    if (this.handInProgress()) return false;

    for (const { seat } of this.seatEntries()) {
      if (seat.isBot && seat.stack === 0) {
        seat.stack = this.buyIn;
        seat.won = 0;
        this.addLog(`${seat.name} 自动重新买入 ${fmt(this.buyIn)}`, 'system');
      }
    }

    const ready = this.seatEntries().filter((e) => e.seat.stack > 0 && e.seat.connected);
    if (ready.length < 2) return false;

    for (const { seat } of this.seatEntries()) {
      seat.inHand = false;
      seat.hole = [];
      seat.bet = 0;
      seat.committed = 0;
      seat.folded = false;
      seat.allin = false;
      seat.acted = false;
      seat.raiseRights = false;
      seat.won = 0;
    }
    for (const { seat } of ready) {
      seat.inHand = true;
      seat.raiseRights = true;
    }

    this.handId++;
    this.community = [];
    this.deck = shuffle(newDeck());
    this.result = null;
    this.revealed = {};
    this.startAt = null;
    this.nextHandAt = null;
    this.turnDeadline = null;
    this.botActAt = null;
    this.toActId = null;
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    this.hasFullBet = true;
    this.street = 'preflop';

    if (this.dealerSeat === -1 || !this.seats[this.dealerSeat]?.inHand) {
      const idxs = ready.map((e) => e.index);
      this.dealerSeat = idxs[randomInt(idxs.length)];
    } else {
      this.dealerSeat = this.nextSeat(this.dealerSeat, (s) => s.inHand);
    }

    const inHandCount = ready.length;
    let sbIdx: number;
    let bbIdx: number;
    if (inHandCount === 2) {
      sbIdx = this.dealerSeat;
      bbIdx = this.nextSeat(this.dealerSeat, (s) => s.inHand);
    } else {
      sbIdx = this.nextSeat(this.dealerSeat, (s) => s.inHand);
      bbIdx = this.nextSeat(sbIdx, (s) => s.inHand);
    }
    this.sbSeat = sbIdx;
    this.bbSeat = bbIdx;

    this.addLog(`第 ${this.handId} 手开始`, 'system');

    this.postBlind(this.seats[sbIdx]!, this.sb);
    this.postBlind(this.seats[bbIdx]!, this.bb);
    this.addLog(
      `${this.seats[sbIdx]!.name} 小盲 ${fmt(this.seats[sbIdx]!.bet)} · ${this.seats[bbIdx]!.name} 大盲 ${fmt(this.seats[bbIdx]!.bet)}`,
      'info',
    );

    for (let round = 0; round < 2; round++) {
      let i = this.dealerSeat;
      for (let k = 0; k < inHandCount; k++) {
        i = this.nextSeat(i, (s) => s.inHand);
        this.seats[i]!.hole.push(this.draw());
      }
    }

    const firstIdx = this.nextSeat(bbIdx, (s) => s.inHand && !s.allin);
    if (firstIdx === -1) {
      this.runout(now);
    } else {
      this.toActId = this.seats[firstIdx]!.id;
      this.turnDeadline = now + TURN_MS;
    }
    this.touch();
    return true;
  }

  tick(now: number): void {
    if (this.handInProgress()) {
      if (this.toActId) {
        const actor = this.byId(this.toActId);
        if (actor?.seat.isBot) {
          this.botTurn(actor.seat, now);
          return;
        }
      }
      if (this.toActId && this.turnDeadline !== null && now >= this.turnDeadline) {
        const found = this.byId(this.toActId);
        if (!found) {
          this.toActId = null;
          this.turnDeadline = null;
          this.touch();
          return;
        }
        const canCheck = found.seat.bet === this.currentBet;
        this.addLog(`${found.seat.name} 行动超时${canCheck ? '，自动过牌' : '，自动弃牌'}`, 'system');
        this.act(found.seat.id, canCheck ? 'check' : 'fold', undefined, now);
        this.touch();
      }
      return;
    }

    if (this.street === 'showdown') {
      if (this.nextHandAt !== null && now >= this.nextHandAt) {
        this.nextHandAt = null;
        if (this.readyCount() >= 2) {
          this.startHand(now);
        } else {
          this.street = 'waiting';
          this.result = null;
          this.revealed = {};
          this.startAt = null;
          this.addLog('等待更多玩家加入', 'system');
          this.touch();
        }
      }
      return;
    }

    if (this.readyCount() >= 2) {
      if (this.startAt === null) {
        this.startAt = now + START_DELAY_MS;
        this.touch();
      } else if (now >= this.startAt) {
        this.startHand(now);
      }
    } else if (this.startAt !== null) {
      this.startAt = null;
      this.touch();
    }
  }

  private draw(): Card {
    const c = this.deck.pop();
    if (!c) throw new Error('deck empty');
    return c;
  }

  private botTurn(seat: Seat, now: number): void {
    if (!this.handInProgress() || this.toActId !== seat.id) {
      this.botActAt = null;
      return;
    }
    if (this.botActAt === null) {
      this.botActAt = now + 350 + randomInt(500);
      return;
    }
    if (now < this.botActAt) return;
    this.botActAt = null;

    const state = this.stateFor(seat.id);
    let decision: BotDecision;
    try {
      decision = decideBotAction(state, seat.botProfile ?? makeBotProfile(0));
    } catch {
      decision = { type: state.legal?.canCheck ? 'check' : 'fold' };
    }

    let result = this.act(seat.id, decision.type, decision.amount, now);
    if (!result.ok) {
      result = this.act(seat.id, state.legal?.canCheck ? 'check' : 'fold', undefined, now);
    }
    if (!result.ok) {
      this.addLog(`${seat.name} 行动异常，等待超时处理`, 'system');
      this.touch();
    }
  }

  private postBlind(seat: Seat, amount: number): void {
    const pay = Math.min(amount, seat.stack);
    seat.stack -= pay;
    seat.bet += pay;
    seat.committed += pay;
    if (seat.stack === 0) seat.allin = true;
  }

  // ---------------------------------------------------------------- actions

  act(playerId: string, type: ActionType, amount: number | undefined, now: number): ActionResult {
    if (!this.handInProgress()) return { ok: false, error: '现在不能行动' };
    if (this.toActId !== playerId) return { ok: false, error: '还没轮到你行动' };
    const found = this.byId(playerId);
    if (!found) return { ok: false, error: '玩家不存在' };
    const seat = found.seat;
    if (!seat.inHand || seat.folded || seat.allin) return { ok: false, error: '你现在不能行动' };

    const toCall = Math.max(0, this.currentBet - seat.bet);
    const maxRaiseTo = seat.bet + seat.stack;
    const nominalMinTo = this.hasFullBet ? this.currentBet + this.minRaise : this.bb;

    if (type === 'fold') {
      seat.folded = true;
      seat.acted = true;
      seat.raiseRights = false;
      this.addLog(`${seat.name} 弃牌`, 'action');
    } else if (type === 'check') {
      if (toCall !== 0) return { ok: false, error: `需要跟注 ${fmt(toCall)}` };
      seat.acted = true;
      seat.raiseRights = false;
      this.addLog(`${seat.name} 过牌`, 'action');
    } else if (type === 'call') {
      if (toCall === 0) return { ok: false, error: '当前无需跟注' };
      const pay = Math.min(toCall, seat.stack);
      seat.stack -= pay;
      seat.bet += pay;
      seat.committed += pay;
      seat.acted = true;
      seat.raiseRights = false;
      if (seat.stack === 0) {
        seat.allin = true;
        this.addLog(`${seat.name} 全下跟注 ${fmt(pay)}`, 'action');
      } else {
        this.addLog(`${seat.name} 跟注 ${fmt(pay)}`, 'action');
      }
    } else if (type === 'raise' || type === 'allin') {
      let raiseTo = type === 'allin' ? maxRaiseTo : Math.round(amount ?? 0);
      if (!Number.isFinite(raiseTo)) return { ok: false, error: '加注金额无效' };

      if (raiseTo <= this.currentBet) {
        if (raiseTo !== maxRaiseTo || seat.stack <= 0) {
          return { ok: false, error: `加注至少要到 ${fmt(this.currentBet + 1)}` };
        }
        // All-in that does not cover the current bet is just a call for less.
        const pay = seat.stack;
        seat.stack = 0;
        seat.bet += pay;
        seat.committed += pay;
        seat.allin = true;
        seat.acted = true;
        seat.raiseRights = false;
        this.addLog(`${seat.name} 全下 ${fmt(pay)}`, 'action');
      } else {
        if (!seat.raiseRights) {
          return { ok: false, error: '本轮已行动过，这次加注不构成完整加注，只能跟注或弃牌' };
        }
        if (raiseTo > maxRaiseTo) return { ok: false, error: '筹码不足' };
        const isAllIn = raiseTo === maxRaiseTo;
        const opening = this.currentBet === 0;
        if (raiseTo < nominalMinTo && !isAllIn) {
          return { ok: false, error: `最小加注到 ${fmt(nominalMinTo)}` };
        }
        const isFull = raiseTo >= nominalMinTo;
        const delta = raiseTo - seat.bet;
        seat.stack -= delta;
        seat.bet = raiseTo;
        seat.committed += delta;
        if (seat.stack === 0) seat.allin = true;

        if (isFull) {
          this.minRaise = this.hasFullBet ? raiseTo - this.currentBet : raiseTo;
          this.hasFullBet = true;
        }
        this.currentBet = raiseTo;
        for (const { seat: other } of this.seatEntries()) {
          if (other !== seat && other.inHand && !other.folded && !other.allin) {
            other.acted = false;
            if (isFull) other.raiseRights = true;
          }
        }
        seat.acted = true;
        seat.raiseRights = false;
        this.addLog(
          seat.allin
            ? `${seat.name} 全下 ${fmt(raiseTo)}`
            : opening
              ? `${seat.name} 下注 ${fmt(raiseTo)}`
              : `${seat.name} 加注到 ${fmt(raiseTo)}`,
          'action',
        );
      }
    } else {
      return { ok: false, error: '未知操作' };
    }

    this.botActAt = null;
    this.toActId = null;
    this.turnDeadline = null;
    this.continueAfterAction(found.index, now);
    this.touch();
    return { ok: true };
  }

  private continueAfterAction(fromSeat: number, now: number): void {
    const live = this.liveSeats();
    if (live.length <= 1) {
      if (live.length === 1) this.finishByFold(live[0], now);
      return;
    }

    const actors = live.filter((s) => !s.allin);
    const matched = actors.every((s) => s.bet === this.currentBet);
    const allActed = actors.every((s) => s.acted);
    const bettingDone =
      actors.length === 0 || (actors.length === 1 ? matched : matched && allActed);

    if (bettingDone) {
      this.advanceStreet(now);
      return;
    }

    const nextIdx = this.nextSeat(
      fromSeat,
      (s) => s.inHand && !s.folded && !s.allin && (!s.acted || s.bet < this.currentBet),
    );
    if (nextIdx === -1) {
      this.advanceStreet(now);
      return;
    }
    this.toActId = this.seats[nextIdx]!.id;
    this.turnDeadline = now + TURN_MS;
  }

  /** Returns the unmatched part of the highest street bet to its owner. */
  private refundUncalled(): void {
    const entries = this.seatEntries().filter((e) => e.seat.inHand && e.seat.bet > 0);
    if (entries.length < 2) return;
    const sorted = [...entries].sort((a, b) => b.seat.bet - a.seat.bet);
    const top = sorted[0];
    const second = sorted[1];
    if (top.seat.bet > second.seat.bet) {
      const refund = top.seat.bet - second.seat.bet;
      top.seat.bet -= refund;
      top.seat.committed -= refund;
      top.seat.stack += refund;
      if (top.seat.stack > 0) top.seat.allin = false;
    }
  }

  private resetStreetBets(): void {
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.hasFullBet = false;
    for (const { seat } of this.seatEntries()) {
      if (!seat.inHand) continue;
      seat.bet = 0;
      if (seat.folded) continue;
      seat.acted = false;
      seat.raiseRights = !seat.allin;
    }
  }

  private dealNextStreet(): void {
    this.deck.pop();
    if (this.street === 'preflop') {
      this.street = 'flop';
      this.community.push(this.draw(), this.draw(), this.draw());
      this.addLog(`翻牌 ${this.community.map(cardText).join(' ')}`, 'info');
    } else if (this.street === 'flop') {
      this.street = 'turn';
      this.community.push(this.draw());
      this.addLog(`转牌 ${cardText(this.community[3])}`, 'info');
    } else if (this.street === 'turn') {
      this.street = 'river';
      this.community.push(this.draw());
      this.addLog(`河牌 ${cardText(this.community[4])}`, 'info');
    }
  }

  private advanceStreet(now: number): void {
    this.refundUncalled();
    if (this.street === 'river') {
      this.showdown(now);
      return;
    }

    this.dealNextStreet();
    this.resetStreetBets();

    const actors = this.liveSeats().filter((s) => !s.allin);
    if (actors.length >= 2) {
      const firstIdx = this.nextSeat(this.dealerSeat, (s) => s.inHand && !s.folded && !s.allin);
      this.toActId = this.seats[firstIdx]?.id ?? null;
      this.turnDeadline = now + TURN_MS;
      return;
    }

    // Everyone remaining is all-in: run out the board immediately.
    while ((this.street as Street) !== 'river') {
      this.dealNextStreet();
      this.resetStreetBets();
    }
    this.showdown(now);
  }

  private runout(now: number): void {
    this.refundUncalled();
    while (this.street !== 'river') {
      this.dealNextStreet();
      this.resetStreetBets();
    }
    this.showdown(now);
  }

  private buildPots(): { amount: number; eligible: Seat[] }[] {
    const contributors = this.seatEntries()
      .filter((e) => e.seat.inHand && e.seat.committed > 0)
      .map((e) => e.seat);
    const levels = [...new Set(contributors.map((s) => s.committed))].sort((a, b) => a - b);
    const pots: { amount: number; eligible: Seat[] }[] = [];
    let prev = 0;

    for (const level of levels) {
      const involved = contributors.filter((s) => s.committed >= level);
      const amount = (level - prev) * involved.length;
      const eligible = involved.filter((s) => !s.folded);
      prev = level;
      if (amount <= 0) continue;

      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length && last.eligible.every((s) => eligible.includes(s))) {
        last.amount += amount;
      } else if (eligible.length === 0 && last) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligible });
      }
    }
    return pots;
  }

  private finishByFold(winner: Seat, now: number): void {
    const amount = this.potTotal();
    winner.stack += amount;
    winner.won = amount;
    this.botActAt = null;
    this.result = {
      showdown: false,
      pots: [
        {
          amount,
          winners: [{ id: winner.id, name: winner.name, amount, handName: '' }],
        },
      ],
    };
    this.revealed = {};
    this.street = 'showdown';
    this.toActId = null;
    this.turnDeadline = null;
    this.nextHandAt = now + SHOWDOWN_MS;
    this.addLog(`${winner.name} 赢得底池 ${fmt(amount)}`, 'win');
  }

  private showdown(now: number): void {
    const live = this.liveSeats();
    const scores = new Map<string, HandScore>();

    for (const seat of live) {
      const hand = bestHand([...seat.hole, ...this.community]);
      scores.set(seat.id, hand.score);
      this.revealed[seat.id] = { cards: [...seat.hole], handName: hand.name };
    }

    const pots = this.buildPots();
    const potResults: PotResult[] = [];

    for (const pot of pots) {
      if (pot.eligible.length === 0) {
        continue;
      }
      let best: HandScore | null = null;
      const winners: Seat[] = [];
      for (const seat of pot.eligible) {
        const score = scores.get(seat.id)!;
        if (!best || compareScores(score, best) > 0) {
          best = score;
          winners.length = 0;
          winners.push(seat);
        } else if (compareScores(score, best) === 0) {
          winners.push(seat);
        }
      }

      const order = [...winners].sort(
        (a, b) => this.oddChipOrder(a) - this.oddChipOrder(b),
      );
      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount % winners.length;
      const payouts: PotResult['winners'] = [];

      order.forEach((seat, i) => {
        const pay = share + (i < remainder ? 1 : 0);
        seat.stack += pay;
        seat.won += pay;
        payouts.push({ id: seat.id, name: seat.name, amount: pay, handName: this.revealed[seat.id]?.handName ?? '' });
      });

      // Keep winner list in seat order for display.
      payouts.sort((a, b) => (this.byId(a.id)!.index - this.byId(b.id)!.index));
      potResults.push({ amount: pot.amount, winners: payouts });
    }

    this.result = { showdown: true, pots: potResults };
    this.street = 'showdown';
    this.botActAt = null;
    this.toActId = null;
    this.turnDeadline = null;
    this.nextHandAt = now + SHOWDOWN_MS;

    for (const pot of potResults) {
      const names = pot.winners.map((w) => w.name).join('、');
      const handName = pot.winners[0]?.handName || '';
      const total = pot.winners.reduce((s, w) => s + w.amount, 0);
      this.addLog(`${names} 以 ${handName} 赢得 ${fmt(total)}`, 'win');
    }
  }

  private oddChipOrder(seat: Seat): number {
    const found = this.byId(seat.id)!;
    return (found.index - this.dealerSeat - 1 + SEAT_COUNT) % SEAT_COUNT;
  }

  // ----------------------------------------------------------------- state

  private legalFor(seat: Seat): LegalActions {
    const toCall = Math.max(0, this.currentBet - seat.bet);
    const maxRaiseTo = seat.bet + seat.stack;
    const nominalMinTo = this.hasFullBet ? this.currentBet + this.minRaise : this.bb;
    const canRaise = seat.raiseRights && maxRaiseTo > this.currentBet;
    return {
      canCheck: toCall === 0,
      callAmount: Math.min(toCall, seat.stack),
      canRaise,
      minRaiseTo: Math.min(nominalMinTo, maxRaiseTo),
      maxRaiseTo,
      shortAllInOnly: canRaise && maxRaiseTo < nominalMinTo,
    };
  }

  stateFor(viewerId: string): GameState {
    const viewer = this.byId(viewerId);
    const seats: (SeatView | null)[] = this.seats.map((seat, index) => {
      if (!seat) return null;
      return {
        id: seat.id,
        name: seat.name,
        seat: index,
        stack: seat.stack,
        bet: this.handInProgress() ? seat.bet : 0,
        committed: seat.committed,
        folded: seat.folded,
        allin: seat.allin,
        connected: seat.connected,
        waiting: this.handInProgress() && !seat.inHand,
        isDealer: index === this.dealerSeat,
        isSB: index === this.sbSeat,
        isBB: index === this.bbSeat,
        hole: seat.id === viewerId ? [...seat.hole] : null,
        holeCount: seat.inHand && !seat.folded && seat.hole.length ? seat.hole.length : 0,
        isYou: seat.id === viewerId,
        isBot: seat.isBot,
        character: seat.character,
        won: seat.won,
      };
    });

    const legal =
      viewer && this.toActId === viewer.seat.id && this.handInProgress()
        ? this.legalFor(viewer.seat)
        : null;

    return {
      code: this.code,
      hostId: this.hostId,
      sb: this.sb,
      bb: this.bb,
      buyIn: this.buyIn,
      seats,
      dealerSeat: this.dealerSeat,
      street: this.street,
      community: [...this.community],
      pot: this.potTotal(),
      currentBet: this.currentBet,
      toAct: this.toActId,
      toActName: this.toActId ? this.byId(this.toActId)?.seat.name ?? null : null,
      turnDeadline: this.turnDeadline,
      turnMs: TURN_MS,
      handId: this.handId,
      nextHandAt: this.nextHandAt,
      startAt: this.startAt,
      result: this.result,
      revealed: this.revealed,
      legal,
      youId: viewerId,
      handInProgress: this.handInProgress(),
      readyCount: this.readyCount(),
      log: this.log.slice(-40),
    };
  }
}
