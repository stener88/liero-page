// Port of Liero's game logic (via OpenLiero: worm.cpp, weapon.cpp, nobject.cpp, sobject.cpp,
// ninjarope.cpp, bobject.cpp). Fixed-point 16.16, TICK_RATE ticks/second (Liero: 70).
// The page is the level: terrain.data 0 = air ("background"), non-zero = diggable dirt.

import { Terrain } from '../terrain.ts';
import {
  C, COSSIN, DEFAULT_LOADOUT, LOADOUT_SIZE, MATERIALS, M_WORM, NOBJECTS, SND, SOBJECTS, TEXTURES, WEAPONS, WORM_ANIM_TAB,
  colorIsSolid, ftoi, idiv, itof, largeSprite, smallSprite, vectorLength, wormSprite,
  type NObjectType, type WeaponType,
} from './data.ts';

/**
 * Simulation ticks per second. Original Liero runs at 70; 88 plays everything ~25% faster, which suits
 * a big browser window better. All game timings are in ticks, so this is the one speed knob.
 */
export const TICK_RATE = 88;
export const MAX_HEALTH = 100;
export const RESPAWN_TICKS = 150;
const MAX_WOBJECTS = 600, MAX_NOBJECTS = 600, MAX_BOBJECTS = C.BloodLimit;

// Controls (bitmask)
export const K_LEFT = 1, K_RIGHT = 2, K_JUMP = 4, K_FIRE = 8, K_ROPE = 16, K_UP = 32, K_DOWN = 64;

// Reaction force directions
const RF_DOWN = 0, RF_LEFT = 1, RF_UP = 2, RF_RIGHT = 3;

export class Rand {
  constructor(public s = 0x2545f491) {}
  next(): number { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s; }
  /** [0, n) like gvl::mwc::operator()(n); 0 for n <= 0. */
  int(n: number): number { return n > 0 ? this.next() % n : 0; }
}

export interface WormWeapon { type: number; ammo: number; delayLeft: number; loadingLeft: number }

export interface Rope {
  out: boolean; attached: boolean;
  x: number; y: number; vx: number; vy: number;
  length: number; curLen: number; anchor: number; // anchor = worm idx or -1
}

export interface LWorm {
  idx: number; // 0..7, also wire id
  x: number; y: number; vx: number; vy: number; // fixed
  aim: number; // fixed angle (0..128 << 16)
  dir: number; // 0 = left, 1 = right
  health: number; visible: boolean; killedTimer: number;
  weapons: WormWeapon[]; cur: number; loadout: number[];
  fireCone: number; leaveShellTimer: number;
  rope: Rope;
  reacts: number[]; ableToJump: boolean; ableToDig: boolean; movable: boolean; animate: boolean; frame: number;
  keys: number; pk: number;
  lastKilledBy: number; kills: number; deaths: number;
  hurtCooldown: number;
}

export interface WObject { id: number; type: WeaponType; x: number; y: number; vx: number; vy: number; owner: number; frame: number; timeLeft: number; dead: boolean }
export interface NObject { id: number; type: NObjectType; x: number; y: number; vx: number; vy: number; owner: number; frame: number; timeLeft: number; dead: boolean; cosmetic: boolean }
export interface BObject { x: number; y: number; vx: number; vy: number; color: number }

/** Everything the clients need to replay what happened to the map and play effects. */
export interface GameEvents {
  sound?(s: number, x: number, y: number, worm: number, launch: boolean): void;
  sobj?(type: number, x: number, y: number): void;
  dirt?(effect: number, x: number, y: number, tframe: number): void;
  blit?(sprite: number, x: number, y: number): void;
  stain?(x: number, y: number, color: number): void;
  particle?(n: NObject): void;
  frag?(killer: number, victim: number): void;
}

export interface Input { k: number; a: number; w: number } // a = Liero aim angle (0..128), w = weapon slot

/** Special nobject colour: "the colour of the page at this spot" (resolved by the client). */
export const PAGE_COLOR = 256;

export function newWorm(idx: number, loadout: number[] = DEFAULT_LOADOUT): LWorm {
  const lo = sanitizeLoadout(loadout);
  return {
    idx, x: 0, y: 0, vx: 0, vy: 0, aim: itof(96), dir: 1,
    health: MAX_HEALTH, visible: false, killedTimer: 1,
    weapons: lo.map((t) => ({ type: t, ammo: WEAPONS[t].ammo, delayLeft: 0, loadingLeft: 0 })), cur: 0, loadout: lo,
    fireCone: 0, leaveShellTimer: 0,
    rope: { out: false, attached: false, x: 0, y: 0, vx: 0, vy: 0, length: 0, curLen: 0, anchor: -1 },
    reacts: [0, 0, 0, 0], ableToJump: true, ableToDig: true, movable: true, animate: false, frame: 0,
    keys: 0, pk: 0, lastKilledBy: -1, kills: 0, deaths: 0, hurtCooldown: 0,
  };
}

export function sanitizeLoadout(lo: unknown): number[] {
  const arr = Array.isArray(lo) ? lo.map((v) => Number(v) | 0).filter((v) => v >= 0 && v < WEAPONS.length) : [];
  const out = arr.slice(0, LOADOUT_SIZE);
  for (const d of DEFAULT_LOADOUT) if (out.length < LOADOUT_SIZE && !out.includes(d)) out.push(d);
  while (out.length < LOADOUT_SIZE) out.push(out.length);
  return out;
}

export const weaponAvailable = (ww: WormWeapon) => ww.loadingLeft === 0;

export class LieroGame {
  cycles = 0;
  worms: LWorm[] = [];
  wobjects: WObject[] = [];
  nobjects: NObject[] = [];
  bobjects: BObject[] = [];
  rand: Rand;
  private nextId = 1;
  /** Prediction mode: only the local worm's own movement, no map edits, no spawned objects. */
  predict = false;

