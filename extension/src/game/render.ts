// Draws the page map plus everything Liero puts on top of it, using the original sprites.

import { C, COSSIN, FIRECONE_OFFSET, NOBJECTS, SOBJECTS, WEAPONS, ftoi } from '../../../shared/liero/data.ts';
import { MAX_HEALTH, PAGE_COLOR, weaponAvailable, type LWorm } from '../../../shared/liero/game.ts';
import type { Terrain } from '../../../shared/terrain.ts';
import type { Effects } from './effects.ts';
import { PALETTE_CSS, coneAtlas, drawSprite, largeAtlas, smallAtlas, wormAtlas } from './sprites.ts';

export interface Camera { x: number; y: number; zoom: number } // x/y = world point at screen centre
export interface RWorm { w: LWorm; x: number; y: number; color: string; name: string; me: boolean }
export interface RObj { t: number; x: number; y: number; f: number }

export interface Frame {
  cam: Camera;
  worms: RWorm[];
  wobj: RObj[];
  nobj: RObj[];
  fx: Effects;
  me: LWorm | null;
  outline: number; // 0..1 opacity of the solid-terrain outline
  intro: number; // 0..1 fade of the "page becomes a level" transition
  cycles: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fg: HTMLCanvasElement | null = null; // solid layer, `scale` px per world px
  private fgx: CanvasRenderingContext2D | null = null;
  private bg: HTMLCanvasElement | null = null; // backdrop
  private bgx: CanvasRenderingContext2D | null = null;
  private scale = 1;
  private bgScale = 1;
  private terrain: Terrain | null = null;
  private pristine: Uint8ClampedArray | null = null; // original page colours at 1 px per world px
  private edge: HTMLCanvasElement | null = null; // outline of solid terrain
  private edgex: CanvasRenderingContext2D | null = null;
  private edgeImg: ImageData | null = null;
  private dpr = 1;
  private rnd = 1;

  constructor(parent: Node) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none;';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  /**
   * `bg` null means the map is a screenshot: `fg` is the whole picture, the backdrop is that same
   * picture, and the solid layer is the picture cut out by the collision mask.
   */
  setMap(t: Terrain, fg: CanvasImageSource, bg: CanvasImageSource | null, scale: number) {
    this.terrain = t;
    this.scale = scale;
    this.bgScale = bg ? 1 : scale;
    this.fg = document.createElement('canvas');
    this.fg.width = Math.round(t.w * scale); this.fg.height = Math.round(t.h * scale);
    // No willReadFrequently: that would keep it on the CPU and re-upload the whole picture every frame.
    this.fgx = this.fg.getContext('2d')!;
    this.fgx.drawImage(fg, 0, 0, this.fg.width, this.fg.height);
    this.bg = document.createElement('canvas');
    this.bg.width = Math.round(t.w * this.bgScale); this.bg.height = Math.round(t.h * this.bgScale);
    this.bgx = this.bg.getContext('2d')!;
    this.bgx.drawImage(bg ?? fg, 0, 0, this.bg.width, this.bg.height);

    // Original page colours at world resolution, for debris particles.
    const p = document.createElement('canvas');
    p.width = t.w; p.height = t.h;
    const px = p.getContext('2d', { willReadFrequently: true })!;
    px.drawImage(this.bg, 0, 0, t.w, t.h);
    if (bg) px.drawImage(fg, 0, 0, t.w, t.h);
    this.pristine = px.getImageData(0, 0, t.w, t.h).data;

    this.edge = document.createElement('canvas');
    this.edge.width = t.w; this.edge.height = t.h;
    this.edgex = this.edge.getContext('2d')!;
    this.edgeImg = this.edgex.createImageData(t.w, t.h);
    this.updateEdges(0, 0, t.w - 1, t.h - 1);
    if (!bg) {
      const mc = document.createElement('canvas');
      mc.width = t.w; mc.height = t.h;
      const mx = mc.getContext('2d')!;
      const img = mx.createImageData(t.w, t.h);
      for (let i = 0; i < t.data.length; i++) if (t.data[i]) img.data[i * 4 + 3] = 255;
      mx.putImageData(img, 0, 0);
      this.fgx.save();
      this.fgx.globalCompositeOperation = 'destination-in';
      this.fgx.imageSmoothingEnabled = false;
      this.fgx.drawImage(mc, 0, 0, this.fg.width, this.fg.height);
      this.fgx.restore();
    }
  }

  /** CSS colour of the original page at a world pixel. */
  pageColor(x: number, y: number): string {
    const t = this.terrain, p = this.pristine;
    if (!t || !p) return '#888';
    x = Math.max(0, Math.min(t.w - 1, x | 0)); y = Math.max(0, Math.min(t.h - 1, y | 0));
    const o = (y * t.w + x) * 4;
    return `rgb(${p[o]},${p[o + 1]},${p[o + 2]})`;
  }

