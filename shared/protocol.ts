// Wire protocol. JSON text frames for control/state; binary frames carry the map.

export const PROTOCOL_VERSION = 5;

/** [seq, keys, aim (Liero angle 0..128), weapon slot] */
export type InputTuple = [number, number, number, number];

export type C2S =
  | { t: 'hello'; v: number; name: string; lo?: number[] }
  | { t: 'in'; i: InputTuple[] }
  | { t: 'loadout'; l: number[] }
  | { t: 'name'; n: string }
  | { t: 'ping'; c: number };

export interface RosterEntry { i: number; n: string; c: string }

export type S2C =
  | { t: 'welcome'; id: number; color: string; needTerrain: boolean; tick: number }
  | { t: 'roster'; p: RosterEntry[] }
  | { t: 'frag'; k: number; v: number; /** killer's weapon type, -1 unknown */ w?: number }
  | { t: 'join'; i: number; n: string }
  | { t: 'leave'; i: number; n: string }
  | { t: 'pong'; c: number }
  | { t: 'err'; m: string };

/**
 * The map: a 1 px collision mask plus two images.
 *  - fg: everything solid, full colour, rendered at `scale` px per world px (WebP with alpha)
 *  - bg: the page's backgrounds (not solid), 1 px per world px (WebP)
 */
export interface MapHeader {
  w: number;
  h: number;
  scale: number;
  fgLen: number;
  bgLen: number;
  title: string;
  /** Page background colour (RGB). Blasted holes are tinted from it. */
  bg?: [number, number, number];
  url: string;
}

export const FRAME_MAP = 1;
export const FRAME_CHUNK = 2;

/** Player names: printable, trimmed, 1-16 characters. */
export function cleanName(s: unknown): string {
  const n = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return n || 'worm';
}
