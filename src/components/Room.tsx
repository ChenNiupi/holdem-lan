import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActionResponse,
  ActionType,
  ChatMessage,
  GameState,
  SeatView,
  Street,
} from '../../shared/protocol';
import { copyText, fmtChips } from '../lib';
import { request, socket } from '../socket';
import { loadSoundEnabled, saveSoundEnabled, sound } from '../sound';
import { useGameSounds } from '../useGameSounds';
import { useNow } from '../useNow';
import ActionBar from './ActionBar';
import { ChipStack, PotChips } from './Chips';
import PlayingCard from './PlayingCard';
import Seat from './Seat';
import ShareModal from './ShareModal';
import SidePanel from './SidePanel';

interface Props {
  state: GameState;
  connection: 'connecting' | 'online' | 'offline';
  onLeave: () => void;
  toast: (text: string, kind?: 'error' | 'info') => void;
}

const STREET_NAMES: Record<Street, string> = {
  waiting: '等待开始',
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
};

const SEAT_COUNT = 9;

function seatLayout(seats: (SeatView | null)[]): Map<number, { x: number; y: number }> {
  const occupied = seats.filter((seat): seat is SeatView => Boolean(seat));
  const map = new Map<number, { x: number; y: number }>();
  if (occupied.length === 0) return map;

  const anchor = occupied.find((seat) => seat.isYou)?.seat ?? occupied[0].seat;
  const ordered = [...occupied].sort(
    (a, b) => ((a.seat - anchor + SEAT_COUNT) % SEAT_COUNT) - ((b.seat - anchor + SEAT_COUNT) % SEAT_COUNT),
  );

  ordered.forEach((seat, index) => {
    const angle = ((90 + (index * 360) / ordered.length) * Math.PI) / 180;
    map.set(seat.seat, {
      x: 50 + 36.5 * Math.cos(angle),
      y: 50 + 36.5 * Math.sin(angle),
    });
  });
  return map;
}

