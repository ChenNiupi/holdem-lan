import { useState } from 'react';
import { BLIND_LEVELS } from '../../shared/protocol';
import { fmtChips } from '../lib';

interface Props {
  initialCode: string;
  initialName: string;
  busy: boolean;
  error: string;
  connection: 'connecting' | 'online' | 'offline';
  onCreate: (name: string, sb: number, bb: number, bots?: number) => void;
  onJoin: (code: string, name: string) => void;
}

const BOT_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function Home({ initialCode, initialName, busy, error, connection, onCreate, onJoin }: Props) {
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState<'create' | 'join' | 'bots'>(initialCode ? 'join' : 'create');
  const [code, setCode] = useState(initialCode);
  const [level, setLevel] = useState(0);
  const [botCount, setBotCount] = useState(3);
  const [localError, setLocalError] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('先给自己起个昵称');
      return;
    }
    if (mode === 'join') {
      if (code.length !== 5) {
        setLocalError('房间号是 5 位字符');
        return;
      }
      setLocalError('');
      onJoin(code, trimmed);
      return;
    }
    const blinds = BLIND_LEVELS[level];
    setLocalError('');
    onCreate(trimmed, blinds.sb, blinds.bb, mode === 'bots' ? botCount : 0);
  };

  const message = localError || error;
  const buttonLabel =
    mode === 'join'
      ? busy
        ? '正在入座…'
        : '加入房间'
      : mode === 'bots'
        ? busy
          ? '正在开桌…'
          : `开始人机对战 · ${botCount} 位 AI`
        : busy
          ? '正在开桌…'
          : '创建房间';

  return (
    <div className="home">
      <div className="home-aura" />
      <div className="home-suits" aria-hidden="true">
        <span>♠</span>
        <span>♥</span>
        <span>♦</span>
        <span>♣</span>
      </div>

      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">♠</span>
          <span className="brand-name">好友德州</span>
          <span className="brand-sub">HOLD'EM</span>
        </div>
        <span className={`server-status status-${connection}`}>
          <i />
          {connection === 'online' ? '服务已连接' : connection === 'offline' ? '未连接服务' : '正在连接…'}
        </span>
      </header>

      <main className="home-main">
        <section className="home-copy">
          <p className="eyebrow">局域网 · 好友局 · 虚拟筹码</p>
          <h1>
            开一桌，
            <br />
            等朋友上线。
          </h1>
          <p className="lede">
            服务跑在你的电脑上，同一 Wi-Fi 打开链接就能坐下。发牌、下注、边池全部由服务端结算。
          </p>
          <ul className="feature-list">
            <li>
              <b>2–9 人</b>
              <span>无限注现金桌</span>
            </li>
            <li>
              <b>1–8 位</b>
              <span>AI 陪练</span>
            </li>
            <li>
              <b>30 秒</b>
              <span>行动倒计时</span>
            </li>
            <li>
              <b>断线</b>
              <span>自动重连回座</span>
            </li>
          </ul>
        </section>

        <section className="home-card">
          <div className="field">
            <label htmlFor="nickname">你的昵称</label>
            <input
              id="nickname"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 12))}
              placeholder="例如：小李"
              maxLength={12}
              autoComplete="off"
              autoFocus
            />
          </div>

          {initialCode ? (
            <div className="invite-pill">
              收到邀请 · 房间 <b>{initialCode}</b>
            </div>
          ) : (
            <div className="segmented" role="tablist">
              <button
                type="button"
                className={mode === 'create' ? 'active' : ''}
                onClick={() => {
                  setMode('create');
                  setLocalError('');
                }}
              >
                创建房间
              </button>
              <button
                type="button"
                className={mode === 'join' ? 'active' : ''}
                onClick={() => {
                  setMode('join');
                  setLocalError('');
                }}
              >
                加入房间
              </button>
              <button
                type="button"
                className={mode === 'bots' ? 'active' : ''}
                onClick={() => {
                  setMode('bots');
                  setLocalError('');
                }}
              >
                人机对战
              </button>
            </div>
          )}

          <form onSubmit={submit}>
            {mode === 'join' ? (
              <div className="field">
                <label htmlFor="room-code">房间号</label>
                <input
                  id="room-code"
                  className="code-input"
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                        .slice(0, 5),
                    )
                  }
                  placeholder="ABCDE"
                  maxLength={5}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="field">
                <label>盲注级别</label>
                <div className="blind-grid">
                  {BLIND_LEVELS.map((blinds, index) => (
                    <button
                      type="button"
                      key={blinds.bb}
                      className={`blind-option ${index === level ? 'selected' : ''}`}
                      onClick={() => setLevel(index)}
                    >
                      <span className="blind-num">
                        {blinds.sb}/{blinds.bb}
                      </span>
                      <span className="blind-buyin">买入 {fmtChips(blinds.buyIn)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'bots' && (
              <div className="field">
                <label>电脑对手</label>
                <div className="bot-grid">
                  {BOT_COUNTS.map((count) => (
                    <button
                      type="button"
                      key={count}
                      className={`bot-option ${count === botCount ? 'selected' : ''}`}
                      onClick={() => setBotCount(count)}
                    >
                      <b>{count}</b>
                      <span>位</span>
                    </button>
                  ))}
                </div>
                <p className="bot-hint">AI 会像真人一样自动行动；有空位时朋友也能加入同桌。</p>
              </div>
            )}

            <button className="btn btn-primary btn-block" disabled={busy}>
              {buttonLabel}
            </button>
          </form>

          {message && <div className="form-error">{message}</div>}

          <p className="fine-print">
            {connection === 'offline'
              ? '连接不到游戏服务，请确认启动窗口仍在运行。'
              : '同一 Wi-Fi 下，把房间链接发给朋友即可加入。'}
          </p>
        </section>
      </main>

      <footer className="home-footer">仅供朋友间娱乐 · 请勿用于任何形式的赌博</footer>
    </div>
  );
}
