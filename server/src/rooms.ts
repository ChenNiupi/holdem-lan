import { randomBytes, randomInt } from 'node:crypto';
import { Room } from './game/table';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const IDLE_ROOM_MS = 15 * 60_000;
const BOT_ROOM_IDLE_MS = 3 * 60_000;

interface Session {
  code: string;
  playerId: string;
  name: string;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  sessions = new Map<string, Session>();
  playerSockets = new Map<string, string>();
  onRoomChange: (room: Room) => void = () => {};

  private idleSince = new Map<string, number>();

  private newCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('无法生成房间号，请重试');
  }

  createRoom(name: string, sb: number, bb: number): { room: Room; playerId: string; token: string } {
    const code = this.newCode();
    const playerId = randomBytes(8).toString('hex');
    const room = new Room(code, playerId, sb, bb);
    room.onChange = () => this.onRoomChange(room);

    const res = room.addPlayer(playerId, name);
    if (!res.ok) throw new Error(res.error);
    this.rooms.set(code, room);

    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, { code, playerId, name });
    return { room, playerId, token };
  }

  joinRoom(code: string, name: string): { room: Room; playerId: string; token: string } | { error: string } {
    const room = this.rooms.get(code);
    if (!room) return { error: '房间不存在或已关闭' };

    const playerId = randomBytes(8).toString('hex');
    const res = room.addPlayer(playerId, name);
    if (!res.ok) return { error: res.error ?? '无法加入房间' };

    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, { code, playerId, name });
    return { room, playerId, token };
  }

  resume(code: string, token: string): { room: Room; playerId: string; name: string } | { error: string } {
    const session = this.sessions.get(token);
    if (!session || session.code !== code) return { error: '登录状态已失效，请重新加入房间' };
    const room = this.rooms.get(code);
    if (!room) return { error: '房间已关闭' };
    const seat = room.seats.find((s) => s?.id === session.playerId);
    if (!seat) return { error: '你的座位已不存在' };
    return { room, playerId: session.playerId, name: session.name };
  }

  playerName(room: Room, playerId: string): string {
    return room.seats.find((s) => s?.id === playerId)?.name ?? '玩家';
  }

  disposeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.onChange = () => {};
    this.rooms.delete(code);
    this.idleSince.delete(code);
    for (const seat of room.seats) {
      if (seat) this.playerSockets.delete(seat.id);
    }
    for (const [token, session] of this.sessions) {
      if (session.code === code) this.sessions.delete(token);
    }
  }

  cleanup(now: number): void {
    for (const [code, room] of this.rooms) {
      const humans = room.seats.filter((seat) => seat && !seat.isBot);
      if (humans.length === 0) {
        this.disposeRoom(code);
        continue;
      }
      if (humans.some((seat) => seat!.connected)) {
        this.idleSince.delete(code);
        continue;
      }
      const since = this.idleSince.get(code) ?? now;
      this.idleSince.set(code, since);
      const hasBots = room.seats.some((seat) => seat?.isBot);
      const idleLimit = hasBots ? BOT_ROOM_IDLE_MS : IDLE_ROOM_MS;
      if (now - since > idleLimit) this.disposeRoom(code);
    }
  }
}
