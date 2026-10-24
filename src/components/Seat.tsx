import { useState } from 'react';
import type { Card, SeatView } from '../../shared/protocol';
import { fmtChips } from '../lib';
import { characterImage } from '../characters';
import PlayingCard from './PlayingCard';

interface Props {
  seat: SeatView;
  x: number;
  y: number;
  active: boolean;
  remainingMs: number;
  turnMs: number;
  revealed?: { cards: Card[]; handName: string };
  showResult: boolean;
}

export default function Seat({
  seat,
  x,
  y,
  active,
  remainingMs,
  turnMs,
  revealed,
  showResult,
}: Props) {
  const cardsBelow = y < 46;
  const faceUp = seat.isYou ? seat.hole : revealed?.cards ?? null;
  const showCards = !seat.folded && (faceUp ? faceUp.length > 0 : seat.holeCount > 0);
  const cardSize = seat.isYou ? 'lg' : 'sm';
  const pct = active ? Math.max(0, Math.min(100, (remainingMs / turnMs) * 100)) : 0;
  const initials = seat.name.slice(0, 1);
  const hue = (seat.seat * 47 + 145) % 360;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarBackground = seat.isBot
    ? 'linear-gradient(145deg, #4d8294, #1f3d47)'
    : `linear-gradient(145deg, hsl(${hue} 42% 44%), hsl(${hue} 40% 26%))`;

  return (
    <div
      className={[
        'seat',
        seat.isYou ? 'is-you' : '',
        seat.isBot ? 'is-bot' : '',
        active ? 'is-active' : '',
        seat.folded ? 'is-folded' : '',
        seat.allin ? 'is-allin' : '',
        !seat.connected ? 'is-offline' : '',
        seat.waiting ? 'is-waiting' : '',
        showResult && seat.won > 0 ? 'is-winner' : '',
        cardsBelow ? 'cards-below' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="seat-cards">
        {showCards ? (
          faceUp ? (
            faceUp.map((card) => (
              <PlayingCard key={`${card.r}${card.s}`} card={card} size={cardSize} dim={seat.folded} />
            ))
          ) : (
            Array.from({ length: seat.holeCount }).map((_, index) => (
              <PlayingCard key={index} hidden size={cardSize} />
            ))
          )
        ) : (
          <div className="seat-cards-empty" />
        )}
      </div>

      <div className="seat-pill">
        <div
          className={`seat-avatar ${seat.isBot ? 'bot-avatar' : ''}`}
          style={{ background: avatarBackground }}
        >
          {!avatarFailed ? (
            <img
              className="avatar-img"
              src={characterImage(seat.character)}
              alt=""
              draggable={false}
              decoding="async"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span>{seat.isBot ? 'AI' : initials}</span>
          )}
        </div>
        <div className="seat-info">
          <div className="seat-name-row">
            <span className="seat-name">{seat.name}</span>
            {seat.isYou && <span className="tag tag-you">你</span>}
            {seat.isDealer && <span className="dealer-chip">D</span>}
            {!seat.isDealer && seat.isSB && <span className="tag tag-blind">SB</span>}
            {seat.isBB && <span className="tag tag-blind">BB</span>}
          </div>
          <div className="seat-stack">
            <span className="chip-dot" />
            {fmtChips(seat.stack)}
            {seat.bet > 0 && <span className="seat-bet">下注 {fmtChips(seat.bet)}</span>}
          </div>
        </div>
        <div className="seat-badges">
          {seat.allin && <span className="badge badge-allin">全下</span>}
          {seat.folded && <span className="badge badge-fold">弃牌</span>}
          {seat.waiting && <span className="badge badge-wait">等待</span>}
          {!seat.connected && <span className="badge badge-off">离线</span>}
          {showResult && seat.won > 0 && <span className="badge badge-won">+{fmtChips(seat.won)}</span>}
        </div>
        {active && (
          <div className="seat-timer">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