export default function Room({ state, connection, onLeave, toast }: Props) {
  const now = useNow(250);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'log' | 'chat'>('log');
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [soundOn, setSoundOn] = useState(() => loadSoundEnabled());
  useGameSounds(state, soundOn);

  const mySeat = state.seats.find((seat): seat is SeatView => Boolean(seat?.isYou)) ?? null;
  const positions = useMemo(() => seatLayout(state.seats), [state.seats]);
  const resultVisible = state.street === 'showdown' && Boolean(state.result);
  const nextIn = state.nextHandAt ? Math.max(0, Math.ceil((state.nextHandAt - now) / 1000)) : null;

  const panelRef = useRef({ open: panelOpen, tab: panelTab });
  panelRef.current = { open: panelOpen, tab: panelTab };

  useEffect(() => {
    const onChat = (msg: ChatMessage) => {
      setChats((prev) => [...prev.slice(-99), msg]);
      const panel = panelRef.current;
      if (!panel.open || panel.tab !== 'chat') {
        setUnread((count) => count + 1);
      }
    };
    socket.on('chat', onChat);
    return () => {
      socket.off('chat', onChat);
    };
  }, []);

  const openPanel = (tab: 'log' | 'chat') => {
    setPanelOpen(true);
    setPanelTab(tab);
    if (tab === 'chat') setUnread(0);
  };

  const togglePanel = () => {
    if (panelOpen) {
      setPanelOpen(false);
    } else {
      openPanel(panelTab);
    }
  };

  const act = async (type: ActionType, amount?: number) => {
    sound.unlock();
    if (busy || connection !== 'online') return;
    setBusy(true);
    try {
      const res = await request<ActionResponse>((cb) => socket.emit('action', { type, amount }, cb));
      if (!res.ok) toast(res.error ?? '操作失败', 'error');
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rebuy = async () => {
    sound.unlock();
    if (busy || connection !== 'online') return;
    setBusy(true);
    try {
      const res = await request<ActionResponse>((cb) => socket.emit('rebuy', cb));
      if (!res.ok) toast(res.error ?? '买入失败', 'error');
    } catch (err) {
      toast(err instanceof Error ? err.message : '买入失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    const ok = await copyText(state.code);
    toast(ok ? '房间号已复制' : '复制失败，请手动记录房间号', ok ? 'info' : 'error');
  };

  const confirmLeave = () => {
    if (state.handInProgress) {
      toast('本手结束后才能离开房间', 'error');
      return;
    }
    if (window.confirm('离开房间？桌上的虚拟筹码会作废。')) onLeave();
  };

  const toggleSound = () => {
    sound.unlock();
    const next = !soundOn;
    setSoundOn(next);
    saveSoundEnabled(next);
    sound.setMuted(!next);
    if (next) {
      sound.play('toggle');
    }
  };

  const sendChat = (text: string) => {
    if (!socket.connected) {
      toast('连接已断开，消息未发送', 'error');
      return;
    }
    socket.emit('chat', { text });
  };

  const seatViews = state.seats.filter((seat): seat is SeatView => Boolean(seat));
  const botCount = seatViews.filter((seat) => seat.isBot).length;
  const betSeats = seatViews.filter((seat) => state.handInProgress && seat.bet > 0);

  return (
    <div className="room">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark small">♠</span>
          <span className="brand-name">好友德州</span>
        </div>

        <div className="topbar-room">
          <button className="room-code-chip" onClick={copyCode} title="复制房间号">
            <span className="live-dot" />
            房间 <b>{state.code}</b>
          </button>
          <span className="topbar-meta">
            盲注 {state.sb}/{state.bb}
          </span>
          <span className="topbar-meta">
            {state.handId > 0 ? `第 ${state.handId} 手` : '未开局'}
          </span>
          {botCount > 0 && (
            <span className="topbar-meta hide-mobile">AI ×{botCount}</span>
          )}
        </div>

        <div className="topbar-actions">
          <button
            className={`top-action sound-toggle ${soundOn ? '' : 'is-off'}`}
            onClick={toggleSound}
            title={soundOn ? '关闭音效' : '开启音效'}
            aria-label={soundOn ? '关闭音效' : '开启音效'}
            aria-pressed={soundOn}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5L6.5 8.5H3.5v7h3L11 19V5z" />
              {soundOn ? (
                <>
                  <path d="M15.2 9.2a4.2 4.2 0 010 5.6" />
                  <path d="M18 6.6a8 8 0 010 10.8" />
                </>
              ) : (
                <path d="M16 9.5l4.4 5M20.4 9.5l-4.4 5" />
              )}
            </svg>
            <span className="sound-label">音效</span>
          </button>
          <button className="top-action" onClick={() => setShareOpen(true)}>
            邀请
          </button>
          <button className={`top-action ${panelOpen ? 'is-active' : ''}`} onClick={togglePanel}>
            记录
            {unread > 0 && <i className="unread-dot">{unread}</i>}
          </button>
          <button className="top-action is-danger" onClick={confirmLeave}>
            离开
          </button>
        </div>
      </header>

      {connection !== 'online' && <div className="net-banner">连接中断，正在重连…</div>}

      {resultVisible && (
        <div className="result-banner">
          <div className="result-pots">
            {state.result!.pots.map((pot, index) => (
              <div className="result-pot" key={index}>
                {state.result!.pots.length > 1 && (
                  <span className="result-pot-label">{index === 0 ? '主池' : '边池'}</span>
                )}
                {pot.winners.map((winner) => (
                  <span className="result-winner" key={winner.id}>
                    <b>{winner.name}</b>
                    {winner.handName && <em>{winner.handName}</em>}
                    <strong>+{fmtChips(winner.amount)}</strong>
                  </span>
                ))}
              </div>
            ))}
          </div>
          {nextIn !== null && <span className="result-next">{nextIn}s 后下一手</span>}
        </div>
      )}

      <main className="stage">
        <div className="table-area">
          <div className="felt">
            <div className="felt-logo" aria-hidden="true">
              HOLD'EM
            </div>
            <div className="board">
              <div className="pot-row">
                {state.pot > 0 && state.street !== 'showdown' && (
                  <div className="pot-wrap">
                    <PotChips amount={state.pot} />
                    <div className="pot-amount">
                      <span>底池</span>
                      <b>{fmtChips(state.pot)}</b>
                    </div>
                  </div>
                )}
              </div>
              <div className="community">
                {Array.from({ length: 5 }).map((_, index) =>
                  state.community[index] ? (
                    <PlayingCard key={index} card={state.community[index]} size="lg" />
                  ) : (
                    <div key={index} className="card-slot" />
                  ),
                )}
              </div>
              {!resultVisible && (
                <div className="street-line">
                  <span className="street-name">{STREET_NAMES[state.street]}</span>
                  {state.handInProgress && state.currentBet > 0 && (
                    <span>当前注 {fmtChips(state.currentBet)}</span>
                  )}
                  {state.street === 'waiting' && state.readyCount < 2 && (
                    <span>发给朋友，凑齐 2 人开局</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {seatViews.map((seat) => {
            const pos = positions.get(seat.seat);
            if (!pos) return null;
            return (
              <Seat
                key={seat.id}
                seat={seat}
                x={pos.x}
                y={pos.y}
                active={state.toAct === seat.id && state.handInProgress}
                remainingMs={state.turnDeadline ? Math.max(0, state.turnDeadline - now) : 0}
                turnMs={state.turnMs}
                revealed={state.revealed[seat.id]}
                showResult={resultVisible}
              />
            );
          })}

          {betSeats.map((seat) => {
            const pos = positions.get(seat.seat);
            if (!pos) return null;
            const factor = seat.isYou ? 0.52 : 0.3;
            return (
              <div
                key={`chips-${seat.id}`}
                className={`bet-stack ${seat.folded ? 'is-dead' : ''}`}
                style={{
                  left: `${pos.x + (50 - pos.x) * factor}%`,
                  top: `${pos.y + (50 - pos.y) * factor}%`,
                }}
              >
                <ChipStack amount={seat.bet} />
              </div>
            );
          })}
        </div>
      </main>

      <ActionBar
        state={state}
        mySeat={mySeat}
        now={now}
        busy={busy}
        disabled={connection !== 'online'}
        onAction={act}
        onRebuy={rebuy}
      />

      <SidePanel
        open={panelOpen}
        tab={panelTab}
        unread={unread}
        log={state.log}
        chats={chats}
        myName={mySeat?.name ?? ''}
        onTab={(tab) => {
          setPanelTab(tab);
          if (tab === 'chat') setUnread(0);
        }}
        onClose={() => setPanelOpen(false)}
        onSend={sendChat}
      />

      {shareOpen && (
        <ShareModal
          code={state.code}
          onClose={() => setShareOpen(false)}
          toast={toast}
        />
      )}
    </div>
  );
}
