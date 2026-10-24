import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: GameSocket = io({
  autoConnect: false,
  reconnectionDelay: 600,
  reconnectionDelayMax: 3000,
});

export function request<T>(fn: (cb: (res: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('服务器没有响应，请确认游戏服务已启动')), 8000);
    fn((res) => {
      window.clearTimeout(timer);
      resolve(res);
    });
  });
}
