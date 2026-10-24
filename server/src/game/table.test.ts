import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from './table';
import type { ActionType, GameState } from '../../../shared/protocol';
import { CHARACTER_COUNT } from '../../../shared/protocol';

const NOW = 1_000_000;

function makeRoom(stacks: number[]): Room {
  const room = new Room('TEST', 'p0', 5, 10);
  stacks.forEach((stack, i) => {
    const res = room.addPlayer(`p${i}`, `P${i}`);
    assert.equal(res.ok, true);
    room.seats[i]!.stack = stack;
  });
  return room;
}

function totalChips(room: Room): number {
  return room.seats.reduce((sum, seat) => sum + (seat ? seat.stack : 0), 0);
}

function acting(room: Room): GameState {
  const base = room.stateFor('p0');
  if (!base.toAct) throw new Error('no one is acting');
  return room.stateFor(base.toAct);
}

test('heads-up hand: blinds, option, flop order and fold win', () => {
  const room = makeRoom([1000, 1000]);
  room.dealerSeat = 8;
  assert.equal(room.startHand(NOW), true);

  let st = room.stateFor('p0');
  assert.equal(st.street, 'preflop');
  assert.equal(st.pot, 15);
  const sb = st.seats.find((s) => s?.isSB)!;
  const bb = st.seats.find((s) => s?.isBB)!;
  assert.equal(st.toAct, sb.id, 'heads-up: dealer/SB acts first preflop');
  assert.equal(room.stateFor(sb.id).legal!.callAmount, 5);

  assert.equal(room.act(sb.id, 'call', undefined, NOW + 1000).ok, true);
  st = room.stateFor(bb.id);
  assert.equal(st.toAct, bb.id, 'BB gets the option');
  assert.equal(st.legal!.canCheck, true);
  assert.equal(room.act(bb.id, 'check', undefined, NOW + 2000).ok, true);

  st = room.stateFor('p0');
  assert.equal(st.street, 'flop');
  assert.equal(st.community.length, 3);
  assert.equal(st.toAct, bb.id, 'heads-up: non-dealer acts first postflop');

  assert.equal(room.act(bb.id, 'fold', undefined, NOW + 3000).ok, true);
  st = room.stateFor('p0');
  assert.equal(st.street, 'showdown');
  assert.equal(st.result!.showdown, false);
  assert.equal(st.result!.pots[0].amount, 20);
  assert.equal(st.result!.pots[0].winners[0].id, sb.id);
  assert.equal(room.seats[sb.seat]!.stack, 1010);
  assert.equal(totalChips(room), 2000);
});

test('three-way all-in builds side pots and conserves chips', () => {
  const room = makeRoom([100, 60, 40]);
  room.dealerSeat = 2;
  assert.equal(room.startHand(NOW), true);

  let st = room.stateFor('p0');
  assert.equal(st.toAct, 'p0');

  assert.equal(room.act('p0', 'allin', undefined, NOW + 1000).ok, true);
  st = room.stateFor('p0');
  assert.equal(st.toAct, 'p1');
  assert.equal(room.act('p1', 'call', undefined, NOW + 2000).ok, true);
  st = room.stateFor('p0');
  assert.equal(st.toAct, 'p2');
  assert.equal(room.act('p2', 'call', undefined, NOW + 3000).ok, true);

  st = room.stateFor('p0');
  assert.equal(st.street, 'showdown');
  assert.equal(st.result!.showdown, true);
  assert.equal(st.community.length, 5);

  const potTotal = st.result!.pots.reduce((sum, pot) => sum + pot.amount, 0);
  assert.equal(potTotal, 160, 'uncalled 40 is refunded before building pots');
  assert.deepEqual(
    st.result!.pots.map((p) => p.amount).sort((a, b) => a - b),
    [40, 120],
  );
  assert.equal(totalChips(room), 200);
});

