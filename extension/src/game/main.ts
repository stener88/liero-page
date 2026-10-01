// Content-script game client. Injected on demand by the background worker.

import { PAGE_PX } from '../../../shared/constants.ts';
import { Reassembler, decodeMap, encodeMap, toChunks } from '../../../shared/codec.ts';
import { FRAME_CHUNK, FRAME_MAP, PROTOCOL_VERSION, cleanName, type C2S, type InputTuple, type S2C } from '../../../shared/protocol.ts';
import type { Terrain } from '../../../shared/terrain.ts';
import { DEFAULT_LOADOUT, ftoi } from '../../../shared/liero/data.ts';
import { LieroGame, PAGE_COLOR, TICK_RATE, applyBlit, applyDirtEffect, sanitizeLoadout, type Input as SimInput, type LWorm } from '../../../shared/liero/game.ts';
import {
  EV_BLIT, EV_DIRT, EV_PARTICLE, EV_SOBJ, EV_SOUND, EV_STAIN, FRAME_HIST, FRAME_SNAP, decodeHistory, decodeSnapshot,
  type GameEvent, type NObjNet, type WObjNet,
} from '../../../shared/liero/net.ts';
import { capturePage, type Capture } from './capture.ts';
import { Effects } from './effects.ts';
import { Input } from './input.ts';
import { LOADOUT_CSS, buildLoadout } from './loadout.ts';
import { Hud, UI_CSS, type ScoreRow } from './hud.ts';
import { Renderer, type Camera, type RObj, type RWorm } from './render.ts';
import { Sfx } from './sfx.ts';

declare const __DEFAULT_SERVER__: string;

export interface GameOpts {
  mode: 'host' | 'join';
  room?: string;
  server?: string;
  /** Running on liero.page (guest page or the landing-page demo) instead of inside the extension. */
  web?: boolean;
  onExit?: () => void;
}

const STEP = 1000 / TICK_RATE;
/**
 * Others, projectiles and effects are shown a few ticks in the past so they move smoothly between
 * snapshots (sent every 2 ticks). The delay adapts to how evenly snapshots arrive: ~3 ticks (43 ms)
 * on a steady connection, up to 8 on a jittery one.
 */
const INTERP_MIN = 3, INTERP_MAX = 8;
/** Zoom steps (Z key), relative to the base zoom that fits the map on screen. */
const ZOOMS = [1, 1.5, 2, 3];
/** Visual resolution of the map: match the host's screen (Retina = 2x). */
const CAPTURE_SCALE = () => Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));

interface Snap { tick: number; worms: Map<number, LWorm>; w: Map<number, WObjNet>; n: Map<number, NObjNet> }

function randomId(n = 8): string {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((v) => a[v % a.length]).join('');
}

export function wsUrl(server: string, room: string): string {
  let base = server.trim().replace(/\/+$/, '');
  if (!/^wss?:\/\//.test(base)) {
    base = (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(base) ? 'ws://' : 'wss://') + base;
  }
  return `${base}/room/${room}`;
}

const hasChromeStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.sync;

/** Settings live in chrome.storage in the extension and in localStorage on the guest web page. */
async function storeGet(keys: string[]): Promise<Record<string, unknown>> {
  if (hasChromeStorage()) {
    try { return await chrome.storage.sync.get(keys); } catch { /* fall through */ }
  }
  const out: Record<string, unknown> = {};
  try { for (const k of keys) { const v = localStorage.getItem(`liero:${k}`); if (v !== null) out[k] = JSON.parse(v); } } catch { /* blocked */ }
  return out;
}

async function storeSet(values: Record<string, unknown>): Promise<void> {
  if (hasChromeStorage()) {
    try { await chrome.storage.sync.set(values); return; } catch { /* fall through */ }
  }
  try { for (const [k, v] of Object.entries(values)) localStorage.setItem(`liero:${k}`, JSON.stringify(v)); } catch { /* blocked */ }
}

