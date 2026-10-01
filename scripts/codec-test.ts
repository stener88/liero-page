// Map chunking + Liero snapshot codec round-trips.
import assert from 'node:assert/strict';
import { Reassembler, decodeMap, encodeMap, toChunks } from '../shared/codec.ts';
import { Terrain } from '../shared/terrain.ts';
import { LieroGame, newWorm } from '../shared/liero/game.ts';
import { EV_DIRT, EV_SOUND, decodeSnapshot, encodeSnapshot, withAck, type GameEvent } from '../shared/liero/net.ts';

const t = new Terrain(400, 300, new Uint8Array(400 * 300).map((_, i) => (i > 400 * 200 ? 1 : 0)));
const fg = new Uint8Array(700_000).map((_, i) => i * 7);
const buf = await encodeMap({ header: { w: t.w, h: t.h, scale: 2, fgLen: 0, bgLen: 0, title: 'x', url: 'y' }, mask: t.data, fg, bg: new Uint8Array(0) });
const rx = new Reassembler();
let whole: Uint8Array | null = null;
for (const c of toChunks(buf)) whole = rx.push(c) ?? whole;
const m = await decodeMap(whole!);
assert.deepEqual(m.terrain.data, t.data);
assert.deepEqual(m.fg, fg);
console.log('  ok map codec + chunking');

const g = new LieroGame(t, {}, 5);
g.worms.push(newWorm(0), newWorm(3, [1, 2, 3, 4, 5]));
for (let i = 0; i < 100; i++) g.step(new Map());
const ev: GameEvent[] = [{ k: EV_DIRT, dt: 1, e: 0, x: 10, y: -3, f: 1 }, { k: EV_SOUND, dt: 0, s: 9, x: 5, y: 6, w: -1, launch: false }];
const snap = withAck(encodeSnapshot(g.cycles, g.worms, [{ id: 7, t: 3, x: 100, y: 50, f: 96 }], [{ id: 9, t: 2, x: 1, y: 2, f: 256 }], ev), 1234);
const d = decodeSnapshot(snap);
assert.equal(d.tick, g.cycles);
assert.equal(d.ack, 1234);
assert.equal(d.worms.length, 2);
for (const k of ['x', 'y', 'vx', 'vy', 'aim', 'health', 'cur', 'kills', 'frame'] as const) assert.equal(d.worms[1][k], g.worms[1][k], k);
assert.deepEqual(d.worms[1].weapons, g.worms[1].weapons);
assert.equal(d.w[0].f, 96);
assert.equal(d.n[0].f, 256);
assert.deepEqual(d.ev, ev);
console.log(`  ok snapshot codec (${snap.length} bytes for 2 worms)`);
