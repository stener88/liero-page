// Client-side visual effects that don't need the server every tick: cosmetic particles (debris,
// blood), blood droplets, and explosion animations. They run on the delayed render timeline.

import { C, NOBJECTS, SOBJECTS, ftoi } from '../../../shared/liero/data.ts';
import type { Terrain } from '../../../shared/terrain.ts';

export interface FxParticle { t: number; x: number; y: number; vx: number; vy: number; f: number; color: string }
export interface FxDrop { x: number; y: number; vx: number; vy: number; color: number }
export interface FxAnim { t: number; x: number; y: number; frame: number; delay: number }

const MAX_PARTICLES = 1500, MAX_DROPS = 600;

export class Effects {
  particles: FxParticle[] = [];
  drops: FxDrop[] = [];
  anims: FxAnim[] = [];
  /** Liero-style screen shake (fixed point px) and flash (frames). */
  shake = 0;
  flash = 0;
  private seed = 1;

  constructor(private t: Terrain) {}

  private r(n: number) { this.seed = (this.seed * 1103515245 + 12345) >>> 0; return n > 0 ? (this.seed >>> 8) % n : 0; }

  addParticle(p: FxParticle) {
    if (this.particles.length < MAX_PARTICLES) this.particles.push(p);
  }

  addAnim(t: number, x: number, y: number, inView: boolean) {
    const s = SOBJECTS[t];
    if (!s) return;
    this.anims.push({ t, x: x - 8, y: y - 8, frame: 0, delay: s.animDelay });
    if (inView) this.shake = Math.max(this.shake, s.shake * 65536);
    this.flash = Math.max(this.flash, s.flash);
  }

  private solidOrOut(x: number, y: number) {
    const t = this.t;
    return x < 0 || y < 0 || x >= t.w || y >= t.h || t.data[y * t.w + x] !== 0;
  }

  step(cycles: number) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 4000);
    if (this.flash > 0) this.flash--;

    this.anims = this.anims.filter((a) => {
      const s = SOBJECTS[a.t];
      if (--a.delay <= 0) { a.delay = s.animDelay; if (++a.frame > s.numFrames) return false; }
      return true;
    });

    this.particles = this.particles.filter((p) => {
      const ty = NOBJECTS[p.t];
      p.x += p.vx; p.y += p.vy;
      const ix = ftoi(p.x), iy = ftoi(p.y);
      if (ty.bounce > 0) {
        if (this.solidOrOut(ftoi(p.x + p.vx), iy)) { p.vx = Math.trunc(-p.vx * ty.bounce / 100); p.vy = Math.trunc(p.vy * 4 / 5); }
        if (this.solidOrOut(ix, ftoi(p.y + p.vy))) { p.vy = Math.trunc(-p.vy * ty.bounce / 100); p.vx = Math.trunc(p.vx * 4 / 5); }
      }
      if (ty.bloodTrail && ty.bloodTrailDelay > 0 && cycles % ty.bloodTrailDelay === 0 && this.drops.length < MAX_DROPS) {
        this.drops.push({ x: p.x, y: p.y, vx: Math.trunc(p.vx / 4), vy: Math.trunc(p.vy / 4), color: C.FirstBloodColour + this.r(C.NumBloodColours) });
      }
      if (this.solidOrOut(ftoi(p.x + p.vx), ftoi(p.y + p.vy))) {
        p.vx = 0; p.vy = 0;
        if (ty.explGround) return false;
      } else {
        p.vy += ty.gravity;
      }
      if (ty.numFrames > 0 && (cycles & 7) === 0) {
        if (p.vx > 0) { if (++p.f > ty.numFrames) p.f = 0; } else if (p.vx < 0) { if (--p.f < 0) p.f = ty.numFrames; }
      }
      return true;
    });

    this.drops = this.drops.filter((d) => {
      d.x += d.vx; d.y += d.vy;
      const ix = ftoi(d.x), iy = ftoi(d.y);
      if (ix < 0 || iy < 0 || ix >= this.t.w || iy >= this.t.h) return false;
      if (this.t.data[iy * this.t.w + ix] === 0) { d.vy += C.BObjGravity; return true; }
      return false; // the server sends the stain
    });
  }
}