  constructor(public t: Terrain, public ev: GameEvents = {}, seed = (Math.random() * 2 ** 32) >>> 0) {
    this.rand = new Rand(seed || 1);
  }

  // ---- map helpers ----------------------------------------------------------------
  inside(x: number, y: number) { return x >= 0 && y >= 0 && x < this.t.w && y < this.t.h; }
  /** dirtRock(): solid page pixel */
  solid(x: number, y: number) { return this.inside(x, y) && this.t.data[y * this.t.w + x] !== 0; }
  /** background(): air */
  air(x: number, y: number) { return this.inside(x, y) && this.t.data[y * this.t.w + x] === 0; }
  /** Like Level::checkedMatWrap: out of bounds counts as solid. */
  backgroundOrOut(x: number, y: number) { return this.inside(x, y) ? this.t.data[y * this.t.w + x] === 0 : false; }

  wormByIdx(i: number) { return this.worms.find((w) => w.idx === i); }
  private id() { this.nextId = (this.nextId + 1) & 0xffff || 1; return this.nextId; }

  /** Called for the predicted worm's own launch/rope/reload sounds (client only), unless `silent`. */
  predictSound?: (s: number) => void;
  silent = false;

  sound(s: number, x: number, y: number, worm = -1, launch = false) {
    if (s < 0) return;
    if (!this.predict) this.ev.sound?.(s, x, y, worm, launch);
    else if (launch && !this.silent) this.predictSound?.(s);
  }

  /** Remove (nDrawBack) or add dirt using a texture mask, as Liero's drawDirtEffect. Returns tframe used. */
  drawDirtEffect(effect: number, x: number, y: number, tframe?: number): number {
    if (effect < 0 || effect >= TEXTURES.length) return 0;
    const tex = TEXTURES[effect];
    const tf = tframe ?? this.rand.int(tex.rFrame);
    applyDirtEffect(this.t, effect, x, y, tf);
    if (!this.predict) this.ev.dirt?.(effect, x, y, tf);
    return tf;
  }

  blitImageOnMap(sprite: number, x: number, y: number) {
    applyBlit(this.t, sprite, x, y);
    if (!this.predict) this.ev.blit?.(sprite, x, y);
  }

  // ---- worm hit test (pixel-perfect against the worm sprite) ----------------------------
  wormHit(x: number, y: number, dist: number, w: LWorm): boolean {
    if (!w.visible) return false;
    const spr = wormSprite(w.frame, w.dir);
    const dx = x - ftoi(w.x) + 7, dy = y - ftoi(w.y) + 5;
    const x1 = Math.max(0, dx - dist), y1 = Math.max(0, dy - dist);
    const x2 = Math.min(16, dx + dist + 1), y2 = Math.min(16, dy + dist + 1);
    for (let cy = y1; cy < y2; cy++) for (let cx = x1; cx < x2; cx++) {
      if (MATERIALS[spr[cy * 16 + cx]] & M_WORM) return true;
    }
    return false;
  }

  doDamage(w: LWorm, amount: number, by: number) {
    if (amount > 0) {
      w.health -= amount;
      if (w.health <= 0) w.lastKilledBy = by;
    }
  }

  private hurtSound(w: LWorm) {
    if (w.health > 0 && this.rand.int(3) === 0) {
      const s = SND.HURT + this.rand.int(3);
      if (w.hurtCooldown <= 0) { this.sound(s, ftoi(w.x), ftoi(w.y), w.idx); w.hurtCooldown = 25; }
    }
  }

  // ---- object creation -------------------------------------------------------------
  fireWeapon(type: WeaponType, angle: number, vx: number, vy: number, speed: number, x: number, y: number, owner: number) {
    if (this.predict || this.wobjects.length >= MAX_WOBJECTS) return;
    const c = COSSIN[angle & 127];
    const o: WObject = { id: this.id(), type, x, y, vx: idiv(c.x * speed, 100) + vx, vy: idiv(c.y * speed, 100) + vy, owner, frame: 0, timeLeft: type.timeToExplo, dead: false };
    if (type.distribution) {
      o.vx += this.rand.int(type.distribution * 2) - type.distribution;
      o.vy += this.rand.int(type.distribution * 2) - type.distribution;
    }
    if (type.startFrame >= 0) {
      if (type.shotType === 0) {
        o.frame = type.loopAnim ? (type.numFrames ? this.rand.int(type.numFrames + 1) : this.rand.int(2)) : 0;
      } else if (type.shotType === 1) {
        let a = angle; if (a > 64) --a;
        o.frame = Math.max(0, Math.min(12, (a - 12) >> 3));
      } else if (type.shotType === 3 || type.shotType === 2) {
        o.frame = angle;
      } else o.frame = 0;
    } else {
      o.frame = type.colorBullets - this.rand.int(2);
    }
    if (type.timeToExploV) o.timeLeft -= this.rand.int(type.timeToExploV);
    this.wobjects.push(o);
  }

  createN(type: NObjectType, vx: number, vy: number, x: number, y: number, color: number, owner: number): NObject | null {
    if (this.predict || this.nobjects.length >= MAX_NOBJECTS) return null;
    const cosmetic = isCosmetic(type);
    const o: NObject = { id: this.id(), type, x, y, vx, vy, owner, frame: 0, timeLeft: type.timeToExplo, dead: false, cosmetic };
    if (type.startFrame > 0) o.frame = this.rand.int(type.numFrames + 1);
    else if (color !== 0) o.frame = color;
    else o.frame = type.colorBullets;
    if (type.timeToExploV) o.timeLeft -= this.rand.int(type.timeToExploV);
    this.nobjects.push(o);
    return o;
  }

  createN1(type: NObjectType, vx: number, vy: number, x: number, y: number, color: number, owner: number) {
    if (type.distribution) {
      vx += type.distribution - this.rand.int(type.distribution * 2);
      vy += type.distribution - this.rand.int(type.distribution * 2);
    }
    const o = this.createN(type, vx, vy, x, y, color, owner);
    if (o?.cosmetic) this.ev.particle?.(o);
  }

