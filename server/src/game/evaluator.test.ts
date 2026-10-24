import test from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Suit } from '../../../shared/protocol';
import { bestHand, compareScores, evaluate5, handName } from './evaluator';

function c(text: string): Card {
  const suit = text.slice(-1) as Suit;
  const rank = text.slice(0, -1);
  const r = rank === 'A' ? 14 : rank === 'K' ? 13 : rank === 'Q' ? 12 : rank === 'J' ? 11 : rank === 'T' ? 10 : Number(rank);
  return { r, s: suit };
}

function hand(...texts: string[]): Card[] {
  return texts.map(c);
}

test('royal flush is the nuts and beats quads', () => {
  const royal = bestHand(hand('As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '7c'));
  const quads = bestHand(hand('9h', '9d', '9s', '9c', 'Ah', 'Kd', '2c'));
  assert.equal(royal.name, '皇家同花顺');
  assert.ok(compareScores(royal.score, quads.score) > 0);
});

test('wheel straight is five-high and loses to six-high straight', () => {
  const wheel = evaluate5(hand('Ah', '2d', '3s', '4c', '5h'));
  const six = evaluate5(hand('2h', '3d', '4s', '5c', '6h'));
  assert.deepEqual(wheel, [4, 5]);
  assert.ok(compareScores(six, wheel) > 0);
});

test('full house beats flush, quads beat full house', () => {
  const flush = bestHand(hand('Ah', 'Kh', '9h', '6h', '3h', '2c', '2d'));
  const boat = bestHand(hand('As', 'Ad', 'Ac', 'Kh', 'Kd', '2c', '7s'));
  const quads = bestHand(hand('As', 'Ad', 'Ac', 'Ah', 'Kd', '2c', '7s'));
  assert.equal(flush.name, '同花');
  assert.equal(boat.name, '葫芦');
  assert.ok(compareScores(boat.score, flush.score) > 0);
  assert.ok(compareScores(quads.score, boat.score) > 0);
});

test('kickers break ties correctly', () => {
  const pairAceKing = evaluate5(hand('Ah', 'Ad', 'Ks', 'Qc', '9h'));
  const pairAceQueen = evaluate5(hand('As', 'Ac', 'Qs', 'Jc', '9h'));
  assert.ok(compareScores(pairAceKing, pairAceQueen) > 0);

  const twoPairHigh = evaluate5(hand('Ah', 'Ad', 'Ks', 'Kc', '9h'));
  const twoPairLowKicker = evaluate5(hand('As', 'Ac', 'Kh', 'Kd', '8h'));
  assert.ok(compareScores(twoPairHigh, twoPairLowKicker) > 0);
});

test('best five is picked from seven cards', () => {
  const result = bestHand(hand('As', 'Ad', 'Ac', 'Kh', 'Kd', '2c', '3s'));
  assert.equal(result.name, '葫芦');
  assert.deepEqual(
    [...result.score],
    [6, 14, 13],
  );
});

test('identical hands compare equal', () => {
  const board = hand('Ah', 'Kd', 'Qs', 'Jc', '9h');
  const a = bestHand([...board, ...hand('2c', '3d')]);
  const b = bestHand([...board, ...hand('2s', '3h')]);
  assert.equal(compareScores(a.score, b.score), 0);
  assert.equal(handName(a.score), '高牌');
});
