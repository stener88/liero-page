// Decoded Liero data + fixed-point helpers shared by the server sim and the client.
// Liero data © 1998 Joosa Riekkinen, WTFPL. Logic follows OpenLiero (gliptic/liero).

import { C as RAW_C, LARGE_SPRITES_B64, MATERIALS, NOBJECTS_RAW, PALETTE, SMALL_SPRITES_B64, SOBJECTS_RAW, TEXTURES_RAW, WEAPONS_RAW } from './data.gen.ts';

export { PALETTE, MATERIALS };
export const C = RAW_C;

// ---- fixed point (16.16) ----------------------------------------------------------
export const itof = (v: number) => v * 65536;
export const ftoi = (v: number) => Math.floor(v / 65536);
/** C-style integer division (truncates toward zero). */
export const idiv = (a: number, b: number) => Math.trunc(a / b);

/** Liero's 128-step direction table. 0 = down, 32 = left, 64 = up, 96 = right. */
export const COSSIN: { x: number; y: number }[] = Array.from({ length: 128 }, (_, i) => {
  const t = (i * 2 * Math.PI) / 128;
  return { x: Math.round(-Math.sin(t) * 65536), y: Math.round(Math.cos(t) * 65536) };
});

export function vectorLength(x: number, y: number): number {
  return Math.floor(Math.sqrt(x * x + y * y));
}

// ---- materials ---------------------------------------------------------------------
export const M_DIRT = 1, M_DIRT2 = 2, M_ROCK = 4, M_BACKGROUND = 8, M_SEESHADOW = 16, M_WORM = 32;
/** Does palette colour `c` count as solid ground when drawn into the map? */
export const colorIsSolid = (c: number) => (MATERIALS[c] & (M_DIRT | M_DIRT2 | M_ROCK)) !== 0;

// ---- types --------------------------------------------------------------------------
export interface WeaponType {
  id: number; name: string;
  detectDistance: number; affectByWorm: boolean; blowAway: number; gravity: number; shadow: boolean; laserSight: boolean;
  launchSound: number; loopSound: boolean; exploSound: number; speed: number; addSpeed: number; distribution: number;
  parts: number; recoil: number; multSpeed: number; delay: number; loadingTime: number; ammo: number; createOnExp: number;
  dirtEffect: number; leaveShells: number; leaveShellDelay: number; playReloadSound: boolean; wormExplode: boolean;
  explGround: boolean; wormCollide: number; fireCone: number; collideWithObjects: boolean; affectByExplosions: boolean;
  bounce: number; timeToExplo: number; timeToExploV: number; hitDamage: number; bloodOnHit: number; startFrame: number;
  numFrames: number; loopAnim: boolean; shotType: number; colorBullets: number; splinterAmount: number; splinterColour: number;
  splinterType: number; splinterScatter: number; objTrailType: number; objTrailDelay: number; partTrailType: number;
  partTrailObj: number; partTrailDelay: number; chainExplosion: boolean;
}

export interface NObjectType {
  id: number;
  detectDistance: number; gravity: number; speed: number; speedV: number; distribution: number; blowAway: number; bounce: number;
  hitDamage: number; wormExplode: boolean; explGround: boolean; wormDestroy: boolean; bloodOnHit: number; startFrame: number;
  numFrames: number; drawOnMap: boolean; colorBullets: number; createOnExp: number; affectByExplosions: boolean; dirtEffect: number;
  splinterAmount: number; splinterColour: number; splinterType: number; bloodTrail: boolean; bloodTrailDelay: number;
  leaveObj: number; leaveObjDelay: number; timeToExplo: number; timeToExploV: number;
}

export interface SObjectType {
  id: number;
  startSound: number; numSounds: number; animDelay: number; startFrame: number; numFrames: number; detectRange: number;
  damage: number; blowAway: number; shadow: boolean; shake: number; flash: number; dirtEffect: number;
}

export interface Texture { nDrawBack: boolean; mFrame: number; sFrame: number; rFrame: number }

