// Extracts game data from the original Liero 1.33 files (WTFPL, see liero-original/LICENSE.TXT).
// Offsets come from OpenLiero's tc_tool/common_exereader.cpp.
//   npx tsx scripts/extract-liero.ts <dir with LIERO.EXE, LIERO.CHR, LIERO.SND>
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'liero-original';
const exe = fs.readFileSync(path.join(dir, 'LIERO.EXE'));
const chr = fs.readFileSync(path.join(dir, 'LIERO.CHR'));
const snd = fs.readFileSync(path.join(dir, 'LIERO.SND'));

let p = 0;
const seek = (o: number) => { p = o; };
const u8 = () => exe[p++];
const s8 = () => { const v = exe.readInt8(p); p += 1; return v; };
const u16 = () => { const v = exe.readUInt16LE(p); p += 2; return v; };
const s16 = () => { const v = exe.readInt16LE(p); p += 2; return v; };
const s32 = () => { const v = exe.readInt32LE(p); p += 4; return v; };
const at16 = (o: number) => exe.readUInt16LE(o);
const atS16 = (o: number) => exe.readInt16LE(o);

// ---- constants ---------------------------------------------------------------
const C: Record<string, number> = {};
const s32d: [string, number, number][] = [['NRInitialLength', 0x32D7, 0x32DD], ['NRAttachLength', 0xA679, 0xA67F]];
for (const [n, a, b] of s32d) C[n] = at16(a) + (atS16(b) << 16);
const s24d: [string, number, number][] = [
  ['MinBounceUp', 0x3B7D, 0x3B74], ['MinBounceDown', 0x3B00, 0x3AF7], ['MinBounceLeft', 0x3A83, 0x3A7A], ['MinBounceRight', 0x3A06, 0x39FD],
  ['WormGravity', 0x3BDE, 0x3BD7], ['WalkVelLeft', 0x3F97, 0x3F9D], ['MaxVelLeft', 0x3F8C, 0x3F83], ['WalkVelRight', 0x4018, 0x401E],
  ['MaxVelRight', 0x400D, 0x4004], ['JumpForce', 0x3327, 0x332D], ['MaxAimVelLeft', 0x30F2, 0x30E9], ['AimAccLeft', 0x30FD, 0x3103],
  ['MaxAimVelRight', 0x311A, 0x3111], ['AimAccRight', 0x3125, 0x312B], ['NinjaropeGravity', 0xA895, 0xA89B], ['NRMinLength', 0x3206, 0x31FD],
  ['NRMaxLength', 0x3229, 0x3220], ['BonusGravity', 0x72C3, 0x72C9], ['BObjGravity', 0x744A, 0x7450],
];
for (const [n, a, b] of s24d) C[n] = at16(a) + (exe.readInt8(b) << 16);
const s16d: [string, number][] = [
  ['WormFricMult', 0x39BD], ['WormFricDiv', 0x39C7], ['WormMinSpawnDistLast', 0x242E], ['WormMinSpawnDistEnemy', 0x244B],
  ['AimFricMult', 0x3003], ['AimFricDiv', 0x300D], ['NRThrowVelX', 0x329B], ['NRThrowVelY', 0x32BF], ['NRForceShlX', 0xA8AD],
  ['NRForceDivX', 0xA8B7], ['NRForceShlY', 0xA8DA], ['NRForceDivY', 0xA8E4], ['NRForceLenShl', 0xA91E],
  ['SplinterLarpaVelDiv', 0x677D], ['SplinterCracklerVelDiv', 0x67D0],
];
for (const [n, a] of s16d) C[n] = atS16(a);
C.BloodLimit = at16(0xE686);
const u8d: [string, number][] = [
  ['AimMaxRight', 0x3030], ['AimMinRight', 0x304A], ['AimMaxLeft', 0x3066], ['AimMinLeft', 0x3080], ['NRColourBegin', 0x10FD2],
  ['NRColourEnd', 0x11069], ['LaserWeapon', 0x7255], ['FirstBloodColour', 0x2388], ['NumBloodColours', 0x2381],
];
for (const [n, a] of u8d) C[n] = exe[a];
const s8d: [string, number][] = [['NRPullVel', 0x31D0], ['NRReleaseVel', 0x31F0], ['BloodStepUp', 0xE67B], ['BloodStepDown', 0xE68E]];
for (const [n, a] of s8d) C[n] = exe.readInt8(a);

