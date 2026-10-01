// Headless checks for the Liero port on a page-like map.
import assert from 'node:assert/strict';
import { Terrain } from '../shared/terrain.ts';
import { LieroGame, newWorm, K_FIRE, K_RIGHT, K_ROPE, K_JUMP, K_UP, type Input } from '../shared/liero/game.ts';
import { WEAPONS, ftoi, itof } from '../shared/liero/data.ts';

function page(): Terrain {
  const w = 600, h = 400, d = new Uint8Array(w * h);
  for (let y = 300; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = 1; // floor ("footer")
  for (let y = 80; y < 100; y++) for (let x = 100; x < 500; x++) d[y * w + x] = 1; // a headline
  return new Terrain(w, h, d);
}

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('  ok', name); };
const counts = { sound: 0, sobj: 0, dirt: 0, frag: 0, particle: 0, stain: 0 };
const ev = {
  sound: () => counts.sound++, sobj: () => counts.sobj++, dirt: () => counts.dirt++,
  frag: () => counts.frag++, particle: () => counts.particle++, stain: () => counts.stain++,
};

test('worm spawns, falls and stands on the floor', () => {
  const g = new LieroGame(page(), ev, 7);
  const w = newWorm(0); g.worms.push(w);
  for (let i = 0; i < 300; i++) g.step(new Map());
  assert.ok(w.visible);
  assert.ok(w.reacts[2] > 0, 'standing on ground');
  assert.ok(Math.abs(w.vy) < 2000, `settled vy ${w.vy}`);
});

test('walking right moves the worm', () => {
  const g = new LieroGame(page(), ev, 7);
  const w = newWorm(0); g.worms.push(w);
  for (let i = 0; i < 200; i++) g.step(new Map());
  w.x = itof(200); w.y = itof(294); w.vx = w.vy = 0;
  for (let i = 0; i < 100; i++) g.step(new Map());
  const x0 = ftoi(w.x);
  for (let i = 0; i < 70; i++) g.step(new Map([[0, { k: K_RIGHT, a: 96, w: 0 }]]));
  assert.ok(ftoi(w.x) > x0 + 20, `walked ${ftoi(w.x) - x0}px`);
});

test('ninja rope attaches to the headline and pulls the worm up', () => {
  const g = new LieroGame(page(), ev, 7);
  const w = newWorm(0); g.worms.push(w);
  for (let i = 0; i < 200; i++) g.step(new Map());
  w.x = itof(300); w.y = itof(294); w.vx = w.vy = 0;
  for (let i = 0; i < 50; i++) g.step(new Map());
  const up = 64; // Liero angle: straight up
  g.step(new Map([[0, { k: K_ROPE, a: up, w: 0 }]]));
  for (let i = 0; i < 90 && !w.rope.attached; i++) g.step(new Map([[0, { k: 0, a: up, w: 0 }]]));
  assert.ok(w.rope.attached, 'rope attached');
  for (let i = 0; i < 90; i++) g.step(new Map([[0, { k: K_UP, a: up, w: 0 }]]));
  assert.ok(ftoi(w.y) < 250, `pulled up to y=${ftoi(w.y)}`);
});

test('bazooka hits the headline: explosion, dirt removed, page carved', () => {
  const t = page();
  const g = new LieroGame(t, ev, 7);
  const w = newWorm(0, [3, 14, 10, 0, 29]); g.worms.push(w);
  for (let i = 0; i < 200; i++) g.step(new Map());
  w.x = itof(300); w.y = itof(294); w.vx = w.vy = 0;
  for (let i = 0; i < 30; i++) g.step(new Map());
  const before = t.data.reduce((s, v) => s + v, 0);
  counts.sobj = counts.dirt = 0;
  g.step(new Map([[0, { k: K_FIRE, a: 64, w: 0 }]]));
  for (let i = 0; i < 200; i++) g.step(new Map([[0, { k: 0, a: 64, w: 0 }]]));
  const after = t.data.reduce((s, v) => s + v, 0);
  assert.ok(counts.sobj > 0, 'explosion spawned');
  assert.ok(after < before, `terrain carved (${before - after} px)`);
});

test('two worms: minigun kills, frag recorded, respawn after 150 ticks', () => {
  const g = new LieroGame(page(), ev, 7);
  const a = newWorm(0, [14, 3, 10, 0, 29]), b = newWorm(1); g.worms.push(a, b);
  for (let i = 0; i < 200; i++) g.step(new Map());
  a.x = itof(200); a.y = itof(294); b.x = itof(260); b.y = itof(294);
  a.vx = a.vy = b.vx = b.vy = 0;
  counts.frag = 0;
  let ticks = 0;
  while (b.visible && ticks < 3000) {
    a.x = itof(200); a.y = itof(294); a.vx = a.vy = 0; a.health = 100;
    if (b.visible) { b.x = itof(260); b.y = itof(294); }
    g.step(new Map([[0, { k: K_FIRE, a: 96, w: 0 }]]));
    ticks++;
  }
  assert.ok(!b.visible, `b dead after ${ticks} ticks`);
  assert.equal(a.kills, 1);
  assert.equal(counts.frag, 1);
  for (let i = 0; i < 160; i++) g.step(new Map());
  assert.ok(b.visible, 'b respawned');
});

test('every weapon fires without crashing', () => {
  for (let id = 0; id < WEAPONS.length; id++) {
    const g = new LieroGame(page(), ev, id + 1);
    const w = newWorm(0, [id]); g.worms.push(w);
    const o = newWorm(1); g.worms.push(o);
    for (let i = 0; i < 200; i++) g.step(new Map());
    for (let i = 0; i < 600; i++) {
      const inp: Input = { k: i % 40 < 30 ? K_FIRE : (i % 80 === 0 ? K_JUMP : 0), a: 70 + (i % 40), w: 0 };
      g.step(new Map([[0, inp]]));
    }
    assert.ok(g.wobjects.length <= 600 && g.nobjects.length <= 600);
  }
  console.log(`    (sounds ${counts.sound}, explosions ${counts.sobj}, dirt ${counts.dirt}, particles ${counts.particle}, stains ${counts.stain})`);
});

test('prediction replays a worm deterministically', () => {
  const t = page();
  const g = new LieroGame(t, {}, 3);
  const w = newWorm(0); g.worms.push(w);
  for (let i = 0; i < 200; i++) g.step(new Map());
  const p1 = new LieroGame(t, {}, 1), p2 = new LieroGame(t, {}, 2);
  const a = structuredClone(w), b = structuredClone(w);
  const inputs: Input[] = Array.from({ length: 120 }, (_, i) => ({ k: i % 30 < 20 ? K_RIGHT : K_JUMP, a: 80, w: 1 }));
  for (const i of inputs) { p1.predictWorm(a, i); p2.predictWorm(b, i); }
  assert.equal(a.x, b.x); assert.equal(a.y, b.y);
});

console.log(`\n${n} liero tests passed`);
