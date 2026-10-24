import type { Card } from '../../shared/protocol';
import { rankLabel, suitSymbol } from '../lib';

type Size = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  card?: Card | null;
  hidden?: boolean;
  size?: Size;
  dim?: boolean;
  className?: string;
}

export default function PlayingCard({ card, hidden, size = 'md', dim, className = '' }: Props) {
  if (hidden) {
    return (
      <div className={`playing-card card-back size-${size} ${className}`}>
        <span className="back-mark">♠</span>
      </div>
    );
  }
  if (!card) {
    return <div className={`playing-card card-empty size-${size} ${className}`} />;
  }
  const red = card.s === 'h' || card.s === 'd';
  return (
    <div
      className={`playing-card size-${size} ${red ? 'card-red' : 'card-black'} ${dim ? 'is-dim' : ''} ${className}`}
    >
      <span className="pc-rank">{rankLabel(card.r)}</span>
      <span className="pc-suit">{suitSymbol(card.s)}</span>
      <span className="pc-center">{suitSymbol(card.s)}</span>
    </div>
  );
}