// ---- palette (6-bit VGA) ----------------------------------------------------------
seek(132774);
const palette: number[] = [];
for (let i = 0; i < 256; i++) {
  const r = u8() & 63, g = u8() & 63, b = u8() & 63;
  palette.push((Math.round(r * 255 / 63) << 16) | (Math.round(g * 255 / 63) << 8) | Math.round(b * 255 / 63));
}

// ---- materials --------------------------------------------------------------------
const materials = new Array(256).fill(0);
seek(0x01C2E0);
for (let i = 0; i < 5; i++) {
  const bits = exe.subarray(p, p + 32); p += 32;
  for (let j = 0; j < 256; j++) materials[j] |= ((bits[j >> 3] >> (j & 7)) & 1) << i;
}
{
  const bits = exe.subarray(0x01AEA8, 0x01AEA8 + 32);
  for (let j = 0; j < 256; j++) materials[j] |= ((bits[j >> 3] >> (j & 7)) & 1) << 5;
}

// ---- weapons / nobjects / sobjects ---------------------------------------------------
type Rec = Record<string, number | boolean | string>;
const cols = <T extends Rec>(arr: T[], key: string, read: () => number | boolean) => { for (const o of arr) (o as Rec)[key] = read(); };
const R8 = () => u8(), R16 = () => s16(), RB = () => u8() !== 0, D8 = () => u8() - 1, R32 = () => s32();

const weapons: Rec[] = Array.from({ length: 40 }, () => ({}));
seek(112806);
cols(weapons, 'detectDistance', R8); cols(weapons, 'affectByWorm', RB); cols(weapons, 'blowAway', R8);
seek(112966);
for (const [k, r] of [
  ['gravity', R16], ['shadow', RB], ['laserSight', RB], ['launchSound', D8], ['loopSound', RB], ['exploSound', D8], ['speed', R16],
  ['addSpeed', R16], ['distribution', R16], ['parts', R8], ['recoil', R8], ['multSpeed', R16], ['delay', R16], ['loadingTime', R16],
  ['ammo', R8], ['createOnExp', D8], ['dirtEffect', D8], ['leaveShells', R8], ['leaveShellDelay', R8], ['playReloadSound', RB],
  ['wormExplode', RB], ['explGround', RB], ['wormCollide', RB], ['fireCone', R8], ['collideWithObjects', RB], ['affectByExplosions', RB],
  ['bounce', R8], ['timeToExplo', R16], ['timeToExploV', R16], ['hitDamage', R8], ['bloodOnHit', R8], ['startFrame', R16], ['numFrames', R8],
  ['loopAnim', RB], ['shotType', R8], ['colorBullets', R8], ['splinterAmount', R8], ['splinterColour', R8], ['splinterType', D8],
  ['splinterScatter', R8], ['objTrailType', D8], ['objTrailDelay', R8], ['partTrailType', R8], ['partTrailObj', D8], ['partTrailDelay', R8],
] as [string, () => number | boolean][]) cols(weapons, k, r);
// wormCollide is read as a bool by OpenLiero but used as a 1-in-N chance; keep the raw byte.
seek(112966); // re-read raw wormCollide byte
{
  // Offset of wormCollide column = start + sum of preceding column sizes
  const sizes = [2, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
  const off = 112966 + sizes.reduce((s, n) => s + n * 40, 0);
  for (let i = 0; i < 40; i++) weapons[i].wormCollide = exe[off + i];
}
seek(0x1B676);
for (let i = 0; i < 40; i++) {
  const len = exe[p];
  weapons[i].name = exe.subarray(p + 1, p + 1 + len).toString('latin1');
  p += 14;
  weapons[i].id = i;
  weapons[i].chainExplosion = i === 34;
}

const sobjects: Rec[] = Array.from({ length: 14 }, () => ({}));
seek(115218);
for (const [k, r] of [['startSound', D8], ['numSounds', R8], ['animDelay', R8], ['startFrame', R8], ['numFrames', R8], ['detectRange', R8], ['damage', R8], ['blowAway', R32]] as [string, () => number][]) cols(sobjects, k, r);
seek(115368);
for (const [k, r] of [['shadow', RB], ['shake', R8], ['flash', R8], ['dirtEffect', D8]] as [string, () => number | boolean][]) cols(sobjects, k, r);

const nobjects: Rec[] = Array.from({ length: 24 }, () => ({}));
seek(111430);
for (const [k, r] of [
  ['detectDistance', R8], ['gravity', R16], ['speed', R16], ['speedV', R16], ['distribution', R16], ['blowAway', R8], ['bounce', R8],
  ['hitDamage', R8], ['wormExplode', RB], ['explGround', RB], ['wormDestroy', RB], ['bloodOnHit', R8], ['startFrame', R8], ['numFrames', R8],
  ['drawOnMap', RB], ['colorBullets', R8], ['createOnExp', D8], ['affectByExplosions', RB], ['dirtEffect', D8], ['splinterAmount', R8],
  ['splinterColour', R8], ['splinterType', D8], ['bloodTrail', RB], ['bloodTrailDelay', R8], ['leaveObj', D8], ['leaveObjDelay', R8],
  ['timeToExplo', R16], ['timeToExploV', R16],
] as [string, () => number | boolean][]) cols(nobjects, k, r);

const textures: Rec[] = Array.from({ length: 9 }, () => ({}));
seek(0x1C208); cols(textures, 'nDrawBack', RB);
seek(0x1C1EA); cols(textures, 'mFrame', R8);
seek(0x1C1F4); cols(textures, 'sFrame', R8);
seek(0x1C1FE); cols(textures, 'rFrame', R8);

// ---- sprites (LIERO.CHR, column-major) -------------------------------------------------
let q = 10;
function sprites(w: number, h: number, count: number): Uint8Array {
  const out = new Uint8Array(w * h * count);
  for (let i = 0; i < count; i++) {
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) out[i * w * h + y * w + x] = chr[q + x * h + y];
    q += w * h;
  }
  return out;
}
const large = sprites(16, 16, 110); q += 4;
const small = sprites(7, 7, 130); q += 4;
// Worm sprites: the original only shows 10x9 of them (crop x 2..11, y 0..8)
for (let i = 16; i < 16 + 21; i++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
  if (x < 2 || x > 11 || y > 8) large[i * 256 + y * 16 + x] = 0;
}

