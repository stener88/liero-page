// Binary snapshot + event codec for the Liero game.

import { NOBJECTS } from './data.ts';
import type { LWorm, NObject } from './game.ts';

export const FRAME_SNAP = 3;
export const FRAME_HIST = 4;

export const EV_SOBJ = 1, EV_DIRT = 2, EV_BLIT = 3, EV_STAIN = 4, EV_SOUND = 5, EV_PARTICLE = 6;

export type GameEvent =
  | { k: typeof EV_SOBJ; dt: number; t: number; x: number; y: number }
  | { k: typeof EV_DIRT; dt: number; e: number; x: number; y: number; f: number }
  | { k: typeof EV_BLIT; dt: number; s: number; x: number; y: number }
  | { k: typeof EV_STAIN; dt: number; x: number; y: number; c: number }
  | { k: typeof EV_SOUND; dt: number; s: number; x: number; y: number; w: number; launch: boolean }
  | { k: typeof EV_PARTICLE; dt: number; t: number; x: number; y: number; vx: number; vy: number; f: number };

export interface WObjNet { id: number; t: number; x: number; y: number; f: number }
export interface NObjNet { id: number; t: number; x: number; y: number; f: number }

export interface Snapshot {
  tick: number;
  ack: number;
  worms: LWorm[];
  w: WObjNet[];
  n: NObjNet[];
  ev: GameEvent[];
}

export class Writer {
  buf = new Uint8Array(4096);
  dv = new DataView(this.buf.buffer);
  o = 0;
  private need(n: number) {
    if (this.o + n <= this.buf.length) return;
    let len = this.buf.length * 2;
    while (len < this.o + n) len *= 2;
    const b = new Uint8Array(len);
    b.set(this.buf);
    this.buf = b;
    this.dv = new DataView(b.buffer);
  }
  u8(v: number) { this.need(1); this.dv.setUint8(this.o, v); this.o += 1; }
  i8(v: number) { this.need(1); this.dv.setInt8(this.o, Math.max(-128, Math.min(127, v))); this.o += 1; }
  u16(v: number) { this.need(2); this.dv.setUint16(this.o, v, true); this.o += 2; }
  i16(v: number) { this.need(2); this.dv.setInt16(this.o, Math.max(-32768, Math.min(32767, v | 0)), true); this.o += 2; }
  i32(v: number) { this.need(4); this.dv.setInt32(this.o, v | 0, true); this.o += 4; }
  bytes(b: Uint8Array) { this.need(b.length); this.buf.set(b, this.o); this.o += b.length; }
  done() { return this.buf.slice(0, this.o); }
}