  createN2(type: NObjectType, angle: number, vx: number, vy: number, x: number, y: number, color: number, owner: number) {
    const realSpeed = type.speed - this.rand.int(type.speedV);
    const c = COSSIN[angle & 127];
    vx += idiv(c.x * realSpeed, 100);
    vy += idiv(c.y * realSpeed, 100);
    if (type.distribution) {
      vx += this.rand.int(type.distribution * 2) - type.distribution;
      vy += this.rand.int(type.distribution * 2) - type.distribution;
    }
    const o = this.createN(type, vx, vy, x, y, color, owner);
    if (o) { o.x += o.vx; o.y += o.vy; if (o.cosmetic) this.ev.particle?.(o); }
  }

  createBObject(x: number, y: number, vx: number, vy: number) {
    if (this.predict || this.bobjects.length >= MAX_BOBJECTS) return;
    this.bobjects.push({ x, y, vx, vy, color: this.rand.int(C.NumBloodColours) + C.FirstBloodColour });
  }

  /** SObjectType::create — explosion: damage, knockback, debris, dirt removal. */
  createS(typeId: number, x: number, y: number, owner: number) {
    if (this.predict) return;
    const t = SOBJECTS[typeId];
    if (!t) return;
    if (t.startSound >= 0) this.sound(this.rand.int(t.numSounds) + t.startSound, x, y);
    this.ev.sobj?.(typeId, x, y);

    if (t.damage > 0) {
      for (const w of this.worms) {
        const wix = ftoi(w.x), wiy = ftoi(w.y);
        if (wix < x + t.detectRange && wix > x - t.detectRange && wiy < y + t.detectRange && wiy > y - t.detectRange) {
          let delta = wix - x;
          let power = t.detectRange - Math.abs(delta);
          let powerSum = power;
          if (Math.abs(w.vx) < itof(2)) w.vx += delta > 0 ? t.blowAway * power : -t.blowAway * power;
          delta = wiy - y;
          power = t.detectRange - Math.abs(delta);
          powerSum = idiv(powerSum + power, 2);
          if (Math.abs(w.vy) < itof(2)) w.vy += delta > 0 ? t.blowAway * power : -t.blowAway * power;
          let z = t.damage * powerSum;
          if (t.detectRange) z = idiv(z, t.detectRange);
          if (w.health > 0) {
            this.doDamage(w, z, owner);
            for (let i = 0; i < powerSum; i++) {
              this.createN2(NOBJECTS[6], this.rand.int(128), idiv(w.vx, 3), idiv(w.vy, 3), w.x, w.y, 0, w.idx);
            }
            this.hurtSound(w);
          }
        }
      }
      const objBlowAway = idiv(t.blowAway, 3);
      const push = (o: { x: number; y: number; vx: number; vy: number }) => {
        const ix = ftoi(o.x), iy = ftoi(o.y);
        if (!(ix < x + t.detectRange && ix > x - t.detectRange && iy < y + t.detectRange && iy > y - t.detectRange)) return false;
        let delta = ix - x, power = t.detectRange - Math.abs(delta);
        if (power > 0) { if (delta > 0) o.vx += objBlowAway * power; else if (delta < 0) o.vx -= objBlowAway * power; }
        delta = iy - y; power = t.detectRange - Math.abs(delta);
        if (power > 0) { if (delta > 0) o.vy += objBlowAway * power; else if (delta < 0) o.vy -= objBlowAway * power; }
        return true;
      };
      for (const o of this.wobjects) {
        if (o.dead || !o.type.affectByExplosions) continue;
        if (push(o) && o.type.chainExplosion) this.blowUpW(o, owner);
      }
      for (const o of this.nobjects) if (!o.dead && o.type.affectByExplosions) push(o);
      // Debris flying out of the dug area
      const width = t.detectRange >> 1;
      for (let yy = Math.max(0, y - width); yy < Math.min(this.t.h, y + width + 1); yy++) {
        for (let xx = Math.max(0, x - width); xx < Math.min(this.t.w, x + width + 1); xx++) {
          if (this.solid(xx, yy) && this.rand.int(8) === 0) {
            this.createN2(NOBJECTS[2], this.rand.int(128), 0, 0, itof(xx), itof(yy), PAGE_COLOR, owner);
          }
        }
      }
    }
    if (t.dirtEffect >= 0) this.drawDirtEffect(t.dirtEffect, x - 7, y - 7);
  }

  // ---- weapon objects ---------------------------------------------------------------
  private blowUpW(o: WObject, cause: number) {
    if (o.dead) return;
    o.dead = true;
    const w = o.type;
    const x = o.x, y = o.y;
    if (w.createOnExp >= 0) this.createS(w.createOnExp, ftoi(x), ftoi(y), cause);
    if (w.exploSound >= 0) this.sound(w.exploSound, ftoi(x), ftoi(y));
    if (w.splinterAmount > 0) {
      for (let i = 0; i < w.splinterAmount; i++) {
        if (w.splinterScatter === 0) {
          const angle = this.rand.int(128), sub = this.rand.int(2);
          this.createN2(NOBJECTS[w.splinterType], angle, 0, 0, x, y, w.splinterColour - sub, cause);
        } else {
          const sub = this.rand.int(2);
          this.createN1(NOBJECTS[w.splinterType], o.vx, o.vy, x, y, w.splinterColour - sub, cause);
        }
      }
    }
    if (w.dirtEffect >= 0) this.drawDirtEffect(w.dirtEffect, ftoi(x) - 7, ftoi(y) - 7);
  }

