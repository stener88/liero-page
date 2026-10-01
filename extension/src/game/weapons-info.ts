// Player-facing weapon info: categories, one-line descriptions, stats and a pixel icon.

import { WEAPONS, type WeaponType } from '../../../shared/liero/data.ts';
import { TICK_RATE } from '../../../shared/liero/game.ts';
import { PALETTE_CSS, smallAtlas } from './sprites.ts';

export type Category = 'Guns' | 'Rockets' | 'Bombs' | 'Traps & tools';
export const CATEGORIES: Category[] = ['Guns', 'Rockets', 'Bombs', 'Traps & tools'];

const INFO: Record<string, [Category, string]> = {
  'CHAINGUN': ['Guns', 'Long bursts of bullets.'],
  'HANDGUN': ['Guns', 'Accurate pistol with a laser sight.'],
  'MINIGUN': ['Guns', 'Huge magazine, very fast fire, slow reload.'],
  'RIFLE': ['Guns', 'One precise, heavy shot. Laser sight.'],
  'SHOTGUN': ['Guns', '15 pellets per shot. Brutal up close.'],
  'SUPER SHOTGUN': ['Guns', '40 pellets per shot, two shots.'],
  'UZI': ['Guns', 'Fast fire and a quick reload.'],
  'WINCHESTER': ['Guns', 'Hard-hitting repeating rifle.'],
  'LASER': ['Guns', 'Instant beam that burns while you hold fire.'],
  'GAUSS GUN': ['Guns', 'Instant line of explosions.'],
  'RB RAMPAGE': ['Guns', 'Rubber bullets that bounce around corners.'],
  'DART': ['Guns', 'Fast, quiet darts.'],
  'FLAMER': ['Guns', 'Short-range flamethrower.'],
  'GREENBALL': ['Guns', 'Rapid stream of green slime balls.'],
  'ZIMM': ['Guns', 'Ricochets for ages and hits very hard.'],
  'BAZOOKA': ['Rockets', 'Rocket that explodes on impact.'],
  'MISSILE': ['Rockets', 'Guided rocket: keep aiming to steer it.'],
  'MINI ROCKETS': ['Rockets', 'Burst of ten small rockets.'],
  'DOOMSDAY': ['Rockets', 'Twin streams of fireballs.'],
  'LARPA': ['Rockets', 'Leaves a trail of explosions behind it.'],
  'BOUNCY LARPA': ['Rockets', 'Bouncing Larpa that trails explosions.'],
  'CANNON': ['Rockets', 'Six heavy cannonballs.'],
  'BLASTER': ['Rockets', 'Blast that bursts into shrapnel.'],
  'GRENADE': ['Bombs', 'Classic bouncing grenade.'],
  'CLUSTER BOMB': ['Bombs', 'Splits into a shower of small bombs.'],
  'CHIQUITA BOMB': ['Bombs', 'Splits into exploding bananas.'],
  'BIG NUKE': ['Bombs', 'Bounces, then wipes out everything nearby.'],
  'MINI NUKE': ['Bombs', 'Smaller nuke with nasty fallout.'],
  'HELLRAIDER': ['Bombs', 'Bouncing bomb that rains fire.'],
  'NAPALM': ['Bombs', 'Bursts into sticky flames.'],
  'GRASSHOPPER': ['Bombs', 'Hops along, exploding as it goes.'],
  'EXPLOSIVES': ['Bombs', 'Throw three charges at once.'],
  'CRACKLER': ['Bombs', 'Bouncy ball that spits sparks.'],
  'SPIKEBALLS': ['Bombs', 'Scatters eight bouncing spike balls.'],
  'MINE': ['Traps & tools', 'Drop it and wait. Explodes when touched.'],
  'BOUNCY MINE': ['Traps & tools', 'A mine that bounces into place.'],
  'FLOAT MINE': ['Traps & tools', 'Mines that float in mid-air.'],
  'BOOBY TRAP': ['Traps & tools', 'Explodes on whoever touches it.'],
  'DIRTBALL': ['Traps & tools', 'Throws dirt: build cover, block tunnels.'],
  'FAN': ['Traps & tools', 'Blows worms and shots away.'],
};

export function categoryOf(w: WeaponType): Category { return INFO[w.name]?.[0] ?? 'Guns'; }
export function blurbOf(w: WeaponType): string { return INFO[w.name]?.[1] ?? ''; }

/** "Pascal Case" for display (Liero's names are all caps). */
export function niceName(w: WeaponType): string {
  return w.name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bRb\b/, 'RB');
}

export function reloadSeconds(w: WeaponType): string {
  return `${(w.loadingTime / TICK_RATE).toFixed(1)}s`;
}

/** Short stat line, e.g. "15 shots · 2.2s reload". */
export function statLine(w: WeaponType): string {
  return `${w.ammo} ${w.ammo === 1 ? 'shot' : 'shots'} · ${reloadSeconds(w)} reload`;
}

/** Draw the weapon's projectile, scaled up with crisp pixels. Bullets without a sprite get a tracer. */
export function weaponIcon(id: number, px = 4): HTMLCanvasElement {
  const w = WEAPONS[id];
  const c = document.createElement('canvas');
  c.width = 7 * px; c.height = 7 * px;
  c.className = 'wicon';
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (w.startFrame >= 0) {
    // Frame pointing right for sprites that rotate with the shot.
    let f = 0;
    if (w.shotType === 2) f = (96 + 4) >> 3;
    else if (w.shotType === 3) f = (95 - 12) >> 3;
    const a = smallAtlas(), i = w.startFrame + Math.min(f, Math.max(0, w.numFrames - 1));
    ctx.drawImage(a.canvas, (i % a.cols) * 7, Math.floor(i / a.cols) * 7, 7, 7, 0, 0, 7 * px, 7 * px);
  } else {
    ctx.fillStyle = PALETTE_CSS[w.colorBullets & 255];
    const pellets = w.parts > 4 ? [[1, 2], [3, 4], [5, 1], [4, 5], [2, 5]] : [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3]];
    for (const [x, y] of pellets) ctx.fillRect(x * px, y * px, px, px);
  }
  return c;
}
