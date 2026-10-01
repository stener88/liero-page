// Transport-agnostic authoritative room running the Liero simulation. Used by both the
// Node dev server and the Cloudflare Durable Object.

import { MAX_PLAYERS, PLAYER_COLORS } from '../shared/constants.ts';
import { Reassembler, decodeMap, encodeMap, toChunks } from '../shared/codec.ts';
import { FRAME_CHUNK, cleanName, PROTOCOL_VERSION, type C2S, type InputTuple, type MapHeader, type RosterEntry, type S2C } from '../shared/protocol.ts';
import { LOADOUT_SIZE } from '../shared/liero/data.ts';
import { LieroGame, newWorm, sanitizeLoadout, TICK_RATE, type Input } from '../shared/liero/game.ts';
import {
  EV_BLIT, EV_DIRT, EV_SOBJ, EV_SOUND, EV_STAIN, Writer, encodeHistory, encodeSnapshot, particleEvent, withAck, writeEvent,
  type GameEvent,
} from '../shared/liero/net.ts';

export interface Conn {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

interface Client {
  conn: Conn;
  idx: number; // worm index once said hello, else -1
  name: string;
  color: string;
  loadout: number[];
  queue: InputTuple[];
  lastInput: Input;
  ack: number;
  ready: boolean; // has received the map
  rx: Reassembler;
}

const MAX_QUEUE = 8;
const SNAPSHOT_EVERY = 2; // 35 Hz
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;

export class RoomCore {
  private clients = new Set<Client>();
  private byConn = new Map<Conn, Client>();
  private game: LieroGame | null = null;
  private header: MapHeader | null = null;
  private fg: Uint8Array | null = null;
  private bg: Uint8Array | null = null;
  private history = new Writer(); // map-changing events, for late joiners
  private events: { tick: number; e: GameEvent }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(public readonly roomId: string, private onEmpty?: () => void) {}

  get playerCount(): number {
    let n = 0;
    for (const c of this.clients) if (c.idx >= 0) n++;
    return n;
  }

  connect(conn: Conn): void {
    const c: Client = { conn, idx: -1, name: '', color: '', loadout: [], queue: [], lastInput: { k: 0, a: 96, w: 0 }, ack: 0, ready: false, rx: new Reassembler() };
    this.clients.add(c);
    this.byConn.set(conn, c);
  }

  disconnect(conn: Conn): void {
    const c = this.byConn.get(conn);
    if (!c) return;
    this.byConn.delete(conn);
    this.clients.delete(c);
    if (c.idx >= 0 && this.game) {
      this.game.worms = this.game.worms.filter((w) => w.idx !== c.idx);
      for (const w of this.game.worms) if (w.rope.anchor === c.idx) w.rope.anchor = -1;
      this.broadcast({ t: 'leave', i: c.idx, n: c.name });
      this.sendRoster();
    }
    if (this.clients.size === 0) {
      this.stop();
      this.game = null;
      this.header = null;
      this.fg = this.bg = null;
      this.history = new Writer();
      this.events = [];
      this.onEmpty?.();
    }
  }

  async message(conn: Conn, data: string | ArrayBuffer | Uint8Array): Promise<void> {
    const c = this.byConn.get(conn);
    if (!c) return;
    try {
      if (typeof data !== 'string') {
        const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (buf[0] !== FRAME_CHUNK || this.game) return;
        const whole = c.rx.push(buf);
        if (whole) await this.onTerrain(c, whole);
        return;
      }
      const msg = JSON.parse(data) as C2S;
      switch (msg.t) {
        case 'hello': return this.onHello(c, msg);
        case 'in': return this.onInput(c, msg.i);
        case 'loadout': {
          c.loadout = sanitizeLoadout(msg.l);
          const w = this.game?.wormByIdx(c.idx);
          if (w) w.loadout = c.loadout.slice(0, LOADOUT_SIZE); // applies on next respawn
          return;
        }
        case 'name': {
          if (c.idx < 0) return;
          c.name = cleanName(msg.n);
          if (c.ready) this.sendRoster();
          return;
        }
        case 'ping': return this.send(c, { t: 'pong', c: msg.c });
      }
    } catch (err) {
      console.error(`[room ${this.roomId}]`, err);
      this.send(c, { t: 'err', m: String((err as Error)?.message ?? err) });
    }
  }

  private onHello(c: Client, msg: Extract<C2S, { t: 'hello' }>): void {
    if (c.idx >= 0) return;
    if (msg.v !== PROTOCOL_VERSION) { this.send(c, { t: 'err', m: 'Version mismatch — update the extension.' }); c.conn.close(4000, 'version'); return; }
    const used = new Set([...this.clients].map((o) => o.idx));
    let idx = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) { idx = i; break; }
    if (idx < 0) { this.send(c, { t: 'err', m: 'Room is full.' }); c.conn.close(4001, 'full'); return; }
    c.idx = idx;
    c.name = cleanName(msg.name);
    c.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    c.loadout = sanitizeLoadout(msg.lo);
    this.send(c, { t: 'welcome', id: idx, color: c.color, needTerrain: !this.game, tick: this.game?.cycles ?? 0 });
    if (this.game) void this.admit(c).catch((e) => console.error(`[room ${this.roomId}] admit`, e));
  }