test('minimum raise is enforced and a short all-in does not reopen raising', () => {
  const room = makeRoom([1000, 35]);
  room.dealerSeat = 1;
  assert.equal(room.startHand(NOW), true);

  let st = acting(room);
  const sb = st.seats.find((s) => s?.isSB)!;
  const bb = st.seats.find((s) => s?.isBB)!;
  assert.equal(room.act(sb.id, 'raise', 15, NOW + 1000).ok, false, 'below min raise');
  assert.equal(room.act(sb.id, 'raise', 30, NOW + 2000).ok, true);

  st = acting(room);
  assert.equal(st.toAct, bb.id);
  assert.equal(room.act(bb.id, 'allin', undefined, NOW + 3000).ok, true);

  st = room.stateFor('p0');
  assert.equal(st.toAct, sb.id);
  assert.equal(st.currentBet, 35, 'short all-in becomes the new bet to call');
  assert.equal(st.legal!.callAmount, 5);
  assert.equal(st.legal!.canRaise, false, 'raiser cannot re-raise a short all-in');
  assert.equal(room.act(sb.id, 'raise', 100, NOW + 4000).ok, false);
  assert.equal(room.act(sb.id, 'call', undefined, NOW + 5000).ok, true);

  st = room.stateFor('p0');
  assert.equal(st.street, 'showdown');
  assert.equal(st.result!.showdown, true);
  assert.equal(totalChips(room), 1035);
  assert.equal(st.result!.pots.reduce((s, p) => s + p.amount, 0), 70);
});

test('fold to the last player ends the hand immediately', () => {
  const room = makeRoom([500, 500, 500]);
  room.dealerSeat = 2;
  assert.equal(room.startHand(NOW), true);

  const order: string[] = [];
  let guard = 0;
  while (room.stateFor('p0').handInProgress && guard++ < 10) {
    const st = acting(room);
    order.push(st.toAct!);
    const res = room.act(st.toAct!, 'fold', undefined, NOW + guard * 100);
    assert.equal(res.ok, true);
  }
  assert.equal(order.length, 2);
  const st = room.stateFor('p0');
  assert.equal(st.street, 'showdown');
  assert.equal(st.result!.showdown, false);
  assert.equal(st.result!.pots[0].amount, 15);
  assert.equal(totalChips(room), 1500);
});

test('a timed-out player is auto-folded', () => {
  const room = makeRoom([500, 500]);
  room.dealerSeat = 8;
  room.startHand(NOW);
  const st = room.stateFor('p0');
  const sb = st.seats.find((s) => s?.isSB)!;

  room.tick(NOW + 30_000);
  const after = room.stateFor('p0');
  assert.equal(after.street, 'showdown');
  const sbAfter = after.seats.find((s) => s?.id === sb.id)!;
  assert.equal(sbAfter.folded, true);
  room.removePlayer(sb.id);
});

test('rebuy is only possible after busting between hands', () => {
  const room = makeRoom([1000, 10]);
  assert.equal(room.rebuy('p1').ok, false, 'still has chips');
  room.seats[1]!.stack = 0;
  assert.equal(room.rebuy('p1').ok, true);
  assert.equal(room.seats[1]!.stack, room.buyIn);
});

test('random hands conserve chips and always resolve', () => {
  const room = makeRoom([1000, 1000, 1000, 1000, 1000, 1000]);
  let clock = NOW;

  for (let hand = 0; hand < 400; hand++) {
    const activeCount = 2 + Math.floor(Math.random() * 5);
    let total = 0;
    room.seats.forEach((seat, index) => {
      if (!seat) return;
      const stack = index < activeCount ? 10 + Math.floor(Math.random() * 290) : 0;
      seat.stack = stack;
      total += stack;
    });

    assert.equal(room.startHand(clock), true, `hand ${hand} should start`);
    let guard = 0;
    while (room.stateFor('p0').handInProgress) {
      guard++;
      assert.ok(guard < 400, `hand ${hand} did not finish`);
      const snapshot = room.stateFor('p0');
      const actor = snapshot.toAct;
      assert.ok(actor, `hand ${hand} has an actor`);
      const actorState = room.stateFor(actor!);
      const legal = actorState.legal;
      assert.ok(legal, `hand ${hand} exposes legal actions`);
      const seat = actorState.seats.find((s) => s?.id === actor)!;
      assert.ok(seat.stack >= 0);

      let type: ActionType;
      const roll = Math.random();
      if (legal.canCheck) {
        if (roll < 0.12 && legal.canRaise) type = 'raise';
        else if (roll < 0.16 && legal.canRaise) type = 'allin';
        else type = 'check';
      } else if (roll < 0.12) {
        type = 'fold';
      } else if (roll < 0.26 && legal.canRaise) {
        type = 'raise';
      } else if (roll < 0.34 && legal.canRaise) {
        type = 'allin';
      } else {
        type = 'call';
      }

      let amount: number | undefined;
      if (type === 'raise') {
        const min = legal.minRaiseTo;
        const max = legal.maxRaiseTo;
        amount = min + Math.floor(Math.random() * Math.max(1, max - min + 1));
        if (amount >= max) type = 'allin';
      }

      clock += 500;
      const result = room.act(actor!, type, amount, clock);
      assert.equal(result.ok, true, `hand ${hand}: ${result.error}`);
    }

    const after = room.stateFor('p0');
    assert.equal(after.street, 'showdown');
    assert.ok(after.result, `hand ${hand} produced a result`);
    const endTotal = room.seats.reduce((sum, seat) => sum + (seat ? seat.stack : 0), 0);
    assert.equal(endTotal, total, `hand ${hand} conserved chips`);
    room.seats.forEach((seat) => {
      if (seat) assert.ok(seat.stack >= 0);
    });

    clock += 10_000;
  }
});