  private processW(o: WObject) {
    const w = o.type;
    const owner = this.wormByIdx(o.owner);
    let iter = 0;
    do {
      ++iter;
      let doExplode = false, doRemove = false;
      o.x += o.vx; o.y += o.vy;

      if (w.shotType === 2) {
        const d = COSSIN[o.frame & 127];
        let nvx = idiv(d.x * w.speed, 100), nvy = idiv(d.y * w.speed, 100);
        if (owner?.visible && (owner.keys & (K_UP | K_JUMP))) { nvx += idiv(d.x * w.addSpeed, 100); nvy += idiv(d.y * w.addSpeed, 100); }
        o.vx = idiv(o.vx * 8 + nvx, 9); o.vy = idiv(o.vy * 8 + nvy, 9);
      } else if (w.shotType === 3) {
        const d = COSSIN[o.frame & 127];
        o.vx += idiv(d.x * w.addSpeed, 100); o.vy += idiv(d.y * w.addSpeed, 100);
        if (w.distribution) {
          o.vx += this.rand.int(w.distribution * 2) - w.distribution;
          o.vy += this.rand.int(w.distribution * 2) - w.distribution;
        }
      }

      if (w.bounce > 0) {
        const ix = ftoi(o.x), iy = ftoi(o.y), nx = ftoi(o.x + o.vx), ny = ftoi(o.y + o.vy);
        if (!this.inside(nx, iy) || this.solid(nx, iy)) {
          if (w.bounce !== 100) { o.vx = idiv(-o.vx * w.bounce, 100); o.vy = idiv(o.vy * 4, 5); } else o.vx = -o.vx;
        }
        if (!this.inside(ix, ny) || this.solid(ix, ny)) {
          if (w.bounce !== 100) { o.vy = idiv(-o.vy * w.bounce, 100); o.vx = idiv(o.vx * 4, 5); } else o.vy = -o.vy;
        }
      }

      if (w.multSpeed !== 100) { o.vx = idiv(o.vx * w.multSpeed, 100); o.vy = idiv(o.vy * w.multSpeed, 100); }

      if (w.objTrailType >= 0 && w.objTrailDelay > 0 && this.cycles % w.objTrailDelay === 0) {
        this.createS(w.objTrailType, ftoi(o.x), ftoi(o.y), o.owner);
      }
      if (w.partTrailObj >= 0 && w.partTrailDelay > 0 && this.cycles % w.partTrailDelay === 0) {
        if (w.partTrailType === 1) {
          this.createN1(NOBJECTS[w.partTrailObj], idiv(o.vx, C.SplinterLarpaVelDiv), idiv(o.vy, C.SplinterLarpaVelDiv), o.x, o.y, 0, o.owner);
        } else {
          this.createN2(NOBJECTS[w.partTrailObj], this.rand.int(128), idiv(o.vx, C.SplinterCracklerVelDiv), idiv(o.vy, C.SplinterCracklerVelDiv), o.x, o.y, 0, o.owner);
        }
      }

      if (w.collideWithObjects) {
        const ix = idiv(o.vx * w.blowAway, 100), iy = idiv(o.vy * w.blowAway, 100);
        const near = (p: { x: number; y: number }) => o.x >= p.x - itof(2) && o.x <= p.x + itof(2) && o.y >= p.y - itof(2) && o.y <= p.y + itof(2);
        for (const i of this.wobjects) if (!i.dead && (i.type !== o.type || i.owner !== o.owner) && near(i)) { i.vx += ix; i.vy += iy; }
        for (const i of this.nobjects) if (!i.dead && near(i)) { i.vx += ix; i.vy += iy; }
      }

      const nx = ftoi(o.x + o.vx), ny = ftoi(o.y + o.vy);
      if (nx < 0) o.x = 0;
      if (ny < 0) o.y = 0;
      if (nx >= this.t.w) o.x = itof(this.t.w - 1);
      if (ny >= this.t.h) o.y = itof(this.t.h - 1);

      if (!this.inside(nx, ny) || this.solid(nx, ny)) {
        if (w.bounce === 0) {
          if (w.explGround) doExplode = true;
          else { o.vx = 0; o.vy = 0; }
        }
      } else {
        o.vy += w.gravity;
        if (w.numFrames > 0 && (this.cycles & 7) === 0) {
          if (!w.loopAnim) { if (++o.frame > w.numFrames) o.frame = 0; }
          else if (o.vx < 0) { if (--o.frame < 0) o.frame = w.numFrames; }
          else if (o.vx > 0) { if (++o.frame > w.numFrames) o.frame = 0; }
        }
      }

      if (w.timeToExplo > 0 && --o.timeLeft < 0) doExplode = true;

      for (const worm of this.worms) {
        if ((w.hitDamage || w.blowAway || w.bloodOnHit || w.wormCollide) && this.wormHit(ftoi(o.x), ftoi(o.y), w.detectDistance, worm)) {
          worm.vx += idiv(o.vx * w.blowAway, 100); worm.vy += idiv(o.vy * w.blowAway, 100);
          this.doDamage(worm, w.hitDamage, o.owner);
          for (let i = 0; i < w.bloodOnHit; i++) {
            this.createN2(NOBJECTS[6], this.rand.int(128), idiv(o.vx, 3), idiv(o.vy, 3), o.x, o.y, 0, worm.idx);
          }
          if (w.hitDamage > 0) this.hurtSound(worm);
          if (w.wormCollide && this.rand.int(w.wormCollide) === 0) {
            if (w.wormExplode) doExplode = true;
            doRemove = true;
          }
        }
      }

      if (doExplode) { this.blowUpW(o, o.owner); break; }
      if (doRemove) { o.dead = true; break; }
    } while (w.shotType === 4 && !o.dead && (iter < 8 || (w.id === 28 && iter < 3000)));
  }

