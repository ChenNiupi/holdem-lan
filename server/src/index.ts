import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import type {
  ChatMessage,
  ClientToServerEvents,
  JoinResponse,
  ServerInfo,
  ServerToClientEvents,
} from '../../shared/protocol';
import { BLIND_LEVELS } from '../../shared/protocol';
import type { Room } from './game/table';
import { RoomManager } from './rooms';

interface SocketData {
  code?: string;
  playerId?: string;
  token?: string;
  lastChatAt?: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const port = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, any, SocketData>(httpServer);
const manager = new RoomManager();
manager.onRoomChange = (room) => broadcastState(room);

function lanUrls(): string[] {
  const all: string[] = [];
  const preferred: string[] = [];
  const virtualName = /vmware|virtualbox|vethernet|hyper-v|loopback|wsl|docker|tap|tun/i;
  for (const [name, netList] of Object.entries(os.networkInterfaces())) {
    for (const net of netList ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const url = `http://${net.address}:${port}`;
      all.push(url);
      if (!virtualName.test(name)) preferred.push(url);
    }
  }
  return [...new Set(preferred.length > 0 ? preferred : all)];
}

function broadcastState(room: Room): void {
  for (const seat of room.seats) {
    if (!seat) continue;
    const socketId = manager.playerSockets.get(seat.id);
    if (!socketId) continue;
    io.sockets.sockets.get(socketId)?.emit('state', room.stateFor(seat.id));
  }
}

function broadcastChat(room: Room, msg: ChatMessage): void {
  for (const seat of room.seats) {
    if (!seat) continue;
    const socketId = manager.playerSockets.get(seat.id);
    if (!socketId) continue;
    io.sockets.sockets.get(socketId)?.emit('chat', msg);
  }
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 12);
  return name || '玩家';
}

function displayRoomCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}

function socketContext(socket: Socket<ClientToServerEvents, ServerToClientEvents, any, SocketData>): {
  room: Room;
  playerId: string;
} | null {
  const { code, playerId } = socket.data;
  if (!code || !playerId) return null;
  if (manager.playerSockets.get(playerId) !== socket.id) return null;
  const room = manager.rooms.get(code);
  if (!room) return null;
  return { room, playerId };
}

function bindSocket(
  room: Room,
  playerId: string,
  token: string,
  socket: Socket<ClientToServerEvents, ServerToClientEvents, any, SocketData>,
): void {
  const previous = manager.playerSockets.get(playerId);
  if (previous && previous !== socket.id) {
    io.sockets.sockets.get(previous)?.disconnect(true);
  }
  manager.playerSockets.set(playerId, socket.id);
  socket.data.code = room.code;
  socket.data.playerId = playerId;
  socket.data.token = token;
  void socket.join(room.code);
  room.setConnected(playerId, true, Date.now());
}

