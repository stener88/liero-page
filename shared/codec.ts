// Binary codecs. Uses CompressionStream, which exists in browsers, Node >= 18 and Cloudflare Workers.
//
// Map frame:   [u8 FRAME_MAP][u32 headerLen][header JSON][u32 maskLen][deflated mask][fg bytes][bg bytes]
// Chunk frame: [u8 FRAME_CHUNK][u32 id][u32 index][u32 total][payload]
// Every binary message on the wire is a chunk frame (WebSocket messages are capped at 1 MiB on Workers).

import { FRAME_CHUNK, FRAME_MAP, type MapHeader } from './protocol.ts';
import { Terrain } from './terrain.ts';

async function pipe(data: Uint8Array, ts: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ts as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const deflate = (d: Uint8Array) => pipe(d, new CompressionStream('deflate'));
export const inflate = (d: Uint8Array) => pipe(d, new DecompressionStream('deflate'));

export const MAX_MAP_BYTES = 12 * 1024 * 1024;
const CHUNK = 256 * 1024;

export interface MapData { header: MapHeader; mask: Uint8Array; fg: Uint8Array; bg: Uint8Array }

export async function encodeMap(m: MapData): Promise<Uint8Array> {
  const header = { ...m.header, fgLen: m.fg.length, bgLen: m.bg.length };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const mask = await deflate(m.mask);
  const out = new Uint8Array(1 + 4 + json.length + 4 + mask.length + m.fg.length + m.bg.length);
  const dv = new DataView(out.buffer);
  let o = 0;
  out[o++] = FRAME_MAP;
  dv.setUint32(o, json.length); o += 4;
  out.set(json, o); o += json.length;
  dv.setUint32(o, mask.length); o += 4;
  out.set(mask, o); o += mask.length;
  out.set(m.fg, o); o += m.fg.length;
  out.set(m.bg, o);
  return out;
}

export async function decodeMap(buf: Uint8Array): Promise<MapData & { terrain: Terrain }> {
  if (buf[0] !== FRAME_MAP) throw new Error('not a map frame');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 1;
  const hl = dv.getUint32(o); o += 4;
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(o, o + hl))) as MapHeader; o += hl;
  if (!(header.w > 0 && header.h > 0 && header.w * header.h <= 4_000_000)) throw new Error('bad map size');
  if (!(header.scale >= 1 && header.scale <= 6)) throw new Error('bad map scale');
  const ml = dv.getUint32(o); o += 4;
  const mask = await inflate(buf.subarray(o, o + ml)); o += ml;
  if (mask.length !== header.w * header.h) throw new Error('mask size mismatch');
  if (o + header.fgLen + header.bgLen !== buf.length) throw new Error('image size mismatch');
  const fg = buf.slice(o, o + header.fgLen); o += header.fgLen;
  const bg = buf.slice(o, o + header.bgLen);
  return { header, mask, fg, bg, terrain: new Terrain(header.w, header.h, mask) };
}

let chunkSeq = 1;
export function toChunks(buf: Uint8Array): Uint8Array[] {
  const id = chunkSeq++ >>> 0;
  const total = Math.max(1, Math.ceil(buf.length / CHUNK));
  const out: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const part = buf.subarray(i * CHUNK, (i + 1) * CHUNK);
    const f = new Uint8Array(13 + part.length);
    const dv = new DataView(f.buffer);
    f[0] = FRAME_CHUNK;
    dv.setUint32(1, id); dv.setUint32(5, i); dv.setUint32(9, total);
    f.set(part, 13);
    out.push(f);
  }
  return out;
}

/** Collects chunk frames; returns the whole message once complete. */
export class Reassembler {
  private id = -1;
  private parts: Uint8Array[] = [];
  private got = 0;
  private bytes = 0;

  push(f: Uint8Array): Uint8Array | null {
    if (f[0] !== FRAME_CHUNK || f.length < 13) throw new Error('bad chunk');
    const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
    const id = dv.getUint32(1), idx = dv.getUint32(5), total = dv.getUint32(9);
    if (total < 1 || total > Math.ceil(MAX_MAP_BYTES / CHUNK) || idx >= total) throw new Error('bad chunk index');
    if (id !== this.id) { this.id = id; this.parts = new Array(total); this.got = 0; this.bytes = 0; }
    if (!this.parts[idx]) {
      this.parts[idx] = f.slice(13);
      this.got++;
      this.bytes += f.length - 13;
      if (this.bytes > MAX_MAP_BYTES) { this.id = -1; throw new Error('map too large'); }
    }
    if (this.got < total) return null;
    const out = new Uint8Array(this.bytes);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    this.id = -1; this.parts = [];
    return out;
  }
}