  // ---- particles -------------------------------------------------------------------
  private processN(o: NObject) {
    const t = o.type;
    let bounced = false, doExplode = false;
    o.x += o.vx; o.y += o.vy;
    let nx = ftoi(o.x + o.vx), ny = ftoi(o.y + o.vy);
    const ix = ftoi(o.x), iy = ftoi(o.y);

    if (t.bounce > 0) {
      if (!this.inside(nx, iy) || this.solid(nx, iy)) { o.vx = idiv(-o.vx * t.bounce, 100); o.vy = idiv(o.vy * 4, 5); bounced = true; }
      if (!this.inside(ix, ny) || this.solid(ix, ny)) { o.vy = idiv(-o.vy * t.bounce, 100); o.vx = idiv(o.vx * 4, 5); bounced = true; }
    }
    if (t.bloodTrail && t.bloodTrailDelay > 0 && this.cycles % t.bloodTrailDelay === 0) {
      this.createBObject(o.x, o.y, idiv(o.vx, 4), idiv(o.vy, 4));
    }
    nx = ftoi(o.x + o.vx); ny = ftoi(o.y + o.vy);
    if (nx < 0) o.x = 0;
    if (ny < 0) o.y = 0;
    if (nx >= this.t.w) o.x = itof(this.t.w);
    if (ny >= this.t.h) o.y = itof(this.t.h);

    if (!this.inside(nx, ny) || this.solid(nx, ny)) {
      o.vx = 0; o.vy = 0;
      if (t.explGround) {
        if (t.startFrame > 0 && t.drawOnMap) this.blitImageOnMap(t.startFrame + o.frame, ix - 3, iy - 3);
        doExplode = true;
      }
    } else {
      if (!bounced && t.leaveObjDelay !== 0 && t.leaveObj >= 0 && this.cycles % t.leaveObjDelay === 0) {
        this.createS(t.leaveObj, ftoi(o.x), ftoi(o.y), o.owner);
      }
      o.vy += t.gravity;
    }

    if (t.numFrames > 0 && (this.cycles & 7) === 0) {
      if (o.vx > 0) { if (++o.frame > t.numFrames) o.frame = 0; }
      else if (o.vx < 0) { if (--o.frame < 0) o.frame = t.numFrames; }
    }

    if (t.timeToExplo > 0 && --o.timeLeft <= 0) doExplode = true;

    if (!doExplode && t.hitDamage > 0) {
      for (const w of this.worms) {
        if (this.wormHit(ftoi(o.x), ftoi(o.y), t.detectDistance, w)) {
          w.vx += idiv(o.vx * t.blowAway, 100); w.vy += idiv(o.vy * t.blowAway, 100);
          this.doDamage(w, t.hitDamage, o.owner);
          this.hurtSound(w);
          for (let i = 0; i < t.bloodOnHit; i++) {
            this.createN2(NOBJECTS[6], this.rand.int(128), idiv(o.vx, 3), idiv(o.vy, 3), o.x, o.y, 0, o.owner);
          }
          if (t.wormExplode) doExplode = true;
          else if (t.wormDestroy) o.dead = true;
        }
      }
    }

    if (doExplode) {
      if (t.createOnExp >= 0) this.createS(t.createOnExp, ftoi(o.x), ftoi(o.y), o.owner);
      if (t.dirtEffect >= 0) this.drawDirtEffect(t.dirtEffect, ftoi(o.x) - 7, ftoi(o.y) - 7);
      for (let i = 0; i < t.splinterAmount; i++) {
        const angle = this.rand.int(128), sub = this.rand.int(2);
        this.createN2(NOBJECTS[t.splinterType], angle, 0, 0, o.x, o.y, t.splinterColour - sub, o.owner);
      }
      o.dead = true;
    }
  }

  /** Blood droplets: fall through air, stain whatever solid pixel they hit. */
  private processB(b: BObject): boolean {
    b.x += b.vx; b.y += b.vy;
    const ix = ftoi(b.x), iy = ftoi(b.y);
    if (!this.inside(ix, iy)) return false;
    if (this.air(ix, iy)) { b.vy += C.BObjGravity; return true; }
    this.ev.stain?.(ix, iy, 82 + this.rand.int(3));
    return false;
  }

  // ---- ninja rope ------------------------------------------------------------------
  private processRope(w: LWorm) {
    const r = w.rope;
    if (!r.out) return;
    r.x += r.vx; r.y += r.vy;
    const ix = ftoi(r.x), iy = ftoi(r.y);
    if (!this.predict) {
      r.anchor = -1;
      for (const o of this.worms) {
        if (o !== w && this.wormHit(ix, iy, 1, o)) { r.anchor = o.idx; break; }
      }
    }
    const dx = r.x - w.x, dy = r.y - w.y;
    const fx = idiv(dx * 2 ** C.NRForceShlX, C.NRForceDivX), fy = idiv(dy * 2 ** C.NRForceShlY, C.NRForceDivY);
    r.curLen = (vectorLength(ftoi(dx), ftoi(dy)) + 1) * 2 ** C.NRForceLenShl;

    const anchor = r.anchor >= 0 ? this.wormByIdx(r.anchor) : undefined;
    if (ix <= 0 || ix >= this.t.w - 1 || iy <= 0 || iy >= this.t.h - 1 || this.solid(ix, iy)) {
      r.anchor = -1;
      if (!r.attached) {
        r.length = C.NRAttachLength;
        r.attached = true;
        if (this.solid(ix, iy)) {
          for (let i = 0; i < 11; i++) this.createN2(NOBJECTS[2], this.rand.int(128), 0, 0, r.x, r.y, PAGE_COLOR, w.idx);
        }
      }
      r.vx = 0; r.vy = 0;
    } else if (r.anchor >= 0) {
      if (!r.attached) { r.length = C.NRAttachLength; r.attached = true; }
      if (anchor) {
        if (r.curLen > r.length) { anchor.vx -= idiv(fx, r.curLen); anchor.vy -= idiv(fy, r.curLen); }
        r.vx = anchor.vx; r.vy = anchor.vy; r.x = anchor.x; r.y = anchor.y;
      } else { r.vx = 0; r.vy = 0; } // predicting: the other worm isn't simulated locally
    } else {
      r.attached = false;
    }

    if (r.attached) {
      if (r.curLen > r.length) { w.vx += idiv(fx, r.curLen); w.vy += idiv(fy, r.curLen); }
    } else {
      r.vy += C.NinjaropeGravity;
      if (r.curLen > r.length) { r.vx -= idiv(fx, r.curLen); r.vy -= idiv(fy, r.curLen); }
    }
  }

