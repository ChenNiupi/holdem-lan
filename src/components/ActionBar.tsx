import { useEffect, useState } from 'react';
import type { ActionType, GameState, SeatView } from '../../shared/protocol';
import { clamp, fmtChips } from '../lib';

interface Props {
  state: GameState;
  mySeat: SeatView | null;
  now: number;
  busy: boolean;
  disabled: boolean;
  onAction: (type: ActionType, amount?: number) => void;
  onRebuy: () => void;
}

export default function ActionBar({ state, mySeat, now, busy, disabled, onAction, onRebuy }: Props) {
  const legal = state.legal;
  const myTurn = Boolean(legal) && state.toAct === mySeat?.id;
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    setRaiseOpen(false);
    setAmount(legal?.minRaiseTo ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.handId, state.toAct, legal?.minRaiseTo, legal?.maxRaiseTo]);

  const remaining = state.turnDeadline ? Math.max(0, state.turnDeadline - now) : 0;
  const seconds = Math.ceil(remaining / 1000);
  const timerPct = state.turnMs ? clamp((remaining / state.turnMs) * 100, 0, 100) : 0;
  const nextIn = state.nextHandAt ? Math.max(0, Math.ceil((state.nextHandAt - now) / 1000)) : null;
  const startIn = state.startAt ? Math.max(0, Math.ceil((state.startAt - now) / 1000)) : null;

  let body: React.ReactNode;

  if (!mySeat) {
    body = <div className="action-note">你正在旁观这张牌桌</div>;
  } else if (mySeat.stack === 0 && (!state.handInProgress || mySeat.waiting)) {
    body = (
      <div className="action-rebuy">
        <div>
          <b>筹码输光了</b>
          <span>重新买入后，下一手自动开始</span>
        </div>
        <button className="btn btn-primary" disabled={busy || disabled} onClick={onRebuy}>
          重新买入 {fmtChips(state.buyIn)}
        </button>
      </div>
    );
  } else if (!state.handInProgress) {
    let title = '等待开局';
    let hint = '';
    if (state.street === 'showdown') {
      title = '本手结束';
      hint = nextIn !== null ? `${nextIn} 秒后开始下一手` : '等待下一手';
    } else if (state.readyCount < 2) {
      title = '等待更多玩家';
      hint = '把邀请链接发给朋友，至少 2 人即可开局';
    } else {
      hint = startIn !== null ? `${startIn} 秒后开始` : '即将开始';
    }
    body = (
      <div className="action-note">
        <b>{title}</b>
        <span>{hint}</span>
      </div>
    );
  } else if (mySeat.folded) {
    body = (
      <div className="action-note">
        <b>本手已弃牌</b>
        <span>{state.toActName ? `等待 ${state.toActName} 行动` : '等待本手结束'}</span>
      </div>
    );
  } else if (mySeat.allin) {
    body = (
      <div className="action-note">
        <b>你已全下</b>
        <span>等待发牌与摊牌</span>
      </div>
    );
  } else if (mySeat.waiting) {
    body = (
      <div className="action-note">
        <b>本手旁观</b>
        <span>下一手自动加入牌局</span>
      </div>
    );
  } else if (!myTurn) {
    body = (
      <div className="action-note">
        <b>等待 {state.toActName ?? '其他玩家'} 行动</b>
        {state.turnDeadline && (
          <span className="action-countdown">
            剩 {seconds}s
          </span>
        )}
      </div>
    );
  } else if (legal) {
    const canCheck = legal.canCheck;
    const call = legal.callAmount;
    const allInCall = !canCheck && call >= mySeat.stack;
    const min = legal.minRaiseTo;
    const max = legal.maxRaiseTo;
    const opening = state.currentBet === 0;
    const halfPot = clamp(state.currentBet + Math.round((state.pot + call) / 2), min, max);
    const fullPot = clamp(state.currentBet + state.pot + call, min, max);

    body = (
      <div className="turn-controls">
        <div className="turn-head">
          <span className="turn-badge">轮到你行动</span>
          <span className="turn-clock">剩 {seconds}s</span>
        </div>
        <div className="action-buttons">
          <button className="btn btn-fold" disabled={busy || disabled} onClick={() => onAction('fold')}>
            弃牌
          </button>
          <button
            className="btn btn-call"
            disabled={busy || disabled}
            onClick={() => onAction(canCheck ? 'check' : 'call')}
          >
            {canCheck ? '过牌' : allInCall ? `全下跟注 ${fmtChips(call)}` : `跟注 ${fmtChips(call)}`}
          </button>
          {legal.canRaise && (
            <button
              className="btn btn-raise"
              disabled={busy || disabled}
              onClick={() => setRaiseOpen((open) => !open)}
            >
              {raiseOpen ? '收起' : opening ? '下注' : '加注'}
            </button>
          )}
        </div>

        {raiseOpen && legal.canRaise && (
          <div className="raise-panel">
            <div className="raise-head">
              <span>{opening ? '下注' : '加注到'}</span>
              <b>{fmtChips(amount)}</b>
              {legal.shortAllInOnly && <em>筹码不够最小加注，只能全下</em>}
            </div>
            <input
              className="raise-slider"
              type="range"
              min={min}
              max={max}
              step={1}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
            <div className="raise-presets">
              <button type="button" onClick={() => setAmount(min)}>
                最小
              </button>
              <button type="button" onClick={() => setAmount(halfPot)}>
                ½ 池
              </button>
              <button type="button" onClick={() => setAmount(fullPot)}>
                满池
              </button>
              <button type="button" onClick={() => setAmount(max)}>
                全下 {fmtChips(max)}
              </button>
            </div>
            <button
              className="btn btn-primary btn-block"
              disabled={busy || disabled || amount < min || amount > max}
              onClick={() => onAction('raise', amount)}
            >
              {amount >= max
                ? `确认全下 ${fmtChips(amount)}`
                : `确认${opening ? '下注' : '加注'}到 ${fmtChips(amount)}`}
            </button>
          </div>
        )}
      </div>
    );
  } else {
    body = <div className="action-note">等待中…</div>;
  }

  return (
    <div className={`action-bar ${raiseOpen ? 'is-raised' : ''}`}>
      {myTurn && (
        <div className="action-timer-line">
          <span style={{ width: `${timerPct}%` }} />
        </div>
      )}
      <div className="action-inner">{body}</div>
    </div>
  );
}
