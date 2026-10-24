import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResponse, GameState, JoinResponse } from '../shared/protocol';
import { clearSession, loadName, loadSession, roomCodeFromLocation, saveName, saveSession, type StoredSession } from './lib';
import { request, socket } from './socket';
import { sound } from './sound';
import Home from './components/Home';
import Room from './components/Room';
import Toasts, { type ToastItem } from './components/Toasts';

type Connection = 'connecting' | 'online' | 'offline';

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => {
    const saved = loadSession();
    const invite = roomCodeFromLocation();
    if (saved && (!invite || saved.code === invite)) return saved;
    return null;
  });
  const [game, setGame] = useState<GameState | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [busy, setBusy] = useState(false);
  const [homeError, setHomeError] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [inviteCode, setInviteCode] = useState(roomCodeFromLocation);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const joiningRef = useRef(false);
  const toastTimers = useRef<number[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((text: string, kind: 'error' | 'info' = 'error') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, text, kind }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
    toastTimers.current.push(timer);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnection('online');
      const saved = sessionRef.current;
      if (!saved || joiningRef.current) return;

      request<JoinResponse>((cb) => socket.emit('resume', { code: saved.code, token: saved.token }, cb))
        .then((res) => {
          if (res.ok && res.state && res.code && res.token) {
            const next = { code: res.code, token: res.token, name: saved.name };
            saveSession(next);
            setSession(next);
            setGame(res.state);
            setHomeError('');
          } else {
            throw new Error(res.error ?? '无法恢复房间');
          }
        })
        .catch((err: Error) => {
          clearSession();
          setSession(null);
          setGame(null);
          setHomeError(err.message);
          if (window.location.pathname.startsWith('/room/')) {
            history.replaceState(null, '', '/');
          }
        });
    };

    const onDisconnect = () => setConnection('offline');
    const onConnectError = () => setConnection('offline');
    const onState = (next: GameState) => setGame(next);
    const onToast = (payload: { kind: 'error' | 'info'; text: string }) => pushToast(payload.text, payload.kind);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('state', onState);
    socket.on('toast', onToast);
    socket.connect();

    const timers = toastTimers.current;
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('state', onState);
      socket.off('toast', onToast);
      socket.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pushToast]);

  const createRoom = useCallback(async (name: string, sb: number, bb: number, bots = 0) => {
    sound.unlock();
    setBusy(true);
    setHomeError('');
    joiningRef.current = true;
    try {
      if (!socket.connected) socket.connect();
      const res = await request<JoinResponse>((cb) => socket.emit('createRoom', { name, sb, bb, bots }, cb));
      if (!res.ok || !res.state || !res.code || !res.token) {
        setHomeError(res.error ?? '创建房间失败');
        return;
      }
      const next = { code: res.code, token: res.token, name };
      saveName(name);
      saveSession(next);
      setSession(next);
      setGame(res.state);
      setInviteCode('');
      history.replaceState(null, '', `/room/${res.code}`);
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      joiningRef.current = false;
      setBusy(false);
    }
  }, []);

  const joinRoom = useCallback(async (code: string, name: string) => {
    sound.unlock();
    setBusy(true);
    setHomeError('');
    joiningRef.current = true;
    try {
      if (!socket.connected) socket.connect();
      const res = await request<JoinResponse>((cb) => socket.emit('joinRoom', { code, name }, cb));
      if (!res.ok || !res.state || !res.code || !res.token) {
        setHomeError(res.error ?? '加入房间失败');
        return;
      }
      const next = { code: res.code, token: res.token, name };
      saveName(name);
      saveSession(next);
      setSession(next);
      setGame(res.state);
      setInviteCode('');
      history.replaceState(null, '', `/room/${res.code}`);
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : '加入房间失败');
    } finally {
      joiningRef.current = false;
      setBusy(false);
    }
  }, []);

  const leaveRoom = useCallback(async () => {
    if (socket.connected) {
      try {
        const res = await request<ActionResponse>((cb) => socket.emit('leaveRoom', cb));
        if (!res.ok) {
          pushToast(res.error ?? '暂时不能离开房间');
          return;
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : '离开房间失败');
        return;
      }
    }
    clearSession();
    setSession(null);
    setGame(null);
    setInviteCode('');
    setHomeError('');
    history.replaceState(null, '', '/');
  }, [pushToast]);

  const forgetSession = () => {
    clearSession();
    setSession(null);
    setGame(null);
    setHomeError('已退出原牌桌，请重新加入');
    history.replaceState(null, '', '/');
  };

  if (!game && session) {
    return (
      <div className="splash">
        <div className="splash-mark">♠</div>
        <div className="splash-title">{connection === 'offline' ? '无法连接游戏服务' : '正在回到牌桌…'}</div>
        <p className="splash-text">
          {connection === 'offline' ? '请确认启动窗口仍在运行，然后重试。' : '正在恢复你的座位和筹码。'}
        </p>
        {connection === 'offline' && (
          <div className="splash-actions">
            <button className="btn btn-primary" onClick={() => socket.connect()}>
              重试连接
            </button>
            <button className="btn btn-ghost" onClick={forgetSession}>
              返回主页
            </button>
          </div>
        )}
        <Toasts toasts={toasts} />
      </div>
    );
  }

  return (
    <>
      {game ? (
        <Room state={game} connection={connection} onLeave={leaveRoom} toast={pushToast} />
      ) : (
        <Home
          initialCode={inviteCode}
          initialName={loadName()}
          busy={busy}
          error={homeError}
          connection={connection}
          onCreate={createRoom}
          onJoin={joinRoom}
        />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}