async function settings(): Promise<{ server: string; name: string; sound: boolean; loadout: number[] }> {
  const stored = await storeGet(['server', 'name', 'sound', 'loadout']) as { server?: string; name?: string; sound?: boolean; loadout?: number[] };
  let name = stored.name;
  if (!name) {
    name = `worm${Math.floor(Math.random() * 90 + 10)}`;
    await storeSet({ name });
  }
  // A saved address (e.g. localhost from testing) only applies to local dev builds.
  const isLocal = (x: string) => /^(wss?:\/\/|https?:\/\/)?(localhost|127\.|0\.0\.0\.0)/.test(x.trim());
  let server = stored.server?.trim() || __DEFAULT_SERVER__;
  if (!isLocal(__DEFAULT_SERVER__)) server = __DEFAULT_SERVER__; // release builds always use the real server
  return { server, name, sound: stored.sound !== false, loadout: sanitizeLoadout(stored.loadout ?? DEFAULT_LOADOUT) };
}

/** https://host for a server address (http:// for local dev). */
export function httpBase(server: string): string {
  const host = server.trim().replace(/^(wss?|https?):\/\//, '').replace(/\/+$/, '');
  return (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) ? 'http://' : 'https://') + host;
}

export class Game {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private renderer: Renderer;
  private input: Input;
  private ws: WebSocket | null = null;
  private sfx = new Sfx();
  private inbox: Promise<void> = Promise.resolve();
  private rx = new Reassembler();
  private raf = 0;
  private dead = false;

  private room: string;
  private server = '';
  private myIdx = -1;
  private roster = new Map<number, { n: string; c: string }>();
  private terrain: Terrain | null = null;
  private fx: Effects | null = null;
  private predictor: LieroGame | null = null;
  private capture: Capture | null = null;
  private me: LWorm | null = null;
  private loadout: number[] = DEFAULT_LOADOUT.slice();
  private seq = 0;
  private pending: { seq: number; inp: SimInput }[] = [];
  private outbox: InputTuple[] = [];
  private snaps: Snap[] = [];
  private events: { tick: number; e: GameEvent }[] = [];
  private visualTick = -1;
  private tickOffset: number | null = null;
  private jitter = 0; // ms, how unevenly snapshots arrive
  private interp = INTERP_MAX;
  private latest: Snap | null = null;
  private smooth = { x: 0, y: 0 };
  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private zoomIdx = 0;
  private follow = 0; // 0 = camera on the page view, 1 = following the worm
  private introStart = performance.now();
  private status = 'Connecting…';
  private mapAt = 0;
  private lastSend = 0;
  private started = false;
  private serverError = '';
  private ping = -1;
  private acc = 0;
  private last = performance.now();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private prevOverflow = '';
  private hud: Hud | null = null;
  private name = '';
  private notes: { text: string; color: string }[] = []; // feed lines from before the HUD exists
  private picker: ReturnType<typeof buildLoadout> | null = null;

  constructor(private opts: GameOpts) {
    this.room = opts.room ?? randomId();
    this.host = document.createElement('liero-root');
    this.host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;contain:strict;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = UI_CSS + LOADOUT_CSS;
    this.shadow.appendChild(style);
    this.renderer = new Renderer(this.shadow);
    this.input = new Input(this.renderer.canvas);
    // Esc: close the weapon picker, otherwise open/close the menu (Leave is in there).
    this.input.onEscape = () => { if (this.picker?.open) this.picker.close(); else if (this.hud) this.hud.toggleMenu(); else this.destroy(); };
    this.input.onZoom = () => { this.zoomIdx = (this.zoomIdx + 1) % ZOOMS.length; };
    this.input.onMute = () => this.toggleSound();
    this.input.onLoadout = () => this.toggleLoadout();
    // Browsers only allow audio after a key press or click; unlock it on the first one.
    this.input.onActivity = () => { if (this.sfx.enabled) this.sfx.ensure(); };
  }

