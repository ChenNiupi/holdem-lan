import { CHARACTER_COUNT } from '../shared/protocol';

const FILES = Array.from(
  { length: CHARACTER_COUNT },
  (_, index) => `/characters/char-${String(index + 1).padStart(2, '0')}.webp`,
);

export function characterImage(index: number): string {
  return FILES[index] ?? FILES[0];
}
