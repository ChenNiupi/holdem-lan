import type { Card } from '../shared/protocol';

const RANKS: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const SUITS: Record<Card['s'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function rankLabel(r: number): string {
  return RANKS[r] ?? '';
}

export function suitSymbol(s: Card['s']): string {
  return SUITS[s];
}

export function isRedCard(card: Card): boolean {
  return card.s === 'h' || card.s === 'd';
}

export function fmtChips(n: number): string {
  return n.toLocaleString('en-US');
}

export const SESSION_KEY = 'holdem.session.v1';
export const NAME_KEY = 'holdem.name';

export interface StoredSession {
  code: string;
  token: string;
  name: string;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.code || !parsed.token || !parsed.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function roomCodeFromLocation(): string {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{5})\/?$/);
  return match ? match[1].toUpperCase() : '';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