  // ---- worms -----------------------------------------------------------------------
  private reactionForce(w: LWorm, nx: number, ny: number, dir: number) {
    const pts = REACT_POINTS[dir];
    let n = 0;
    for (const [px, py] of pts) if (!this.backgroundOrOut(nx + px, ny + py)) n++;
    w.reacts[dir] = n;
  }

  private physics(w: LWorm) {
    if (w.reacts[RF_UP] > 0) w.vx = idiv(w.vx * C.WormFricMult, C.WormFricDiv);
    const ax = Math.abs(w.vx), ay = Math.abs(w.vy);
    const rh = w.reacts[w.vx >= 0 ? RF_LEFT : RF_RIGHT];
    const rv = w.reacts[w.vy >= 0 ? RF_UP : RF_DOWN];
    const mbh = w.vx > 0 ? C.MinBounceRight : -C.MinBounceLeft;
    const mbv = w.vy > 0 ? C.MinBounceDown : -C.MinBounceUp;
    if (w.vx && rh) {
      if (ax > mbh) { this.sound(SND.BUMP, ftoi(w.x), ftoi(w.y), w.idx); w.vx = idiv(-w.vx, 3); } else w.vx = 0;
    }
    if (w.vy && rv) {
      if (ay > mbv) { this.sound(SND.BUMP, ftoi(w.x), ftoi(w.y), w.idx); w.vy = idiv(-w.vy, 3); } else w.vy = 0;
    }
    if (w.reacts[RF_UP] === 0) w.vy += C.WormGravity;
    if (w.reacts[w.vx >= 0 ? RF_LEFT : RF_RIGHT] < 2) w.x += w.vx;
    if (w.reacts[w.vy >= 0 ? RF_UP : RF_DOWN] < 2) w.y += w.vy;
  }

  private fire(w: LWorm) {
    const ww = w.weapons[w.cur];
    const t = WEAPONS[ww.type];
    --ww.ammo;
    ww.delayLeft = t.delay;
    w.fireCone = t.fireCone;
    const angle = ftoi(w.aim) & 127;
    const c = COSSIN[angle];
    const fx = c.x * (t.detectDistance + 5) + w.x, fy = c.y * (t.detectDistance + 5) + w.y - itof(1);
    if (t.leaveShells > 0 && !this.predict && this.rand.int(t.leaveShells) === 0) w.leaveShellTimer = t.leaveShellDelay;
    if (t.launchSound >= 0) this.sound(t.launchSound, ftoi(w.x), ftoi(w.y), w.idx, true);
    let speed = t.speed, fvx = 0, fvy = 0;
    if (t.affectByWorm) {
      if (speed < 100) speed = 100;
      fvx = idiv(w.vx * 100, speed); fvy = idiv(w.vy * 100, speed);
    }
    for (let i = 0; i < t.parts; i++) this.fireWeapon(t, angle, fvx, fvy, speed, fx, fy, w.idx);
    const recoil = t.recoil;
    w.vx -= idiv(c.x * recoil, 100); w.vy -= idiv(c.y * recoil, 100);
  }

  /** Apply a mouse aim (Liero angle units, 0..128) the way Liero's aim limits allow. */
  private aimAt(w: LWorm, a: number) {
    if (!Number.isFinite(a)) return;
    a = ((a % 128) + 128) % 128;
    const right = a >= 64 || a < 1; // 64..128 = up -> right -> down
    w.dir = right ? 1 : 0;
    let ang = a < 1 && right ? 128 : a;
    if (w.dir === 1) ang = Math.max(C.AimMinRight, Math.min(C.AimMaxRight, ang));
    else ang = Math.max(C.AimMaxLeft, Math.min(C.AimMinLeft, ang));
    w.aim = Math.round(ang * 65536);
  }

  private angleFrame(w: LWorm) {
    let x = ftoi(w.aim) - 12;
    if (w.dir !== 0) x -= 49;
    x >>= 3;
    x = Math.max(0, Math.min(6, x));
    if (w.dir !== 0) x = 6 - x;
    return x;
  }