test('AI players act, resolve hands and conserve chips', () => {
  const room = makeRoom([1000]);
  for (let i = 0; i < 3; i++) {
    assert.equal(room.addBot(i).ok, true);
  }

  let clock = NOW;
  for (let hand = 0; hand < 8; hand++) {
    if (room.seats[0]!.stack === 0) {
      assert.equal(room.rebuy('p0').ok, true, 'human can rebuy between hands');
    }
    assert.equal(room.startHand(clock), true, `bot hand ${hand} should start`);
    const startTotal = room.seats.reduce(
      (sum, seat) => sum + (seat ? seat.stack + seat.committed : 0),
      0,
    );

    let guard = 0;
    while (room.stateFor('p0').handInProgress) {
      guard++;
      assert.ok(guard < 900, `bot hand ${hand} stalled`);
      clock += 600;
      room.tick(clock);

      const human = room.stateFor('p0');
      if (human.handInProgress && human.toAct === 'p0' && human.legal) {
        const action = human.legal.canCheck ? 'check' : 'call';
        const res = room.act('p0', action, undefined, clock);
        assert.equal(res.ok, true, `human action failed: ${res.error}`);
      }
    }

    const after = room.stateFor('p0');
    assert.equal(after.street, 'showdown');
    assert.ok(after.result, `bot hand ${hand} produced a result`);
    const endTotal = room.seats.reduce((sum, seat) => sum + (seat ? seat.stack : 0), 0);
    assert.equal(endTotal, startTotal, `bot hand ${hand} conserved chips`);
    clock += 10_000;
  }

  const botSeat = room.seats.find((seat) => seat?.isBot)!;
  botSeat.stack = 0;
  assert.equal(room.startHand(clock), true, 'hand after bot bust should start');
  assert.ok(botSeat.stack > 900, 'busted AI automatically rebuys');
});

test('characters are randomly assigned without duplicates', () => {
  const room = new Room('CHARS', 'p0', 5, 10);
  for (let i = 0; i < CHARACTER_COUNT; i++) {
    assert.equal(room.addPlayer(`p${i}`, `P${i}`).ok, true);
  }

  const chars = room
    .stateFor('p0')
    .seats.filter((seat) => seat !== null)
    .map((seat) => seat!.character);
  assert.equal(chars.length, CHARACTER_COUNT);
  assert.equal(new Set(chars).size, CHARACTER_COUNT, 'no duplicate characters');
  assert.ok(
    chars.every((value) => Number.isInteger(value) && value >= 0 && value < CHARACTER_COUNT),
  );

  assert.equal(room.removePlayer('p3').ok, true);
  assert.equal(room.addPlayer('p99', 'P99').ok, true);
  const afterSwap = room
    .stateFor('p0')
    .seats.filter((seat) => seat !== null)
    .map((seat) => seat!.character);
  assert.equal(new Set(afterSwap).size, CHARACTER_COUNT, 'freed character can be reused');

  const botRoom = makeRoom([1000]);
  for (let i = 0; i < CHARACTER_COUNT - 1; i++) {
    assert.equal(botRoom.addBot(i).ok, true);
  }
  const botChars = botRoom
    .stateFor('p0')
    .seats.filter((seat) => seat !== null)
    .map((seat) => seat!.character);
  assert.equal(new Set(botChars).size, CHARACTER_COUNT, 'AI players also get unique characters');
});