export const WEAPONS = WEAPONS_RAW as unknown as WeaponType[];
export const NOBJECTS = (NOBJECTS_RAW as unknown as NObjectType[]).map((n, i) => ({ ...n, id: i }));
// blowAway has 13 real slots; the 14th overlaps other data.
export const SOBJECTS = (SOBJECTS_RAW as unknown as SObjectType[]).map((s, i) => ({ ...s, id: i, blowAway: i < 13 ? s.blowAway : 0 }));
export const TEXTURES = TEXTURES_RAW as unknown as Texture[];

/** Weapon ids in Liero's menu order (alphabetical). */
export const WEAPON_ORDER = WEAPONS.map((w) => w.id).sort((a, b) => (WEAPONS[a].name < WEAPONS[b].name ? -1 : 1));
export const DEFAULT_LOADOUT = [3, 14, 10, 0, 29].filter((i) => i < WEAPONS.length); // bazooka, minigun, grenade, shotgun, spikeballs
export const LOADOUT_SIZE = 5;

// ---- sprites --------------------------------------------------------------------------
function b64(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array((globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }).Buffer.from(s, 'base64'));
}

export const LARGE = b64(LARGE_SPRITES_B64); // 110 × 16×16
export const SMALL = b64(SMALL_SPRITES_B64); // 130 × 7×7
export const largeSprite = (i: number) => LARGE.subarray(i * 256, i * 256 + 256);
export const smallSprite = (i: number) => SMALL.subarray(i * 49, i * 49 + 49);

// Texture noise sprites (OpenLiero fills these at load time).
{
  let seed = 12345;
  const r4 = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) & 3; };
  const fill = (i: number, base: number) => { const s = largeSprite(i); for (let k = 0; k < 256; k++) s[k] = r4() + base; };
  fill(73, 160); fill(74, 160); fill(87, 12); fill(88, 12); fill(82, 94); fill(83, 94);
}

/** Worm sprites: 21 frames (7 aim angles × 3 walk frames) × 2 directions. dir 1 = facing right. */
export const WORM_SPRITES: Uint8Array[] = [];
for (let dir = 0; dir < 2; dir++) {
  for (let i = 0; i < 21; i++) {
    const src = largeSprite(16 + i);
    const out = new Uint8Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const pix = src[y * 16 + x];
      if (dir === 1) out[y * 16 + x] = pix;
      else if (x !== 15) out[y * 16 + 14 - x] = pix;
    }
    WORM_SPRITES[dir * 21 + i] = out;
  }
}
export const wormSprite = (frame: number, dir: number) => WORM_SPRITES[dir * 21 + frame];

/** Fire cone sprites: 7 angles × 2 directions. */
export const FIRECONE_SPRITES: Uint8Array[] = [];
for (let dir = 0; dir < 2; dir++) {
  for (let i = 0; i < 7; i++) {
    const src = largeSprite(9 + i);
    const out = new Uint8Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const pix = src[y * 16 + x];
      if (dir === 1) out[y * 16 + x] = pix;
      else if (x !== 15) out[y * 16 + 14 - x] = pix;
    }
    FIRECONE_SPRITES[dir * 7 + i] = out;
  }
}
export const FIRECONE_OFFSET = [
  [[-3, 1], [-4, 0], [-4, -2], [-4, -4], [-3, -5], [-2, -6], [0, -6]],
  [[3, 1], [4, 0], [4, -2], [4, -4], [3, -5], [2, -6], [0, -6]],
];

/** Liero's default walk animation offsets. */
export const WORM_ANIM_TAB = [0, 7, 0, 14];

/** Sound ids (index into LIERO.SND). */
export const SND = { THROW: 5, DIRT: 13, BUMP: 14, DEATH: 15, HURT: 18, ALIVE: 21, BEGIN: 22, DROPSHELL: 23, RELOADED: 24 } as const;

/** Worm colours 30..34 get recoloured per player. */
export const WORM_COLOR_FIRST = 30, WORM_COLOR_COUNT = 5;
