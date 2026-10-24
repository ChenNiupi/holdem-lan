import type { Card } from '../../../shared/protocol';

/** Score = [category, ...tiebreakers], compared lexicographically. */
export type HandScore = number[];

const CATEGORY_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

function straightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique[0] === 14) unique.push(1);
  for (let i = 0; i + 4 < unique.length; i++) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }
  return null;
}

export function evaluate5(cards: Card[]): HandScore {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const high = straightHigh(ranks);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kickers = ranks.filter((r) => r !== groups[0][0]);

  if (flush && high) return [8, high];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] >= 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks];
  if (high) return [4, high];
  if (groups[0][1] === 3) return [3, groups[0][0], ...kickers.slice(0, 2)];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return [2, pairs[0], pairs[1], groups[2][0]];
  }
  if (groups[0][1] === 2) {
    return [1, groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)];
  }
  return [0, ...ranks];
}

export function compareScores(a: HandScore, b: HandScore): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface BestHand {
  score: HandScore;
  cards: Card[];
  name: string;
}

export function bestHand(cards: Card[]): BestHand {
  if (cards.length < 5) throw new Error('need at least 5 cards');
  let bestScore: HandScore | null = null;
  let bestCards: Card[] | null = null;

  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = evaluate5(five);
            if (!bestScore || compareScores(score, bestScore) > 0) {
              bestScore = score;
              bestCards = five;
            }
          }
        }
      }
    }
  }

  return {
    score: bestScore!,
    cards: bestCards!,
    name: handName(bestScore!),
  };
}

export function handName(score: HandScore): string {
  const cat = score[0];
  if (cat === 8 && score[1] === 14) return '皇家同花顺';
  return CATEGORY_NAMES[cat] ?? '高牌';
}