  async start() {
    // The overlay is transparent until the map arrives; the capture ignores it.
    document.documentElement.appendChild(this.host);
    window.addEventListener('resize', this.onResize);
    this.raf = requestAnimationFrame(this.frame);
    if (this.opts.mode === 'host') {
      this.capture = await this.capturePage();
      const c = this.capture;
      this.cam = { x: (window.scrollX - c.originX + window.innerWidth / 2) / PAGE_PX, y: (window.scrollY - c.originY + window.innerHeight / 2) / PAGE_PX, zoom: PAGE_PX };
      this.introStart = performance.now();
    }
    this.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const s = await settings();
    this.server = this.opts.server || s.server;
    this.sfx.enabled = s.sound;
    this.loadout = s.loadout;
    this.name = s.name;
    this.hud = new Hud(this.shadow, {
      link: this.inviteLink(),
      name: s.name,
      soundOn: s.sound,
      hostUrl: this.opts.web ? `${httpBase(this.server)}/` : null,
      onExit: () => this.destroy(),
      onSound: () => this.toggleSound(),
      onZoom: () => { this.zoomIdx = (this.zoomIdx + 1) % ZOOMS.length; },
      onLoadout: () => this.toggleLoadout(),
      onName: (n) => {
        this.name = cleanName(n);
        void storeSet({ name: this.name });
        this.send({ t: 'name', n: this.name });
      },
      onMenu: () => this.syncPause(),
    });
    for (const n of this.notes) this.hud.note(n.text, n.color);
    this.notes = [];
    this.picker = buildLoadout(this.shadow, this.loadout, (lo) => {
      this.loadout = lo;
      void storeSet({ loadout: lo });
      this.send({ t: 'loadout', l: lo });
      this.pushFeed('New weapons ready when you respawn', '#ffd23f');
    });
    this.picker.onOpenChange = () => this.syncPause();
    this.connect(s.name);
  }

  private toggleLoadout() {
    if (!this.picker) return;
    this.hud?.toggleMenu(false);
    this.picker.toggle();
  }

  /** No game input while a menu is open. */
  private syncPause() {
    this.input.paused = !!(this.picker?.open || this.hud?.menuOpen);
  }

  /** Invite links open the guest web page, so friends can join without the extension. */
  private inviteLink(): string {
    return `${httpBase(this.server)}/r/${this.room}`;
  }