  /** Change one world pixel of the page: 0 = dug out, otherwise a Liero palette colour painted on. */
  paint(x: number, y: number, color: number) {
    if (!this.fgx || !this.bgx) return;
    const s = this.scale, b = this.bgScale;
    if (color === 0) {
      this.fgx.clearRect(x * s, y * s, s, s);
      this.bgx.clearRect(x * b, y * b, b, b);
    } else {
      this.fgx.fillStyle = PALETTE_CSS[color];
      this.fgx.fillRect(x * s, y * s, s, s);
    }
  }

  /** Recompute the terrain outline (solid pixels touching air) inside a box. */
  updateEdges(x0: number, y0: number, x1: number, y1: number) {
    const t = this.terrain, img = this.edgeImg;
    if (!t || !img || !this.edgex) return;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(t.w - 1, x1); y1 = Math.min(t.h - 1, y1);
    if (x1 < x0 || y1 < y0) return;
    const d = t.data, w = t.w, h = t.h, px = img.data;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        const edge = d[i] !== 0 && ((x > 0 && d[i - 1] === 0) || (x < w - 1 && d[i + 1] === 0) || (y > 0 && d[i - w] === 0) || (y < h - 1 && d[i + w] === 0));
        const o = i * 4;
        px[o] = 255; px[o + 1] = 210; px[o + 2] = 63; px[o + 3] = edge ? 255 : 0;
      }
    }
    this.edgex.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  private r(n: number) { this.rnd = (this.rnd * 1103515245 + 12345) >>> 0; return (this.rnd >>> 8) % n; }

  private pixel(x: number, y: number, color: string, shadow: boolean) {
    const ctx = this.ctx;
    if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 3, y + 3, 1, 1); }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }

  /** Where a straight line from the worm along its aim first hits the ground. */
  private hotspot(x: number, y: number, aim: number) {
    const t = this.terrain;
    const d = COSSIN[ftoi(aim) & 127];
    let fx = x * 65536 + d.x * 6, fy = y * 65536 + d.y * 6 - 65536;
    for (let i = 0; i < 2000; i++) {
      fx += d.x; fy += d.y;
      const ix = ftoi(fx), iy = ftoi(fy);
      if (!t || ix < 0 || iy < 0 || ix >= t.w || iy >= t.h || t.data[iy * t.w + ix] !== 0) return { x: ix, y: iy };
    }
    return { x: ftoi(fx), y: ftoi(fy) };
  }

  private line(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number, i: number) => void) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, i = 0;
    for (;;) {
      plot(x0, y0, i++);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      if (i > 4000) break;
    }
  }

  draw(f: Frame) {
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    const sw = cw / this.dpr, sh = ch / this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cw, ch);

    // Void (only visible through craters, outside the map, and fading in during the intro)
    ctx.globalAlpha = f.intro;
    ctx.fillStyle = 'rgb(11,13,18)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;

    const z = f.cam.zoom * this.dpr;
    const ox = sw / 2 - f.cam.x * f.cam.zoom, oy = sh / 2 - f.cam.y * f.cam.zoom;
    ctx.setTransform(z, 0, 0, z, ox * this.dpr, oy * this.dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (this.fg && this.bg && this.terrain) {
      const t = this.terrain;
      ctx.drawImage(this.bg, 0, 0, t.w, t.h);
      ctx.drawImage(this.fg, 0, 0, t.w, t.h);
      if (this.edge && f.outline > 0.01) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = f.outline;
        ctx.drawImage(this.edge, 0, 0, t.w, t.h);
        ctx.globalAlpha = 1;
      }
    }
    ctx.imageSmoothingEnabled = false;
    const large = largeAtlas(), small = smallAtlas();

    // Explosions & smoke
    for (const a of f.fx.anims) {
      const s = SOBJECTS[a.t];
      drawSprite(ctx, large, s.startFrame + a.frame, a.x, a.y, s.shadow);
    }

    // Weapon objects
    for (const o of f.wobj) {
      const w = WEAPONS[o.t];
      if (!w) continue;
      if (w.startFrame > -1) {
        let cf = o.f;
        if (w.shotType === 2) { cf = (cf + 4) >> 3; if (cf < 0) cf = 16; else if (cf > 15) cf -= 16; }
        else if (w.shotType === 3) { if (cf > 64) --cf; cf = (cf - 12) >> 3; cf = Math.max(0, Math.min(12, cf)); }
        drawSprite(ctx, small, w.startFrame + cf, Math.round(o.x) - 3, Math.round(o.y) - 3, w.shadow);
      } else if (o.f > 0) {
        this.pixel(Math.round(o.x), Math.round(o.y), PALETTE_CSS[o.f & 255], w.shadow);
      }
    }

    // Particles (server-tracked + local cosmetic)
    const drawN = (t: number, x: number, y: number, fr: number, color?: string) => {
      const n = NOBJECTS[t];
      if (!n) return;
      if (n.startFrame > 0) drawSprite(ctx, small, n.startFrame + fr, Math.round(x) - 3, Math.round(y) - 3, true);
      else if (fr > 1) this.pixel(Math.round(x), Math.round(y), color ?? (fr === PAGE_COLOR ? '#888' : PALETTE_CSS[fr & 255]), true);
    };
    for (const o of f.nobj) drawN(o.t, o.x, o.y, o.f);
    for (const p of f.fx.particles) drawN(p.t, ftoi(p.x), ftoi(p.y), p.f, p.color);

    // Worms, ropes, fire cones, sights
    for (const r of f.worms) {
      const w = r.w;
      if (!w.visible) continue;
      const tx = Math.round(r.x) - 7, ty = Math.round(r.y) - 5;
      const ww = w.weapons[w.cur];
      const weapon = ww ? WEAPONS[ww.type] : null;
      if (weapon && ww && weaponAvailable(ww)) {
        const hs = this.hotspot(Math.round(r.x), Math.round(r.y), w.aim);
        if (weapon.laserSight) {
          this.line(hs.x, hs.y, tx + 7, ty + 4, (x, y) => { if (this.r(5) === 0) { ctx.fillStyle = PALETTE_CSS[this.r(2) + 83]; ctx.fillRect(x, y, 1, 1); } });
        }
        if (weapon.id === C.LaserWeapon - 1 && (w.keys & 8)) {
          ctx.fillStyle = PALETTE_CSS[weapon.colorBullets];
          this.line(hs.x, hs.y, tx + 7, ty + 4, (x, y) => ctx.fillRect(x, y, 1, 1));
        }
      }
      if (w.rope.out) {
        const rx = ftoi(w.rope.x), ry = ftoi(w.rope.y);
        this.line(rx, ry, tx + 7, ty + 4, (x, y) => { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 3, y + 3, 1, 1); });
        this.line(rx, ry, tx + 7, ty + 4, (x, y, i) => { ctx.fillStyle = PALETTE_CSS[C.NRColourBegin + (i % Math.max(1, C.NRColourEnd - C.NRColourBegin))]; ctx.fillRect(x, y, 1, 1); });
        drawSprite(ctx, large, 84, rx - 1, ry - 1, true);
      }
      const angleFrame = angleFrameOf(w);
      if (weapon && weapon.fireCone > 0 && w.fireCone > 0) {
        const off = FIRECONE_OFFSET[w.dir][angleFrame];
        drawSprite(ctx, coneAtlas(), w.dir * 7 + angleFrame, off[0] + tx, off[1] + ty);
      }
      if (w.health > 0 && w.health < MAX_HEALTH && !r.me) { /* hp shown in name tag */ }
      drawSprite(ctx, wormAtlas(r.color), w.dir * 21 + (w.frame % 21), tx, ty, true);
      if (r.me) {
        const d = COSSIN[ftoi(w.aim) & 127];
        drawSprite(ctx, small, 43, Math.round(r.x) - 1 + ftoi(d.x * 16) - 3, Math.round(r.y) - 2 + ftoi(d.y * 16) - 3);
      }
    }

    // Blood droplets
    for (const d of f.fx.drops) this.pixel(ftoi(d.x), ftoi(d.y), PALETTE_CSS[d.color], false);

    // --- screen space ---
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Name tags + health, drawn at screen resolution so the text stays crisp at any zoom.
    ctx.imageSmoothingEnabled = true;
    ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const zz = f.cam.zoom;
    for (const r of f.worms) {
      const w = r.w;
      if (!w.visible) continue;
      const x = Math.round(ox + r.x * zz), top = Math.round(oy + (r.y - 6) * zz) - 8;
      const bw = 26, frac = Math.max(0, Math.min(1, w.health / MAX_HEALTH));
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - bw / 2 - 1, top - 1, bw + 2, 5);
      ctx.fillStyle = w.health > 50 ? '#7cff6b' : w.health > 25 ? '#ffd23f' : '#ff5a5f';
      ctx.fillRect(x - bw / 2, top, bw * frac, 3);
      if (!r.me) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.strokeText(r.name, x, top - 5);
        ctx.fillStyle = r.color;
        ctx.fillText(r.name, x, top - 5);
      }
    }
    ctx.textAlign = 'left';
    if (f.fx.flash > 0) {
      ctx.fillStyle = `rgba(255,250,235,${Math.min(0.35, f.fx.flash * 0.035)})`;
      ctx.fillRect(0, 0, sw, sh);
    }
  }

}

export function angleFrameOf(w: LWorm) {
  let x = ftoi(w.aim) - 12;
  if (w.dir !== 0) x -= 49;
  x >>= 3;
  x = Math.max(0, Math.min(6, x));
  if (w.dir !== 0) x = 6 - x;
  return x;
}