io.on('connection', (socket) => {
  socket.on('createRoom', (payload, ack) => {
    const reply = (res: JoinResponse) => {
      if (typeof ack === 'function') ack(res);
    };
    if (socketContext(socket)) return reply({ ok: false, error: '你已经在房间中' });

    const name = cleanName(payload?.name);
    const sb = Number(payload?.sb);
    const bb = Number(payload?.bb);
    const bots = Number(payload?.bots ?? 0);
    const level = BLIND_LEVELS.find((l) => l.sb === sb && l.bb === bb);
    if (!level) return reply({ ok: false, error: '盲注级别无效' });
    if (!Number.isInteger(bots) || bots < 0 || bots > 8) {
      return reply({ ok: false, error: '电脑对手数量无效' });
    }

    try {
      const { room, playerId, token } = manager.createRoom(name, level.sb, level.bb);
      for (let i = 0; i < bots; i++) room.addBot(i);
      bindSocket(room, playerId, token, socket);
      reply({ ok: true, code: room.code, token, state: room.stateFor(playerId) });
      broadcastState(room);
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : '创建房间失败' });
    }
  });

  socket.on('joinRoom', (payload, ack) => {
    const reply = (res: JoinResponse) => {
      if (typeof ack === 'function') ack(res);
    };
    if (socketContext(socket)) return reply({ ok: false, error: '你已经在房间中' });

    const code = displayRoomCode(payload?.code);
    if (code.length !== 5) return reply({ ok: false, error: '请输入 5 位房间号' });
    const name = cleanName(payload?.name);

    const result = manager.joinRoom(code, name);
    if ('error' in result) return reply({ ok: false, error: result.error });

    bindSocket(result.room, result.playerId, result.token, socket);
    reply({ ok: true, code: result.room.code, token: result.token, state: result.room.stateFor(result.playerId) });
    broadcastState(result.room);
  });

  socket.on('resume', (payload, ack) => {
    const reply = (res: JoinResponse) => {
      if (typeof ack === 'function') ack(res);
    };
    const code = displayRoomCode(payload?.code);
    const token = String(payload?.token ?? '');
    if (!code || !token) return reply({ ok: false, error: '缺少房间信息' });

    const result = manager.resume(code, token);
    if ('error' in result) return reply({ ok: false, error: result.error });

    bindSocket(result.room, result.playerId, token, socket);
    reply({ ok: true, code: result.room.code, token, state: result.room.stateFor(result.playerId) });
    broadcastState(result.room);
  });

  socket.on('action', (payload, ack) => {
    const reply = (res: { ok: boolean; error?: string }) => {
      if (typeof ack === 'function') ack(res);
    };
    const ctx = socketContext(socket);
    if (!ctx) return reply({ ok: false, error: '连接已失效，请刷新页面' });
    const type = payload?.type;
    if (!['fold', 'check', 'call', 'raise', 'allin'].includes(type)) {
      return reply({ ok: false, error: '无效操作' });
    }
    const amount = payload.amount === undefined ? undefined : Number(payload.amount);
    const res = ctx.room.act(ctx.playerId, type, amount, Date.now());
    reply(res);
    if (res.ok) broadcastState(ctx.room);
  });

  socket.on('rebuy', (ack) => {
    const reply = (res: { ok: boolean; error?: string }) => {
      if (typeof ack === 'function') ack(res);
    };
    const ctx = socketContext(socket);
    if (!ctx) return reply({ ok: false, error: '连接已失效，请刷新页面' });
    const res = ctx.room.rebuy(ctx.playerId);
    reply(res);
    if (res.ok) broadcastState(ctx.room);
  });

  socket.on('leaveRoom', (ack) => {
    const reply = (res: { ok: boolean; error?: string }) => {
      if (typeof ack === 'function') ack(res);
    };
    const ctx = socketContext(socket);
    if (!ctx) return reply({ ok: false, error: '你不在房间中' });
    const res = ctx.room.removePlayer(ctx.playerId);
    if (!res.ok) return reply(res);

    const token = socket.data.token;
    if (token) manager.sessions.delete(token);
    manager.playerSockets.delete(ctx.playerId);
    void socket.leave(ctx.room.code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
    socket.data.token = undefined;
    reply({ ok: true });

    if (!ctx.room.hasHumanSeats()) manager.disposeRoom(ctx.room.code);
    else broadcastState(ctx.room);
  });

  socket.on('chat', (payload) => {
    const ctx = socketContext(socket);
    if (!ctx) return;
    const now = Date.now();
    if (now - (socket.data.lastChatAt ?? 0) < 300) return;
    const text = String(payload?.text ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 200);
    if (!text) return;
    socket.data.lastChatAt = now;

    broadcastChat(ctx.room, {
      id: randomUUID(),
      name: manager.playerName(ctx.room, ctx.playerId),
      text,
      at: now,
    });
  });

  socket.on('disconnect', () => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) return;
    if (manager.playerSockets.get(playerId) !== socket.id) return;
    manager.playerSockets.delete(playerId);
    manager.rooms.get(code)?.setConnected(playerId, false, Date.now());
  });
});

app.get('/api/info', (_req, res) => {
  const info: ServerInfo = { lanUrls: lanUrls(), port };
  res.json(info);
});

const dist = path.join(root, 'dist');
if (existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send('<h3>前端尚未构建</h3><p>请先在项目目录运行 <code>npm run play</code>，或在开发时访问 Vite 的 5173 端口。</p>');
  });
}

setInterval(() => {
  const now = Date.now();
  for (const room of manager.rooms.values()) room.tick(now);
  manager.cleanup(now);
}, 500);

httpServer.listen(port, '0.0.0.0', () => {
  const local = `http://localhost:${port}`;
  const urls = lanUrls();
  console.log('');
  console.log('  ♠ 好友德州 · Hold\'em');
  console.log(`  本机访问   ${local}`);
  for (const url of urls) console.log(`  局域网访问 ${url}`);
  if (urls.length === 0) console.log('  未检测到局域网地址，请检查网络连接');
  console.log('');
  console.log('  朋友需要和你连同一个 Wi-Fi，打开「局域网访问」地址即可。');
  console.log('  Windows 若弹出防火墙提示，请选择「允许访问」。');
  console.log('');
});
