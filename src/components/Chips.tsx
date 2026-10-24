import type { CSSProperties } from 'react';

interface ChipLook {
  color: string;
  count: number;
}

function chipLook(amount: number): ChipLook {
  if (amount >= 500) return { color: 'purple', count: Math.min(4, Math.max(1, Math.ceil(amount / 500))) };
  if (amount >= 100) return { color: 'black', count: Math.min(4, Math.max(1, Math.ceil(amount / 100))) };
  if (amount >= 50) return { color: 'slate', count: Math.min(4, Math.max(1, Math.ceil(amount / 50))) };
  if (amount >= 25) return { color: 'green', count: Math.min(4, Math.max(1, Math.ceil(amount / 25))) };
  if (amount >= 10) return { color: 'blue', count: Math.min(4, Math.max(1, Math.ceil(amount / 10))) };
  return { color: 'red', count: 1 };
}

export function ChipStack({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  const { color, count } = chipLook(amount);
  return (
    <div
      className="chip-stack"
      aria-hidden="true"
      style={{ '--chip-count': count } as CSSProperties}
      title={`${amount}`}
    >
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} className={`chip chip-${color}`} style={{ bottom: index * 4 }} />
      ))}
    </div>
  );
}

const POT_CHIPS = [
  { value: 500, color: 'purple' },
  { value: 100, color: 'black' },
  { value: 50, color: 'slate' },
  { value: 25, color: 'green' },
  { value: 10, color: 'blue' },
  { value: 5, color: 'red' },
];

function potChipColors(amount: number): string[] {
  let left = amount;
  const colors: string[] = [];
  for (const chip of POT_CHIPS) {
    while (left >= chip.value && colors.length < 4) {
      colors.push(chip.color);
      left -= chip.value;
    }
  }
  if (colors.length === 0) colors.push('white');
  return colors;
}

export function PotChips({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  const colors = potChipColors(amount);
  return (
    <div className="pot-chips" aria-hidden="true" title={`底池 ${amount}`}>
      {colors.map((color, index) => (
        <span key={index} className={`chip chip-${color}`} />
      ))}
    </div>
  );
}