  processWorm(w: LWorm, inp: Input) {
    w.pk = w.keys;
    w.keys = inp.k | 0;
    const pressed = (k: number) => (w.keys & k) !== 0;
    const pressedOnce = (k: number) => (w.keys & k) !== 0 && (w.pk & k) === 0;
    if (w.hurtCooldown > 0) w.hurtCooldown--;

    if (!w.visible) {
      if (w.killedTimer > 0) --w.killedTimer;
      if (w.killedTimer <= 0 && !this.predict) this.respawn(w);
      return;
    }
    if (w.health > MAX_HEALTH) w.health = MAX_HEALTH;

    // Reaction forces (Liero.exe 291C)
    let nx = ftoi(w.x + w.vx), ny = ftoi(w.y + w.vy);
    for (let i = 0; i < 4; i++) {
      this.reactionForce(w, nx, ny, i);
      if (nx < 4) w.reacts[RF_RIGHT] += 5;
      else if (nx > this.t.w - 5) w.reacts[RF_LEFT] += 5;
      if (ny < 5) w.reacts[RF_DOWN] += 5;
      else if (ny > this.t.h - 6) w.reacts[RF_UP] += 5;
    }
    if (w.reacts[RF_DOWN] < 2 && w.reacts[RF_UP] > 0 && (w.reacts[RF_LEFT] > 0 || w.reacts[RF_RIGHT] > 0)) {
      w.y -= itof(1); ny = ftoi(w.y + w.vy);
      this.reactionForce(w, nx, ny, RF_LEFT); this.reactionForce(w, nx, ny, RF_RIGHT);
    }
    if (w.reacts[RF_UP] < 2 && w.reacts[RF_DOWN] > 0 && (w.reacts[RF_LEFT] > 0 || w.reacts[RF_RIGHT] > 0)) {
      w.y += itof(1); ny = ftoi(w.y + w.vy);
      this.reactionForce(w, nx, ny, RF_LEFT); this.reactionForce(w, nx, ny, RF_RIGHT);
    }

    // Steerable missiles take over left/right
    const ww0 = w.weapons[w.cur];
    if (!this.predict && WEAPONS[ww0.type].shotType === 2) {
      for (const o of this.wobjects) {
        if (!o.dead && o.type.id === ww0.type && o.owner === w.idx) {
          if (pressed(K_LEFT)) o.frame -= (this.cycles & 1) + 1;
          if (pressed(K_RIGHT)) o.frame += (this.cycles & 1) + 1;
          o.frame &= 127;
          w.movable = false;
        }
      }
    }
    if (!w.movable && !pressed(K_LEFT) && !pressed(K_RIGHT)) w.movable = true;

    // Aiming (mouse) and weapon selection
    this.aimAt(w, inp.a);
    const slot = inp.w | 0;
    if (slot >= 0 && slot < w.weapons.length && slot !== w.cur) { w.cur = slot; w.fireCone = 0; }

    // Tasks: rope + jump
    const r = w.rope;
    if (pressedOnce(K_ROPE)) {
      if (r.out) { r.out = false; r.attached = false; }
      else {
        r.out = true; r.attached = false;
        this.sound(SND.THROW, ftoi(w.x), ftoi(w.y), w.idx, true);
        r.x = w.x; r.y = w.y;
        const c = COSSIN[ftoi(w.aim) & 127];
        r.vx = c.x * 2 ** C.NRThrowVelX; r.vy = c.y * 2 ** C.NRThrowVelY;
        r.length = C.NRInitialLength;
      }
    }
    if (r.out) {
      if (pressed(K_UP)) r.length -= C.NRPullVel;
      if (pressed(K_DOWN)) r.length += C.NRReleaseVel;
      r.length = Math.max(C.NRMinLength, Math.min(C.NRMaxLength, r.length));
    }
    if (pressed(K_JUMP)) {
      r.out = false; r.attached = false;
      if (w.reacts[RF_UP] > 0 && w.ableToJump) { w.vy -= C.JumpForce; w.ableToJump = false; }
    } else w.ableToJump = true;

    // Weapons: reloading, delays, shells
    for (const ww of w.weapons) if (ww.delayLeft >= 0) --ww.delayLeft;
    const ww = w.weapons[w.cur];
    const wt = WEAPONS[ww.type];
    if (ww.ammo <= 0) { ww.loadingLeft = Math.max(1, wt.loadingTime); ww.ammo = wt.ammo; }
    if (ww.loadingLeft > 0) {
      --ww.loadingLeft;
      if (ww.loadingLeft <= 0 && wt.playReloadSound) this.sound(SND.RELOADED, ftoi(w.x), ftoi(w.y), w.idx, true);
    }
    if (w.fireCone > 0) --w.fireCone;
    if (w.leaveShellTimer > 0 && --w.leaveShellTimer <= 0 && !this.predict) {
      this.createN1(NOBJECTS[7], this.rand.int(16000) - 8000, -this.rand.int(20000), w.x, w.y, 0, w.idx);
    }

    if (pressed(K_FIRE) && weaponAvailable(ww) && ww.delayLeft <= 0) this.fire(w);

    this.physics(w);

    // Movement + digging (left+right together)
    if (w.movable) {
      const left = pressed(K_LEFT), right = pressed(K_RIGHT);
      if (left && !right) { if (w.vx > C.MaxVelLeft) w.vx -= C.WalkVelLeft; w.animate = true; }
      if (!left && right) { if (w.vx < C.MaxVelRight) w.vx += C.WalkVelRight; w.animate = true; }
      if (left && right) {
        if (w.ableToDig) {
          w.ableToDig = false;
          if (!this.predict) {
            const c = COSSIN[ftoi(w.aim) & 127];
            let dx = c.x * 2 + w.x - itof(7), dy = c.y * 2 + w.y - itof(7);
            this.drawDirtEffect(7, ftoi(dx), ftoi(dy));
            dx += c.x * 2; dy += c.y * 2;
            this.drawDirtEffect(7, ftoi(dx), ftoi(dy));
          }
        }
      } else w.ableToDig = true;
      if (!left && !right) w.animate = false;
    }

    // Bleeding when badly hurt
    if (!this.predict && w.health < MAX_HEALTH / 4 && this.rand.int(w.health + 6) === 0) {
      if (this.rand.int(3) === 0) this.hurtSound(w);
      this.createN1(NOBJECTS[6], w.vx, w.vy, w.x, w.y, 0, w.idx);
    }

    if (w.health <= 0 && !this.predict) this.kill(w);

    const animFrame = w.animate ? (this.cycles & 31) >> 3 : 0;
    w.frame = this.angleFrame(w) + WORM_ANIM_TAB[animFrame];
  }

  kill(w: LWorm) {
    this.sound(SND.DEATH + this.rand.int(3), ftoi(w.x), ftoi(w.y), w.idx);
    w.fireCone = 0;
    w.rope.out = false;
    w.deaths++;
    const killer = w.lastKilledBy >= 0 ? this.wormByIdx(w.lastKilledBy) : undefined;
    if (killer && killer !== w) killer.kills++;
    this.ev.frag?.(w.lastKilledBy >= 0 ? w.lastKilledBy : w.idx, w.idx);
    w.visible = false;
    w.killedTimer = RESPAWN_TICKS;
    for (let i = 1; i <= 120; i++) this.createN2(NOBJECTS[6], this.rand.int(128), idiv(w.vx, 3), idiv(w.vy, 3), w.x, w.y, 0, w.idx);
    for (let i = 7; i <= 105; i += 14) this.createN2(NOBJECTS[w.idx & 1], i + this.rand.int(14), idiv(w.vx, 3), idiv(w.vy, 3), w.x, w.y, 0, w.idx);
    w.keys &= ~K_FIRE;
  }

