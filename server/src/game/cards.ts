import { randomInt } from 'node:crypto';
import type { Card, Suit } from '../../../shared/protocol';

export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const RANK_LABEL: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push({ r, s });
  }
  return deck;
}

export function shuffle<T>(cards: T[]): T[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function cardText(card: Card): string {
  return `${RANK_LABEL[card.r]}${SUIT_SYMBOL[card.s]}`;
}