export class Reader {
  dv: DataView;
  o = 0;
  constructor(public buf: Uint8Array) { this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u8() { const v = this.dv.getUint8(this.o); this.o += 1; return v; }
  i8() { const v = this.dv.getInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i16() { const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  i32() { const v = this.dv.getInt32(this.o, true); this.o += 4; return v; }
  get left() { return this.buf.length - this.o; }
}

// ---- worms -------------------------------------------------------------------------
export function writeWorm(wr: Writer, w: LWorm) {
  wr.u8(w.idx);
  wr.u16(
    (w.visible ? 1 : 0) | (w.rope.out ? 2 : 0) | (w.rope.attached ? 4 : 0) | (w.dir ? 8 : 0) |
    (w.animate ? 16 : 0) | (w.movable ? 32 : 0) | (w.ableToJump ? 64 : 0) | (w.ableToDig ? 128 : 0),
  );
  wr.i32(w.x); wr.i32(w.y); wr.i32(w.vx); wr.i32(w.vy); wr.i32(w.aim);
  wr.i16(w.health); wr.i16(w.killedTimer); wr.u8(w.cur);
  wr.u8(w.weapons.length);
  for (const ww of w.weapons) { wr.u8(ww.type); wr.u8(ww.ammo); wr.i16(ww.delayLeft); wr.i16(ww.loadingLeft); }
  wr.u8(w.fireCone); wr.u8(w.leaveShellTimer);
  const r = w.rope;
  wr.i32(r.x); wr.i32(r.y); wr.i32(r.vx); wr.i32(r.vy); wr.i32(r.length); wr.i32(r.curLen); wr.i8(r.anchor);
  wr.u8(w.frame); wr.u8(w.keys); wr.u8(w.pk); wr.i16(w.kills); wr.i16(w.deaths);
  for (let i = 0; i < 4; i++) wr.u8(Math.min(255, w.reacts[i]));
}

export function readWorm(rd: Reader, into?: LWorm): LWorm {
  const w = into ?? ({ rope: {}, reacts: [0, 0, 0, 0], weapons: [], loadout: [] } as unknown as LWorm);
  w.idx = rd.u8();
  const f = rd.u16();
  w.visible = !!(f & 1); w.dir = f & 8 ? 1 : 0; w.animate = !!(f & 16); w.movable = !!(f & 32);
  w.ableToJump = !!(f & 64); w.ableToDig = !!(f & 128);
  w.x = rd.i32(); w.y = rd.i32(); w.vx = rd.i32(); w.vy = rd.i32(); w.aim = rd.i32();
  w.health = rd.i16(); w.killedTimer = rd.i16(); w.cur = rd.u8();
  const nw = rd.u8();
  w.weapons = [];
  for (let i = 0; i < nw; i++) w.weapons.push({ type: rd.u8(), ammo: rd.u8(), delayLeft: rd.i16(), loadingLeft: rd.i16() });
  w.loadout = w.weapons.map((x) => x.type);
  w.fireCone = rd.u8(); w.leaveShellTimer = rd.u8();
  w.rope = { out: !!(f & 2), attached: !!(f & 4), x: rd.i32(), y: rd.i32(), vx: rd.i32(), vy: rd.i32(), length: rd.i32(), curLen: rd.i32(), anchor: rd.i8() };
  w.frame = rd.u8(); w.keys = rd.u8(); w.pk = rd.u8(); w.kills = rd.i16(); w.deaths = rd.i16();
  w.reacts = [rd.u8(), rd.u8(), rd.u8(), rd.u8()];
  w.lastKilledBy = -1; w.hurtCooldown = 0;
  return w;
}

// ---- events ------------------------------------------------------------------------
export function writeEvent(wr: Writer, e: GameEvent) {
  wr.u8(e.k); wr.u8(Math.max(0, Math.min(255, e.dt)));
  switch (e.k) {
    case EV_SOBJ: wr.u8(e.t); wr.i16(e.x); wr.i16(e.y); break;
    case EV_DIRT: wr.u8(e.e); wr.i16(e.x); wr.i16(e.y); wr.u8(e.f); break;
    case EV_BLIT: wr.u8(e.s); wr.i16(e.x); wr.i16(e.y); break;
    case EV_STAIN: wr.i16(e.x); wr.i16(e.y); wr.u8(e.c); break;
    case EV_SOUND: wr.u8(e.s); wr.i16(e.x); wr.i16(e.y); wr.u8(e.w < 0 ? 255 : e.w); wr.u8(e.launch ? 1 : 0); break;
    case EV_PARTICLE: wr.u8(e.t); wr.i32(e.x); wr.i32(e.y); wr.i32(e.vx); wr.i32(e.vy); wr.u16(e.f); break;
  }
}

export function readEvent(rd: Reader): GameEvent {
  const k = rd.u8(), dt = rd.u8();
  switch (k) {
    case EV_SOBJ: return { k, dt, t: rd.u8(), x: rd.i16(), y: rd.i16() };
    case EV_DIRT: return { k, dt, e: rd.u8(), x: rd.i16(), y: rd.i16(), f: rd.u8() };
    case EV_BLIT: return { k, dt, s: rd.u8(), x: rd.i16(), y: rd.i16() };
    case EV_STAIN: return { k, dt, x: rd.i16(), y: rd.i16(), c: rd.u8() };
    case EV_SOUND: { const s = rd.u8(), x = rd.i16(), y = rd.i16(), w = rd.u8(); return { k, dt, s, x, y, w: w === 255 ? -1 : w, launch: rd.u8() === 1 }; }
    case EV_PARTICLE: return { k, dt, t: rd.u8(), x: rd.i32(), y: rd.i32(), vx: rd.i32(), vy: rd.i32(), f: rd.u16() };
  }
  throw new Error(`bad event ${k}`);
}

export const particleEvent = (n: NObject, dt = 0): GameEvent => ({ k: EV_PARTICLE, dt, t: n.type.id, x: n.x, y: n.y, vx: n.vx, vy: n.vy, f: n.frame });

// ---- snapshot ----------------------------------------------------------------------
/** Body shared by all clients; the per-client ack is patched in at byte 5. */
export function encodeSnapshot(tick: number, worms: LWorm[], w: WObjNet[], n: NObjNet[], ev: GameEvent[]): Uint8Array {
  const wr = new Writer();
  wr.u8(FRAME_SNAP); wr.i32(tick); wr.i32(0);
  wr.u8(worms.length);
  for (const x of worms) writeWorm(wr, x);
  wr.u16(w.length);
  for (const o of w) { wr.u16(o.id); wr.u8(o.t); wr.i16(o.x); wr.i16(o.y); wr.u8(o.f & 255); }
  wr.u16(n.length);
  for (const o of n) { wr.u16(o.id); wr.u8(o.t); wr.i16(o.x); wr.i16(o.y); wr.u16(o.f); }
  wr.u16(ev.length);
  for (const e of ev) writeEvent(wr, e);
  return wr.done();
}

export function withAck(snap: Uint8Array, ack: number): Uint8Array {
  const out = snap.slice();
  new DataView(out.buffer).setInt32(5, ack, true);
  return out;
}

export function decodeSnapshot(buf: Uint8Array): Snapshot {
  const rd = new Reader(buf);
  if (rd.u8() !== FRAME_SNAP) throw new Error('not a snapshot');
  const tick = rd.i32(), ack = rd.i32();
  const worms: LWorm[] = [];
  for (let i = rd.u8(); i > 0; i--) worms.push(readWorm(rd));
  const w: WObjNet[] = [];
  for (let i = rd.u16(); i > 0; i--) w.push({ id: rd.u16(), t: rd.u8(), x: rd.i16(), y: rd.i16(), f: rd.u8() });
  const n: NObjNet[] = [];
  for (let i = rd.u16(); i > 0; i--) n.push({ id: rd.u16(), t: rd.u8(), x: rd.i16(), y: rd.i16(), f: rd.u16() });
  const ev: GameEvent[] = [];
  for (let i = rd.u16(); i > 0; i--) ev.push(readEvent(rd));
  return { tick, ack, worms, w, n, ev };
}

/** Map-changing history for late joiners: just the events, no ticks. */
export function encodeHistory(events: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + events.length);
  out[0] = FRAME_HIST;
  out.set(events, 1);
  return out;
}

export function decodeHistory(buf: Uint8Array): GameEvent[] {
  const rd = new Reader(buf);
  rd.u8();
  const out: GameEvent[] = [];
  while (rd.left > 0) out.push(readEvent(rd));
  return out;
}

export const nobjType = (id: number) => NOBJECTS[id];