  /** Put a client into the running game: map + history, then spawn their worm. */
  private async admit(c: Client): Promise<void> {
    const game = this.game;
    if (!game || !this.header || !this.fg || !this.bg || c.idx < 0) return;
    const mask = game.t.data.slice();
    const hist = encodeHistory(this.history.done());
    if (!game.wormByIdx(c.idx)) game.worms.push(newWorm(c.idx, c.loadout));
    this.broadcast({ t: 'join', i: c.idx, n: c.name });
    const frame = await encodeMap({ header: this.header, mask, fg: this.fg, bg: this.bg });
    if (!this.clients.has(c)) return;
    for (const ch of toChunks(frame)) c.conn.send(ch);
    for (const ch of toChunks(hist)) c.conn.send(ch);
    c.ready = true;
    this.sendRoster();
  }

  private sendRoster() {
    const p: RosterEntry[] = [...this.clients].filter((c) => c.idx >= 0).map((c) => ({ i: c.idx, n: c.name, c: c.color }));
    this.broadcast({ t: 'roster', p });
  }

  private record(e: GameEvent) {
    const game = this.game!;
    this.events.push({ tick: game.cycles, e });
    if ((e.k === EV_DIRT || e.k === EV_BLIT || e.k === EV_STAIN) && this.history.o < MAX_HISTORY_BYTES) writeEvent(this.history, e);
  }

  private async onTerrain(c: Client, buf: Uint8Array): Promise<void> {
    if (this.game || c.idx < 0) return; // first map wins
    const { header, terrain, fg, bg } = await decodeMap(buf);
    console.log(`[room ${this.roomId}] map ${header.w}x${header.h} @${header.scale}x, ${(buf.length / 1024).toFixed(0)} KB — ${header.url}`);
    if (this.game) return; // raced with another uploader
    for (let i = 0; i < terrain.data.length; i++) if (terrain.data[i]) terrain.data[i] = 1;
    header.title = String(header.title ?? '').slice(0, 200);
    header.url = String(header.url ?? '').slice(0, 2000);
    this.header = header;
    this.fg = fg;
    this.bg = bg;
    this.game = new LieroGame(terrain, {
      sound: (s, x, y, w, launch) => this.record({ k: EV_SOUND, dt: 0, s, x, y, w, launch }),
      sobj: (t, x, y) => this.record({ k: EV_SOBJ, dt: 0, t, x, y }),
      dirt: (e, x, y, f) => this.record({ k: EV_DIRT, dt: 0, e, x, y, f }),
      blit: (s, x, y) => this.record({ k: EV_BLIT, dt: 0, s, x, y }),
      stain: (x, y, cc) => this.record({ k: EV_STAIN, dt: 0, x, y, c: cc }),
      particle: (n) => this.record(particleEvent(n)),
      frag: (k, v) => {
        const kw = this.game?.wormByIdx(k);
        this.broadcast({ t: 'frag', k, v, w: kw?.weapons[kw.cur]?.type ?? -1 });
      },
    });
    this.start();
    // Everyone who said hello before the map existed joins now.
    for (const o of this.clients) if (o.idx >= 0 && !o.ready) void this.admit(o).catch((e) => console.error(`[room ${this.roomId}] admit`, e));
  }

  private onInput(c: Client, list: InputTuple[]): void {
    if (c.idx < 0 || !Array.isArray(list)) return;
    for (const t of list.slice(0, 24)) {
      if (!Array.isArray(t) || t.length !== 4 || !(t[0] > c.ack)) continue;
      c.queue.push([t[0] | 0, t[1] & 127, +t[2] || 0, Math.min(LOADOUT_SIZE - 1, Math.max(0, t[3] | 0))]);
    }
    // Clients that run ahead get trimmed so latency doesn't pile up.
    if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
  }

  private start(): void {
    if (this.timer) return;
    const dt = 1000 / TICK_RATE;
    let next = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      let n = 0;
      while (next <= now && n < 4) { this.tick(); next += dt; n++; }
      if (now - next > 250) next = now;
    }, 4);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const game = this.game;
    if (!game) return;
    const inputs = new Map<number, Input>();
    for (const c of this.clients) {
      if (c.idx < 0 || !c.ready) continue;
      const t = c.queue.shift();
      if (t) {
        c.ack = t[0];
        c.lastInput = { k: t[1], a: t[2], w: t[3] };
      }
      inputs.set(c.idx, c.lastInput);
    }
    game.step(inputs);
    if (game.cycles % SNAPSHOT_EVERY === 0) this.snapshot();
  }

  private snapshot(): void {
    const game = this.game!;
    const tick = game.cycles;
    const ev = this.events.map(({ tick: t, e }) => ({ ...e, dt: tick - t }));
    this.events = [];
    const w = game.wobjects.map((o) => ({ id: o.id, t: o.type.id, x: o.x >> 16, y: o.y >> 16, f: o.frame }));
    const n = game.nobjects.filter((o) => !o.cosmetic).map((o) => ({ id: o.id, t: o.type.id, x: o.x >> 16, y: o.y >> 16, f: o.frame }));
    const body = encodeSnapshot(tick, game.worms, w, n, ev);
    for (const c of this.clients) {
      if (c.ready) c.conn.send(withAck(body, c.ack));
    }
  }

  private send(c: Client, msg: S2C): void {
    c.conn.send(JSON.stringify(msg));
  }

  private broadcast(msg: S2C): void {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.idx >= 0) c.conn.send(s);
  }
}