  respawn(w: LWorm) {
    const s = this.findSpawn();
    w.x = itof(s.x); w.y = itof(s.y);
    this.drawDirtEffect(0, s.x - 7, s.y - 7);
    this.sound(SND.ALIVE, s.x, s.y, w.idx);
    w.visible = true; w.fireCone = 0; w.vx = 0; w.vy = 0; w.health = MAX_HEALTH; w.lastKilledBy = -1;
    w.rope.out = false;
    for (const [i, t] of w.loadout.entries()) {
      w.weapons[i] = { type: t, ammo: WEAPONS[t].ammo, delayLeft: 0, loadingLeft: 0 };
    }
    if (this.rand.next() & 1) { w.aim = itof(32); w.dir = 0; } else { w.aim = itof(96); w.dir = 1; }
  }

  /** Random open spot with ground below, away from other worms if possible. */
  findSpawn(): { x: number; y: number } {
    const t = this.t;
    let best: { x: number; y: number } | null = null, bestD = -1;
    for (let tries = 0; tries < 40; tries++) {
      let x = 8 + this.rand.int(Math.max(1, t.w - 16));
      let y = 8 + this.rand.int(Math.max(1, t.h - 20));
      let ok = false;
      for (let k = 0; k < 400 && y < t.h - 6; k++, y++) {
        if (this.boxFree(x, y) && !this.boxFree(x, y + 1)) { ok = true; break; }
      }
      if (!ok) continue;
      let d = 1e9;
      for (const o of this.worms) if (o.visible) d = Math.min(d, Math.abs(ftoi(o.x) - x) + Math.abs(ftoi(o.y) - y));
      if (d > bestD) { bestD = d; best = { x, y }; }
      if (d > 160) break;
    }
    return best ?? { x: t.w >> 1, y: 8 };
  }

  private boxFree(x: number, y: number) {
    for (let yy = y - 4; yy <= y + 4; yy++) for (let xx = x - 3; xx <= x + 3; xx++) if (!this.backgroundOrOut(xx, yy)) return false;
    return true;
  }

  // ---- frame -------------------------------------------------------------------------
  /** Game::processFrame. `inputs` by worm idx. */
  step(inputs: Map<number, Input>) {
    for (const o of this.wobjects) if (!o.dead) this.processW(o);
    this.wobjects = this.wobjects.filter((o) => !o.dead);
    for (const o of this.nobjects) if (!o.dead) this.processN(o);
    this.nobjects = this.nobjects.filter((o) => !o.dead);
    this.bobjects = this.bobjects.filter((b) => this.processB(b));
    ++this.cycles;
    for (const w of this.worms) {
      const inp = inputs.get(w.idx) ?? { k: 0, a: ftoi(w.aim), w: w.cur };
      this.processWorm(w, inp);
    }
    for (const w of this.worms) if (w.visible) this.processRope(w);
  }

  /** Client-side prediction of a single worm (no map edits, no objects). */
  predictWorm(w: LWorm, inp: Input) {
    this.predict = true;
    this.processWorm(w, inp);
    if (w.visible) this.processRope(w);
    this.predict = false;
    this.cycles++;
  }
}

/** Particles that only look pretty: no damage, no explosions, no map edits. Clients simulate these locally. */
export function isCosmetic(t: NObjectType) {
  return t.hitDamage === 0 && !t.wormExplode && t.createOnExp < 0 && t.dirtEffect < 0 && t.splinterAmount === 0 && !t.drawOnMap && t.leaveObj < 0 && t.timeToExplo === 0;
}

const REACT_POINTS: [number, number][][] = [
  [[-1, -4], [0, -4], [1, -4]],
  [[1, -3], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [1, 3]],
  [[-1, 4], [0, 4], [1, 4]],
  [[-1, -3], [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-1, 3]],
];

/** Liero's drawDirtEffect on a pixel mask. Returns per-pixel changes for visuals via callback. */
export function applyDirtEffect(
  t: Terrain, effect: number, x: number, y: number, tframe: number,
  onPixel?: (px: number, py: number, color: number) => void, // color 0 = removed
) {
  const tex = TEXTURES[effect];
  const mask = largeSprite(tex.mFrame);
  const tFrame = largeSprite(tex.sFrame + tframe);
  for (let yy = 0; yy < 16; yy++) {
    const py = y + yy;
    if (py < 0 || py >= t.h - 1) continue;
    for (let xx = 0; xx < 16; xx++) {
      const px = x + xx;
      if (px < 0 || px >= t.w) continue;
      const c = mask[yy * 16 + xx];
      const i = py * t.w + px;
      if (tex.nDrawBack) {
        if (c === 6 && t.data[i] !== 0) { t.data[i] = 0; onPixel?.(px, py, 0); }
      } else if (t.data[i] === 0) {
        let col = 0;
        if (c === 10 || c === 6) col = tFrame[((py & 15) << 4) + (px & 15)];
        else if (c === 2) col = 2;
        else if (c === 1) col = 1;
        if (col) {
          if (colorIsSolid(col)) t.data[i] = 1;
          onPixel?.(px, py, col);
        }
      }
    }
  }
}

/** Liero's blitImageOnMap (shells, worm bits): paints a small sprite into the map. */
export function applyBlit(t: Terrain, sprite: number, x: number, y: number, onPixel?: (px: number, py: number, color: number) => void) {
  const spr = smallSprite(sprite);
  for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 7; xx++) {
    const c = spr[yy * 7 + xx];
    if (!c) continue;
    const px = x + xx, py = y + yy;
    if (px < 0 || py < 0 || px >= t.w || py >= t.h) continue;
    const i = py * t.w + px;
    const n = c; // every page pixel counts as dirt or background, so no +3 rock shading
    if (colorIsSolid(n)) t.data[i] = 1;
    onPixel?.(px, py, n);
  }
}
