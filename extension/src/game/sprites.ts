// Liero sprite atlases rendered from palette data, plus per-player recoloured worms.

import {
  FIRECONE_SPRITES, LARGE, PALETTE, SMALL, WORM_COLOR_COUNT, WORM_COLOR_FIRST, WORM_SPRITES,
} from '../../../shared/liero/data.ts';

export const rgbOf = (c: number) => [(PALETTE[c] >> 16) & 255, (PALETTE[c] >> 8) & 255, PALETTE[c] & 255] as const;
export const cssOf = (c: number) => { const [r, g, b] = rgbOf(c); return `rgb(${r},${g},${b})`; };
export const PALETTE_CSS = Array.from({ length: 256 }, (_, i) => cssOf(i));

export interface Atlas { canvas: HTMLCanvasElement; shadow: HTMLCanvasElement; size: number; cols: number }

function buildAtlas(data: Uint8Array, size: number, count: number, recolor?: (c: number) => [number, number, number]): Atlas {
  const cols = 16;
  const rows = Math.ceil(count / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * size; canvas.height = rows * size;
  const shadow = document.createElement('canvas');
  shadow.width = canvas.width; shadow.height = canvas.height;
  const ctx = canvas.getContext('2d')!, sctx = shadow.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const simg = sctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < count; i++) {
    const ox = (i % cols) * size, oy = Math.floor(i / cols) * size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = data[i * size * size + y * size + x];
      if (!c) continue;
      const o = ((oy + y) * canvas.width + ox + x) * 4;
      const [r, g, b] = recolor?.(c) ?? rgbOf(c);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      simg.data[o + 3] = 90; // shadow silhouette
    }
  }
  ctx.putImageData(img, 0, 0);
  sctx.putImageData(simg, 0, 0);
  return { canvas, shadow, size, cols };
}

let large: Atlas | null = null, small: Atlas | null = null, cones: Atlas | null = null;
export const largeAtlas = () => (large ??= buildAtlas(LARGE, 16, 110));
export const smallAtlas = () => (small ??= buildAtlas(SMALL, 7, 130));
export const coneAtlas = () => {
  if (!cones) {
    const data = new Uint8Array(14 * 256);
    FIRECONE_SPRITES.forEach((s, i) => data.set(s, i * 256));
    cones = buildAtlas(data, 16, 14);
  }
  return cones;
};

/** Worm sprites (42 = 21 frames × 2 directions) with Liero's worm colours swapped for the player's colour. */
const wormCache = new Map<string, Atlas>();
export function wormAtlas(hex: string): Atlas {
  let a = wormCache.get(hex);
  if (a) return a;
  const base = parseInt(hex.replace('#', ''), 16);
  const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
  // Liero's worm ramp (30..34) goes light -> dark; map it onto the player colour.
  const shade = (c: number): [number, number, number] => {
    const k = 1.25 - (c - WORM_COLOR_FIRST) * 0.17;
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return [f(br), f(bg), f(bb)];
  };
  const data = new Uint8Array(42 * 256);
  WORM_SPRITES.forEach((s, i) => data.set(s, i * 256));
  a = buildAtlas(data, 16, 42, (c) => (c >= WORM_COLOR_FIRST && c < WORM_COLOR_FIRST + WORM_COLOR_COUNT ? shade(c) : [...rgbOf(c)] as [number, number, number]));
  wormCache.set(hex, a);
  return a;
}

export function drawSprite(ctx: CanvasRenderingContext2D, atlas: Atlas, i: number, x: number, y: number, shadow = false) {
  const s = atlas.size, sx = (i % atlas.cols) * s, sy = Math.floor(i / atlas.cols) * s;
  if (shadow) ctx.drawImage(atlas.shadow, sx, sy, s, s, x - 3, y + 3, s, s);
  ctx.drawImage(atlas.canvas, sx, sy, s, s, x, y, s, s);
}