// ---- sounds (LIERO.SND: 8-bit signed, 22050 Hz) ----------------------------------------
const sounds: { name: string; data: string }[] = [];
{
  const count = snd.readUInt16LE(0);
  let o = 2;
  for (let i = 0; i < count; i++) {
    const name = snd.subarray(o, o + 8).toString('latin1').replace(/\0.*$/, '').trim(); o += 8;
    const off = snd.readUInt32LE(o); o += 4;
    const len = snd.readUInt32LE(o); o += 4;
    sounds.push({ name, data: snd.subarray(off, off + len).toString('base64') });
  }
}

const header = `// GENERATED by scripts/extract-liero.ts from the original Liero 1.33 files.
// Liero data © 1998 Joosa Riekkinen, available under the WTFPL (see liero-original/LICENSE.TXT).
`;
fs.mkdirSync('shared/liero', { recursive: true });
fs.writeFileSync('shared/liero/data.gen.ts', header + `
export const C = ${JSON.stringify(C)} as const;
export const PALETTE: number[] = ${JSON.stringify(palette)};
export const MATERIALS: number[] = ${JSON.stringify(materials)};
export const WEAPONS_RAW = ${JSON.stringify(weapons)};
export const NOBJECTS_RAW = ${JSON.stringify(nobjects)};
export const SOBJECTS_RAW = ${JSON.stringify(sobjects)};
export const TEXTURES_RAW = ${JSON.stringify(textures)};
export const LARGE_SPRITES_B64 = ${JSON.stringify(Buffer.from(large).toString('base64'))};
export const SMALL_SPRITES_B64 = ${JSON.stringify(Buffer.from(small).toString('base64'))};
`);
fs.writeFileSync('extension/src/game/liero-sounds.gen.ts', header + `
/** 8-bit signed PCM at 22050 Hz, base64. Index = Liero sound id. */
export const SOUNDS: { name: string; data: string }[] = ${JSON.stringify(sounds)};
`);
console.log('constants', Object.keys(C).length, 'weapons', weapons.length, 'sounds', sounds.length);
console.log(weapons.map((w) => w.name).join(', '));
console.log('sounds:', sounds.map((s, i) => `${i}:${s.name}`).join(' '));
console.log(JSON.stringify(C));