  private connect(name: string) {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.server, this.room));
    } catch (e) {
      this.status = `Can't connect to ${this.server}`;
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.status = 'Waiting for the map…';
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name, lo: this.loadout });
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    ws.onclose = (ev) => {
      if (this.dead) return;
      console.warn('[liero] socket closed', ev.code, ev.reason, 'opened:', opened);
      if (!opened) this.status = `Can't reach the game server at ${this.server} — is \`npm run server\` running?`;
      else if (ev.code === 4000) this.status = 'The game server is out of date — restart it (Ctrl+C, then npm run server)';
      else if (ev.code === 4001) this.status = 'Room is full';
      else if (this.serverError) this.status = `Server error: ${this.serverError}`;
      else this.status = 'Lost connection to the game server. Press Esc, leave, and try again.';
    };
    ws.onerror = () => { /* onclose follows with the details */ };
    // Messages are handled strictly in order (decoding the map is async and everything else must wait for it).
    ws.onmessage = (ev) => {
      const data = ev.data;
      this.inbox = this.inbox.then(async () => {
        if (this.dead) return;
        if (typeof data === 'string') this.onMessage(JSON.parse(data) as S2C);
        else await this.onBinary(new Uint8Array(data as ArrayBuffer));
      }).catch((e) => { console.error('[liero]', e); this.status = String(e?.message ?? e); });
    };
  }

  private send(m: C2S) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private async onBinary(data: Uint8Array) {
    if (data[0] === FRAME_SNAP) { if (this.terrain) this.onSnap(data); return; }
    if (data[0] !== FRAME_CHUNK) return;
    const buf = this.rx.push(data);
    if (!buf) { if (!this.terrain) this.status = 'Downloading the map…'; return; }
    if (buf[0] === FRAME_HIST) {
      // Everything that happened to the page before we joined.
      for (const e of decodeHistory(buf)) this.applyEvent(e, true);
      return;
    }
    if (buf[0] !== FRAME_MAP) return;
    const { header, terrain, fg, bg } = await decodeMap(buf);
    const fgImg = await createImageBitmap(new Blob([fg as BlobPart], { type: 'image/webp' }));
    const bgImg = bg.length ? await createImageBitmap(new Blob([bg as BlobPart], { type: 'image/webp' })) : null;
    this.renderer.setMap(terrain, fgImg, bgImg, header.scale, header.bg);
    if (!this.capture) this.introStart = performance.now();
    this.mapAt = performance.now() + 300;
    fgImg.close(); bgImg?.close();
    this.terrain = terrain;
    this.fx = new Effects(terrain);
    this.predictor = new LieroGame(terrain, {}, 1);
    this.predictor.predictSound = (s) => this.sfx.play(s, 0.9, 0);
    if (!this.capture) {
      // Joiner: start the camera in the middle of the map.
      const fit = Math.max(1, Math.min(4, window.innerWidth / terrain.w));
      this.cam = { x: terrain.w / 2, y: terrain.h / 2, zoom: fit };
    }
    this.status = '';
    this.hud?.setTitle(header.title || header.url);
    this.hud?.showHints();
  }

  private onMessage(m: S2C) {
    switch (m.t) {
      case 'welcome':
        this.myIdx = m.id;
        if (m.needTerrain) {
          // A guest whose host has left has no page to offer (the demo on liero.page hosts its own page).
          if (this.opts.web && this.opts.mode === 'join') this.status = 'This game has ended. Ask your friend for a new invite link.';
          else void this.uploadTerrain();
        }
        break;
      case 'roster':
        this.roster = new Map(m.p.map((p) => [p.i, { n: p.n, c: p.c }]));
        break;
      case 'frag': {
        const who = (i: number) => ({ name: this.roster.get(i)?.n ?? '?', color: this.roster.get(i)?.c ?? '#fff' });
        this.hud?.kill(who(m.k), who(m.v), m.w ?? -1, m.k === this.myIdx || m.v === this.myIdx, m.v === this.myIdx, m.k === m.v);
        break;
      }
      case 'join': if (m.i !== this.myIdx) this.pushFeed(`${m.n} joined`, '#9aa3b2'); break;
      case 'leave': this.pushFeed(`${m.n} left`, '#9aa3b2'); break;
      case 'pong': this.ping = Math.round(performance.now() - m.c); break;
      case 'err': this.serverError = m.m; this.status = m.m; break;
    }
  }

  /** Screenshot the tab (with our overlay hidden) and build the map from it; DOM redraw as fallback. */
  private async capturePage(): Promise<Capture> {
    this.status = 'Capturing the page…';
    this.host.style.visibility = 'hidden';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 50));
    let shot: HTMLImageElement | null = null;
    const ext = typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;
    if (ext) try {
      const url: string | null = await chrome.runtime.sendMessage({ type: 'liero:shot' });
      if (url) { shot = new Image(); shot.src = url; await shot.decode(); }
    } catch (e) { console.warn('[liero] screenshot unavailable, redrawing from the DOM', e); shot = null; }
    try {
      return await capturePage(this.host, CAPTURE_SCALE(), shot);
    } finally {
      this.host.style.visibility = 'visible';
    }
  }

  private async uploadTerrain() {
    // Joiners whose host already left become the new host using their own copy of the page.
    if (!this.capture) {
      this.capture = await this.capturePage();
    }
    this.status = 'Uploading the map…';
    const c = this.capture;
    const frame = await encodeMap({ header: c.header, mask: c.mask, fg: c.fg, bg: c.bg });
    for (const ch of toChunks(frame)) this.ws?.send(ch);
  }

  private pushFeed(text: string, color: string) {
    if (this.hud) this.hud.note(text, color);
    else this.notes.push({ text, color });
  }

  private onSnap(data: Uint8Array) {
    const now = performance.now();
    const m = decodeSnapshot(data);
    const snap: Snap = {
      tick: m.tick,
      worms: new Map(m.worms.map((w) => [w.idx, w])),
      w: new Map(m.w.map((o) => [o.id, o])),
      n: new Map(m.n.map((o) => [o.id, o])),
    };
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();
    this.latest = snap;
    const off = m.tick * STEP - now;
    if (this.tickOffset === null || Math.abs(off - this.tickOffset) > 500) {
      this.tickOffset = off;
    } else {
      // A late snapshot has off < tickOffset; that lateness is what the interpolation delay must cover.
      this.jitter = Math.max(this.jitter * 0.995, this.tickOffset - off);
      this.tickOffset += (off - this.tickOffset) * 0.05;
    }
    for (const e of m.ev) this.events.push({ tick: m.tick - e.dt, e });
    if (this.visualTick < 0) this.visualTick = m.tick - INTERP_MAX - 2;

    const mine = snap.worms.get(this.myIdx);
    if (mine && this.predictor) {
      const before = this.me ? { x: this.me.x, y: this.me.y, visible: this.me.visible } : null;
      const me = structuredClone(mine);
      this.pending = this.pending.filter((p) => p.seq > m.ack);
      this.predictor.cycles = m.tick;
      this.predictor.silent = true;
      for (const p of this.pending) this.predictor.predictWorm(me, p.inp);
      this.predictor.silent = false;
      this.me = me;
      if (before && before.visible && me.visible) {
        const ex = (before.x - me.x) / 65536, ey = (before.y - me.y) / 65536;
        if (Math.hypot(ex + this.smooth.x, ey + this.smooth.y) < 40) { this.smooth.x += ex; this.smooth.y += ey; }
        else this.smooth = { x: 0, y: 0 };
      } else {
        this.smooth = { x: 0, y: 0 };
      }
    }
  }

  /** Apply something that happened in the game, at the moment it should be seen. */
  private applyEvent(e: GameEvent, history = false) {
    const t = this.terrain;
    if (!t) return;
    switch (e.k) {
      case EV_DIRT: {
        applyDirtEffect(t, e.e, e.x, e.y, e.f, (x, y, c) => this.renderer.paint(x, y, c));
        this.renderer.updateEdges(e.x - 1, e.y - 1, e.x + 17, e.y + 17);
        break;
      }
      case EV_BLIT: {
        applyBlit(t, e.s, e.x, e.y, (x, y, c) => this.renderer.paint(x, y, c));
        this.renderer.updateEdges(e.x - 1, e.y - 1, e.x + 8, e.y + 8);
        break;
      }
      case EV_STAIN:
        if (e.x >= 0 && e.y >= 0 && e.x < t.w && e.y < t.h && t.data[e.y * t.w + e.x]) this.renderer.paint(e.x, e.y, e.c);
        break;
      case EV_SOBJ:
        if (!history) this.fx?.addAnim(e.t, e.x, e.y, this.inView(e.x, e.y));
        break;
      case EV_PARTICLE:
        if (!history) this.fx?.addParticle({ t: e.t, x: e.x, y: e.y, vx: e.vx, vy: e.vy, f: e.f, color: e.f === PAGE_COLOR ? this.renderer.pageColor(ftoi(e.x), ftoi(e.y)) : '' });
        break;
      case EV_SOUND:
        // Our own shots, rope throws and reloads were already played when we predicted them.
        if (!history && !(e.launch && e.w === this.myIdx)) this.sfx.play(e.s, this.volFor(e.x, e.y), this.panFor(e.x));
        break;
    }
  }

  private inView(x: number, y: number) {
    const sw = window.innerWidth / this.cam.zoom / 2, sh = window.innerHeight / this.cam.zoom / 2;
    return Math.abs(x - this.cam.x) < sw && Math.abs(y - this.cam.y) < sh;
  }

  /** Stereo position of a world x relative to the camera (-1 left … 1 right). */
  private panFor(x: number): number {
    const half = window.innerWidth / 2 / this.cam.zoom;
    return Math.max(-1, Math.min(1, (x - this.cam.x) / half)) * 0.7;
  }

  /** Quieter the further away from you it happens. */
  private volFor(x: number, y: number): number {
    const me = this.me;
    const ref = me?.visible ? { x: me.x / 65536, y: me.y / 65536 } : { x: this.cam.x, y: this.cam.y };
    return Math.max(0.25, Math.min(1, 1.15 - Math.hypot(x - ref.x, y - ref.y) / 900));
  }

  private toggleSound(): boolean {
    const on = !this.sfx.enabled;
    this.sfx.setEnabled(on);
    void storeSet({ sound: on });
    this.hud?.setSound(on);
    return on;
  }

  /** Mouse position as a Liero angle (0 = down, 32 = left, 64 = up, 96 = right). */
  private aimFor(me: LWorm): number {
    const sw = window.innerWidth, sh = window.innerHeight;
    const wx = this.cam.x + (this.input.mouseX - sw / 2) / this.cam.zoom;
    const wy = this.cam.y + (this.input.mouseY - sh / 2) / this.cam.zoom;
    const rx = me.x / 65536 + this.smooth.x, ry = me.y / 65536 + this.smooth.y - 1;
    const dx = wx - rx, dy = wy - ry;
    if (Math.hypot(dx, dy) < 2) return me.aim / 65536;
    const a = (Math.atan2(-dx, dy) * 64) / Math.PI;
    return Math.round((((a % 128) + 128) % 128) * 100) / 100;
  }

  private tick() {
    if (!this.terrain || this.myIdx < 0 || !this.predictor) return;
    const me = this.me;
    const inp: SimInput = {
      k: this.input.keys(!!me && me.rope.out),
      a: me ? this.aimFor(me) : 96,
      w: this.input.weapon,
    };
    this.seq++;
    this.pending.push({ seq: this.seq, inp });
    if (this.pending.length > 240) this.pending.shift();
    this.outbox.push([this.seq, inp.k, inp.a, inp.w]);
    if (me) this.predictor.predictWorm(me, inp);
  }

  /** Interpolate between the two snapshots around render tick `rt`. */
  private bracket(rt: number): { a: Snap; b: Snap | null; f: number } | null {
    if (!this.snaps.length) return null;
    let a: Snap | null = null, b: Snap | null = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] ?? null; break; }
    }
    if (!a) a = this.snaps[0];
    const f = b ? Math.max(0, Math.min(1, (rt - a.tick) / (b.tick - a.tick))) : 0;
    return { a, b, f };
  }

  private frame = (now: number) => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(250, now - this.last);
    this.last = now;
    this.acc += dt;
    while (this.acc >= STEP) { this.tick(); this.acc -= STEP; }
    // Batch inputs at ~35 Hz: half the messages (and server cost) for ~14 ms of extra latency.
    if (this.outbox.length >= 2 || (this.outbox.length && now - this.lastSend > 30)) {
      this.send({ t: 'in', i: this.outbox });
      this.outbox = [];
      this.lastSend = now;
    }
    if (!this.started && this.input.keys(false) !== 0) {
      this.started = true;
      setTimeout(() => this.hud?.hideHints(), 4000);
    }
    const k = dt / STEP;
    this.smooth.x *= Math.pow(0.85, k);
    this.smooth.y *= Math.pow(0.85, k);

    // Delayed timeline: events and effects happen when interpolated objects get there.
    // 2 ticks between snapshots + measured lateness, eased so the timeline never jumps.
    const want = Math.max(INTERP_MIN, Math.min(INTERP_MAX, 2 + this.jitter / STEP + 0.5));
    this.interp += (want - this.interp) * Math.min(1, dt / 1000);
    const rt = this.tickOffset === null ? -1 : (now + this.tickOffset) / STEP - this.interp;
    if (this.fx && rt >= 0) {
      let steps = 0;
      while (this.visualTick < Math.floor(rt) && steps++ < 200) {
        this.visualTick++;
        while (this.events.length && this.events[0].tick <= this.visualTick) this.applyEvent(this.events.shift()!.e);
        this.fx.step(this.visualTick);
      }
      if (this.visualTick < Math.floor(rt)) this.visualTick = Math.floor(rt);
    }

    const worms: RWorm[] = [];
    const wobj: RObj[] = [], nobj: RObj[] = [];
    const br = rt >= 0 ? this.bracket(rt) : null;
    const meta = (i: number) => this.roster.get(i) ?? { n: `worm${i}`, c: '#ccc' };
    if (this.me) worms.push({ w: this.me, x: this.me.x / 65536 + this.smooth.x, y: this.me.y / 65536 + this.smooth.y, color: meta(this.myIdx).c, name: meta(this.myIdx).n, me: true });
    if (br) {
      const { a, b, f } = br;
      const lerp = (p: number, q: number) => p + (q - p) * f;
      for (const [idx, wb] of (b ?? a).worms) {
        if (idx === this.myIdx) continue;
        const wa = a.worms.get(idx);
        const w = structuredClone(wb);
        let x = wb.x / 65536, y = wb.y / 65536;
        if (b && wa && wa.visible && wb.visible) {
          x = lerp(wa.x, wb.x) / 65536; y = lerp(wa.y, wb.y) / 65536;
          if (wa.rope.out && wb.rope.out) { w.rope.x = lerp(wa.rope.x, wb.rope.x); w.rope.y = lerp(wa.rope.y, wb.rope.y); }
        }
        worms.push({ w, x, y, color: meta(idx).c, name: meta(idx).n, me: false });
      }
      for (const [id, ob] of (b ?? a).w) {
        const oa = a.w.get(id);
        wobj.push(oa && b ? { t: ob.t, x: lerp(oa.x, ob.x), y: lerp(oa.y, ob.y), f: ob.f } : { t: ob.t, x: ob.x, y: ob.y, f: ob.f });
      }
      for (const [id, ob] of (b ?? a).n) {
        const oa = a.n.get(id);
        nobj.push(oa && b ? { t: ob.t, x: lerp(oa.x, ob.x), y: lerp(oa.y, ob.y), f: ob.f } : { t: ob.t, x: ob.x, y: ob.y, f: ob.f });
      }
    }
    const scores: ScoreRow[] = [];
    if (this.latest) {
      for (const [idx, w] of this.latest.worms) scores.push({ idx, name: meta(idx).n, color: meta(idx).c, kills: w.kills, deaths: w.deaths, me: idx === this.myIdx });
      scores.sort((p, q) => q.kills - p.kills || p.deaths - q.deaths);
    }
    const mine = worms.find((w) => w.me);
    this.updateCamera(dt, mine);

    const intro = this.terrain ? Math.min(1, (now - this.introStart) / 700) : 0.55;
    const cam = { ...this.cam };
    if (this.fx && this.fx.shake > 0) {
      const s = this.fx.shake / 65536;
      cam.x += (Math.random() - 0.5) * 2 * s / cam.zoom;
      cam.y += (Math.random() - 0.5) * 2 * s / cam.zoom;
    }
    if (this.fx) {
      this.renderer.draw({
        cam, worms, wobj, nobj, fx: this.fx, me: this.me, intro, cycles: this.visualTick,
        // Outline of solid ground: flashes when the map appears, then hides (the page stays untouched); hold Tab to see it.
        outline: this.input.has('Tab') ? 0.95 : 0.9 * Math.max(0, 1 - (now - this.mapAt) / 2500),
      });
    } else {
      this.renderer.draw({
        cam, worms: [], wobj: [], nobj: [], fx: new Effects({ w: 1, h: 1, data: new Uint8Array(1) } as Terrain), me: null,
        intro, cycles: 0, outline: 0,
      });
    }
    const vw = window.innerWidth / 2, vh = window.innerHeight / 2, z = this.cam.zoom;
    const onScreen = worms.filter((r) => r.w.visible).map((r) => ({ x: (r.x - this.cam.x) * z + vw, y: (r.y - this.cam.y) * z + vh }));
    this.hud?.update({ me: this.me, worms: onScreen, scores, ping: this.ping, status: this.status });
  };

  private updateCamera(dt: number, me?: RWorm) {
    const t = this.terrain;
    if (!t) return;
    // Base zoom: the host sees the page exactly where it was; guests get the whole map fitted to their window.
    // (Fit the width; tall pages scroll with the worm.)
    const base = this.capture ? PAGE_PX : Math.max(1, Math.min(4, window.innerWidth / t.w));
    const target = base * ZOOMS[this.zoomIdx];
    // Hold the page view for a moment so the page visibly turns into the level, then fly to the worm.
    const held = performance.now() - this.introStart > 1100;
    if (me && me.w.visible && held) this.follow = Math.min(1, this.follow + dt / 1200);
    const f = this.follow * this.follow * (3 - 2 * this.follow); // smoothstep
    const start = base;
    const zoom = start + (target - start) * f;
    this.cam.zoom += (zoom - this.cam.zoom) * Math.min(1, dt / 120);
    if (!me || (this.follow === 0 && this.capture)) return;
    const sw = window.innerWidth / this.cam.zoom, sh = window.innerHeight / this.cam.zoom;
    let tx = me.x, ty = me.y;
    // When the map fits the screen it stays pinned exactly where the page was; otherwise follow, never past the edges.
    tx = t.w <= sw + 0.5 ? t.w / 2 : Math.max(sw / 2, Math.min(t.w - sw / 2, tx));
    ty = t.h <= sh + 0.5 ? t.h / 2 : Math.max(sh / 2, Math.min(t.h - sh / 2, ty));
    const ease = f < 1 ? 0.04 + 0.2 * f : Math.min(1, dt / 60);
    this.cam.x += (tx - this.cam.x) * ease;
    this.cam.y += (ty - this.cam.y) * ease;
  }

  private onResize = () => this.renderer.resize();

  destroy() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
    this.input.destroy();
    this.sfx.destroy();
    window.removeEventListener('resize', this.onResize);
    this.host.remove();
    document.documentElement.style.overflow = this.prevOverflow;
    const w = window as unknown as { __lieroGame?: Game };
    if (w.__lieroGame === this) delete w.__lieroGame;
    this.opts.onExit?.();
  }
}
