// On-screen UI, as DOM inside the game's shadow root: top bar, scoreboard, kill feed, health and
// weapon bar, respawn banner, first-play hints, and the Esc menu. Updated every frame, but each
// element is only touched when what it shows changes.

import { WEAPONS } from '../../../shared/liero/data.ts';
import { MAX_HEALTH, TICK_RATE, weaponAvailable, type LWorm } from '../../../shared/liero/game.ts';
import { niceName, weaponIcon } from './weapons-info.ts';

export const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.ui { position: absolute; inset: 0; pointer-events: none; color: #e9ecf2;
  font: 13px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
.glass { background: rgba(14,16,22,.82); border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
  backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
  box-shadow: 0 8px 28px rgba(0,0,0,.35); }
.num { font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
button { font: inherit; cursor: pointer; border: 0; border-radius: 8px; padding: 7px 12px; font-weight: 650;
  color: #e9ecf2; background: rgba(255,255,255,.08); transition: background .12s, transform .06s; }
button:hover { background: rgba(255,255,255,.14); }
button:active { transform: translateY(1px); }
button.primary { background: #ffd23f; color: #12141a; }
button.primary:hover { background: #ffdc66; }
button.danger { background: rgba(255,90,95,.14); color: #ff8a8e; }
button.danger:hover { background: rgba(255,90,95,.24); }
kbd { display: inline-block; min-width: 20px; padding: 1px 6px; border-radius: 5px; text-align: center;
  font: 600 11px/18px ui-monospace, Menlo, monospace; color: #e9ecf2; background: rgba(255,255,255,.1);
  border: 1px solid rgba(255,255,255,.14); border-bottom-width: 2px; }
.wicon { image-rendering: pixelated; width: 21px; height: 21px; flex: none; }
[hidden] { display: none !important; }
.dim { opacity: .22 !important; }
.top, .side { transition: opacity .2s; }

/* top bar */
.top { position: absolute; left: 12px; top: 12px; display: flex; align-items: center; gap: 6px; padding: 5px;
  pointer-events: auto; border-radius: 999px; }
.brand { font: 800 12px/1 ui-monospace, Menlo, monospace; letter-spacing: .12em; color: #ffd23f; padding: 0 8px 0 10px; }
.players { display: flex; align-items: center; gap: 6px; color: #aab2c0; padding: 0 8px; font-size: 12px; }
.dots { display: flex; gap: 3px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; display: block; }
.top button { border-radius: 999px; padding: 6px 12px; font-size: 12px; }
.top .menu-btn { display: flex; align-items: center; gap: 6px; }
.top .menu-btn kbd { font-size: 10px; line-height: 14px; min-width: 0; padding: 0 4px; }

/* status toast */
.status { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); padding: 8px 14px; max-width: min(560px, calc(100vw - 32px));
  text-align: center; font-weight: 600; }

/* scoreboard + feed */
.side { position: absolute; right: 12px; top: 12px; width: 210px; display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.scores { padding: 8px 6px 6px; }
.scores .head { display: flex; justify-content: space-between; padding: 0 8px 6px; color: #8a93a3; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
.row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 7px; }
.row.me { background: rgba(255,210,63,.12); }
.row .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .k { font-weight: 700; width: 24px; text-align: right; }
.row .d { color: #8a93a3; width: 24px; text-align: right; }
.feed { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.fi { display: flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 8px; font-size: 12px; font-weight: 600;
  background: rgba(14,16,22,.72); animation: fin .18s ease-out; transition: opacity .4s; white-space: nowrap; max-width: 100%; }
.fi.mine { box-shadow: inset 0 0 0 1px rgba(255,210,63,.6); }
.fi.note { color: #aab2c0; font-weight: 500; }
.fi .wicon { width: 14px; height: 14px; }
.fi.out { opacity: 0; }
@keyframes fin { from { transform: translateX(12px); opacity: 0; } }

/* bottom: health + weapons */
.bottom { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; align-items: stretch; gap: 5px;
  width: min(720px, calc(100vw - 20px)); transition: opacity .2s; }
.hp { position: relative; display: flex; align-items: center; gap: 6px; width: 92px; flex: none; padding: 6px 10px 10px; border-radius: 10px; }
.hp .bar { position: absolute; left: 9px; right: 9px; bottom: 5px; height: 3px; border-radius: 99px; background: rgba(255,255,255,.1); overflow: hidden; }
.hp .fill { height: 100%; width: 100%; border-radius: 99px; background: #7cff6b; transition: width .15s, background .2s; }
.hp .val { font-weight: 750; font-size: 15px; }
.slots { display: flex; gap: 5px; flex: 1; min-width: 0; }
.slot { position: relative; flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 6px 8px 10px;
  border-radius: 10px; color: #c5ccd8; transition: transform .1s, background .1s, box-shadow .1s; }
.slot .key { position: absolute; left: 6px; top: -7px; font: 700 10px/14px ui-monospace, Menlo, monospace; padding: 0 5px; border-radius: 5px;
  background: #2a2f3a; color: #aab2c0; }
.slot .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 12px; }
.slot .ammo { position: absolute; left: 8px; right: 8px; bottom: 4px; height: 3px; border-radius: 9px; background: rgba(255,255,255,.1); overflow: hidden; }
.slot .ammo i { display: block; height: 100%; background: rgba(255,255,255,.55); border-radius: 9px; }
.slot.reload .ammo i { background: #ff7a7e; }
.slot.reload .nm { opacity: .55; }
.slot.sel { transform: translateY(-3px); color: #fff; background: rgba(30,32,40,.92); box-shadow: 0 0 0 2px #ffd23f, 0 10px 24px rgba(0,0,0,.4); }
.slot.sel .key { background: #ffd23f; color: #12141a; }
.slot.sel .ammo i { background: #ffd23f; }
.slot.sel.reload .ammo i { background: #ff7a7e; }
@media (max-width: 640px) { .slot .nm { display: none; } .slot { justify-content: center; } .side { width: 170px; } }

/* respawn + hints */
.respawn { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); text-align: center; padding: 16px 26px; }
.respawn .big { font-size: 22px; font-weight: 800; }
.respawn .by { color: #aab2c0; margin-top: 4px; }
.hints { position: absolute; left: 50%; bottom: 72px; transform: translateX(-50%); display: flex; gap: 14px; padding: 8px 14px; color: #c5ccd8;
  font-size: 12px; white-space: nowrap; transition: opacity .6s; }
.hints span { display: flex; align-items: center; gap: 5px; }
.hints.gone { opacity: 0; }
@media (max-width: 760px) { .hints { display: none; } }

/* Esc menu (shared with the weapon picker) */
.modal { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(6,7,10,.5); pointer-events: auto;
  animation: fade .12s ease-out; }
@keyframes fade { from { opacity: 0; } }
.sheet { width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 18px; border-radius: 16px;
  background: rgba(16,18,24,.96); }
.sheet h2 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 10px; }
.sheet h2 .brand { padding: 0; }
.sheet .sub { color: #8a93a3; font-size: 12px; margin: 2px 0 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { margin-left: auto; padding: 4px 9px; background: transparent; color: #8a93a3; }
.field { margin-bottom: 14px; }
.field label { display: block; color: #8a93a3; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 6px; }
.field .hint { color: #8a93a3; font-size: 12px; margin-top: 6px; }
.inrow { display: flex; gap: 6px; }
input { flex: 1; min-width: 0; font: inherit; color: #e9ecf2; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  border-radius: 8px; padding: 7px 10px; outline: none; }
input:focus { border-color: rgba(255,210,63,.7); }
.btns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 14px; }
.btns button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 6px; }
.btns button small { color: #8a93a3; font-weight: 500; font-size: 11px; }
.keys { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 0 0 16px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,.04); }
.keys div { display: flex; align-items: center; gap: 10px; color: #c5ccd8; font-size: 12px; }
.keys .ks { display: flex; gap: 3px; width: 92px; flex: none; }
.foot { display: flex; gap: 8px; align-items: center; }
.foot .primary { flex: 1; padding: 10px; }
.getext { display: block; margin-top: 12px; color: #ffd23f; font-size: 12px; text-decoration: none; }
.note2 { color: #8a93a3; font-size: 11px; text-align: center; margin-top: 10px; }
`;

export interface ScoreRow { idx: number; name: string; color: string; kills: number; deaths: number; me: boolean }

export interface HudState {
  me: LWorm | null;
  /** Worms on screen (CSS px): HUD parts covering one fade out of the way. */
  worms: { x: number; y: number }[];
  scores: ScoreRow[];
  ping: number;
  status: string;
}

export interface HudOpts {
  link: string;
  name: string;
  soundOn: boolean;
  /** Guest web page: where to get the extension. */
  hostUrl: string | null;
  onExit: () => void;
  onSound: () => void;
  onZoom: () => void;
  onLoadout: () => void;
  onName: (name: string) => void;
  /** Menu opened or closed (pause input while it's open). */
  onMenu: (open: boolean) => void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const hpColor = (hp: number) => (hp > 50 ? '#7cff6b' : hp > 25 ? '#ffd23f' : '#ff5a5f');

export class Hud {
  readonly el: HTMLDivElement;
  private status: HTMLDivElement;
  private dots: HTMLSpanElement;
  private count: HTMLSpanElement;
  private scores: HTMLDivElement;
  private scoreKey = '';
  private ping: HTMLSpanElement;
  private feed: HTMLDivElement;
  private bottom: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpVal: HTMLSpanElement;
  private slots: HTMLDivElement;
  private slotEls: { root: HTMLDivElement; nm: HTMLSpanElement; bar: HTMLElement; type: number; cls: string; w: string }[] = [];
  private respawn: HTMLDivElement;
  private respawnBig: HTMLDivElement;
  private respawnBy: HTMLDivElement;
  private hints: HTMLDivElement;
  private menu: HTMLDivElement;
  private menuTitle: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private soundBtns: HTMLElement[] = [];
  private last = new Map<object, Record<string, string>>();
  private killedBy = '';
  private hintsDone = false;
  private fadeable: HTMLElement[] = [];

  constructor(root: ShadowRoot, private o: HudOpts) {
    const ui = (this.el = h('div', 'ui'));

    // Top bar
    const top = h('div', 'top glass');
    top.append(h('span', 'brand', 'LIERO.PAGE'));
    const players = h('span', 'players');
    this.dots = h('span', 'dots');
    this.count = h('span', 'num', '');
    players.append(this.dots, this.count);
    const invite = h('button', 'primary', 'Invite friends');
    invite.title = 'Copy the invite link';
    invite.addEventListener('click', () => this.copy(invite));
    const menuBtn = h('button', 'menu-btn');
    menuBtn.append('Menu ', h('kbd', '', 'Esc'));
    menuBtn.addEventListener('click', () => this.toggleMenu());
    top.append(players, invite, menuBtn);

    this.status = h('div', 'status glass');
    this.status.hidden = true;

    // Scoreboard + feed
    const side = h('div', 'side');
    const sc = h('div', 'scores glass');
    const head = h('div', 'head');
    this.ping = h('span', 'num');
    head.append(h('span', '', 'Score'), this.ping);
    this.scores = h('div');
    sc.append(head, this.scores);
    this.feed = h('div', 'feed');
    side.append(sc, this.feed);

    // Bottom: health + weapons
    this.bottom = h('div', 'bottom');
    const hp = h('div', 'hp glass');
    const bar = h('div', 'bar');
    this.hpFill = h('div', 'fill');
    bar.append(this.hpFill);
    this.hpVal = h('span', 'val num', '100');
    const heart = h('span', '', '♥');
    heart.style.color = '#ff5a5f';
    hp.append(heart, this.hpVal, bar);
    this.slots = h('div', 'slots');
    this.bottom.append(hp, this.slots);
    this.bottom.hidden = true;

    // Respawn banner
    this.respawn = h('div', 'respawn glass');
    this.respawnBig = h('div', 'big num');
    this.respawnBy = h('div', 'by');
    this.respawn.append(this.respawnBig, this.respawnBy);
    this.respawn.hidden = true;

    // First-play hints
    this.hints = h('div', 'hints glass');
    const hint = (keys: string[], what: string) => {
      const s = h('span');
      keys.forEach((k) => s.append(h('kbd', '', k)));
      s.append(' ' + what);
      this.hints.append(s);
    };
    hint(['A', 'D'], 'move');
    hint(['W'], 'jump');
    hint(['Click'], 'fire');
    hint(['Right-click'], 'rope');
    hint(['1-5'], 'weapons');
    hint(['Esc'], 'menu');
    this.hints.hidden = true;

    // Esc menu
    this.menu = h('div', 'modal');
    this.menu.hidden = true;
    const sheet = h('div', 'sheet glass');
    const title = h('h2');
    const x = h('button', 'x', '✕');
    x.title = 'Close (Esc)';
    x.addEventListener('click', () => this.toggleMenu(false));
    title.append(h('span', 'brand', 'LIERO.PAGE'), 'Menu', x);
    this.menuTitle = h('div', 'sub');

    const inv = h('div', 'field');
    const invRow = h('div', 'inrow');
    const link = h('input');
    link.readOnly = true;
    link.value = o.link;
    link.addEventListener('focus', () => link.select());
    const copy = h('button', 'primary', 'Copy');
    copy.addEventListener('click', () => this.copy(copy));
    invRow.append(link, copy);
    inv.append(h('label', '', 'Invite friends'), invRow, h('div', 'hint', 'They join in their browser. No install needed.'));

    const nf = h('div', 'field');
    this.nameInput = h('input');
    this.nameInput.maxLength = 16;
    this.nameInput.value = o.name;
    this.nameInput.spellcheck = false;
    const commit = () => {
      const v = this.nameInput.value.trim().slice(0, 16);
      if (v && v !== this.o.name) { this.o.name = v; this.o.onName(v); }
      this.nameInput.value = this.o.name;
    };
    this.nameInput.addEventListener('change', commit);
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.nameInput.blur(); });
    nf.append(h('label', '', 'Your name'), this.nameInput);

    const btns = h('div', 'btns');
    const big = (label: string, key: string, fn: () => void) => {
      const b = h('button');
      const t = h('span', '', label);
      b.append(t, h('small', '', key));
      b.addEventListener('click', fn);
      btns.append(b);
      return t;
    };
    big('Weapons', 'L', () => { this.toggleMenu(false); o.onLoadout(); });
    this.soundBtns.push(big('Sound on', 'M', () => o.onSound()));
    big('Zoom', 'Z', () => o.onZoom());

    const keys = h('div', 'keys');
    const k = (ks: string[], what: string) => {
      const d = h('div');
      const kk = h('span', 'ks');
      ks.forEach((x) => kk.append(h('kbd', '', x)));
      d.append(kk, what);
      keys.append(d);
    };
    k(['A', 'D'], 'Move');
    k(['W', 'Space'], 'Jump');
    k(['Click'], 'Fire');
    k(['Right-click'], 'Ninja rope');
    k(['W', 'S'], 'Climb rope');
    k(['A+D'], 'Dig');
    k(['1-5', 'Q'], 'Switch weapon');
    k(['Tab'], 'Show ground');

    const foot = h('div', 'foot');
    const resume = h('button', 'primary', 'Resume');
    resume.addEventListener('click', () => this.toggleMenu(false));
    const leave = h('button', 'danger', 'Leave game');
    leave.addEventListener('click', () => o.onExit());
    foot.append(resume, leave);
    sheet.append(title, this.menuTitle, inv, nf, btns, keys, foot);
    if (o.hostUrl) {
      const a = h('a', 'getext', 'Fight on your own pages: get Liero.page for Chrome →');
      a.href = o.hostUrl; a.target = '_blank'; a.rel = 'noopener';
      sheet.append(a);
    }
    sheet.append(h('div', 'note2', 'The match keeps going while this menu is open.'));
    this.menu.append(sheet);
    this.menu.addEventListener('pointerdown', (e) => { if (e.target === this.menu) this.toggleMenu(false); });

    ui.append(this.bottom, this.hints, this.respawn, side, top, this.status, this.menu);
    this.fadeable = [this.bottom, top, side];
    root.append(ui);
    this.setSound(o.soundOn);
  }

  get menuOpen() { return !this.menu.hidden; }

  toggleMenu(open = this.menu.hidden) {
    if (open === !this.menu.hidden) return;
    this.menu.hidden = !open;
    if (!open && this.nameInput.matches(':focus')) this.nameInput.blur();
    this.o.onMenu(open);
  }

  setTitle(t: string) { this.menuTitle.textContent = t; }

  setSound(on: boolean) {
    for (const b of this.soundBtns) b.textContent = on ? 'Sound on' : 'Sound off';
  }

  /** Show the controls strip until the player has had a go. */
  showHints() {
    if (this.hintsDone) return;
    this.hints.hidden = false;
  }

  hideHints() {
    if (this.hintsDone) return;
    this.hintsDone = true;
    this.hints.classList.add('gone');
    setTimeout(() => { this.hints.hidden = true; }, 700);
  }

  kill(killer: { name: string; color: string }, victim: { name: string; color: string }, weapon: number, mine: boolean, iDied: boolean, self: boolean) {
    const fi = h('div', 'fi' + (mine ? ' mine' : ''));
    const nm = (p: { name: string; color: string }) => { const s = h('span', '', p.name); s.style.color = p.color; return s; };
    if (self) {
      fi.append(nm(victim), h('span', '', 'blew themselves up'));
    } else {
      fi.append(nm(killer));
      if (weapon >= 0 && WEAPONS[weapon]) { const ic = weaponIcon(weapon, 2); ic.title = niceName(WEAPONS[weapon]); fi.append(ic); } else fi.append('✕');
      fi.append(nm(victim));
    }
    this.pushFeed(fi);
    if (iDied) this.killedBy = self ? 'Oops, that was your own shot.' : `Fragged by ${killer.name}${weapon >= 0 && WEAPONS[weapon] ? ` with ${niceName(WEAPONS[weapon])}` : ''}`;
  }

  note(text: string, color = '') {
    const fi = h('div', 'fi note', text);
    if (color) fi.style.color = color;
    this.pushFeed(fi);
  }

  private pushFeed(fi: HTMLElement) {
    this.feed.append(fi);
    while (this.feed.children.length > 6) this.feed.firstElementChild!.remove();
    setTimeout(() => fi.classList.add('out'), 6000);
    setTimeout(() => fi.remove(), 6500);
  }

  private async copy(btn: HTMLButtonElement) {
    try { await navigator.clipboard.writeText(this.o.link); }
    catch {
      const t = document.createElement('textarea');
      t.value = this.o.link; this.el.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Link copied!';
    setTimeout(() => { btn.textContent = old; }, 1600);
  }

  /** Run `apply` only when the value shown changed (DOM writes are the expensive part). */
  private put(el: object, key: string, value: string, apply: () => void) {
    let rec = this.last.get(el);
    if (!rec) { rec = {}; this.last.set(el, rec); }
    if (rec[key] === value) return;
    rec[key] = value;
    apply();
  }

  update(s: HudState) {
    // Read layout first, then write, so the browser lays out once per frame.
    for (const el of this.fadeable) {
      const r = el.getBoundingClientRect();
      const hit = s.worms.some((p) => p.x > r.left - 24 && p.x < r.right + 24 && p.y > r.top - 30 && p.y < r.bottom + 16);
      this.put(el, 'dim', hit ? '1' : '0', () => el.classList.toggle('dim', hit));
    }

    // Status toast
    this.put(this.status, 'text', s.status, () => { this.status.textContent = s.status; this.status.hidden = !s.status; });

    // Players in the top bar
    const pkey = s.scores.map((r) => r.color).join();
    this.put(this.dots, 'k', pkey, () => {
      this.dots.replaceChildren(...s.scores.map((r) => { const i = h('i'); i.style.background = r.color; return i; }));
      this.count.textContent = s.scores.length === 1 ? 'just you' : `${s.scores.length} players`;
    });

    // Scoreboard
    const key = s.scores.map((r) => `${r.idx}:${r.name}:${r.kills}:${r.deaths}:${r.me}`).join('|');
    if (key !== this.scoreKey) {
      this.scoreKey = key;
      this.scores.replaceChildren(...s.scores.map((r) => {
        const row = h('div', 'row' + (r.me ? ' me' : ''));
        const dot = h('span', 'dot'); dot.style.background = r.color;
        row.append(dot, h('span', 'name', r.me ? `${r.name} (you)` : r.name), h('span', 'k num', String(r.kills)), h('span', 'd num', String(r.deaths)));
        row.title = `${r.kills} kills, ${r.deaths} deaths`;
        return row;
      }));
    }
    this.put(this.ping, 't', String(s.ping), () => { this.ping.textContent = s.ping >= 0 ? `${s.ping} ms` : ''; });

    // Health + weapons
    const me = s.me;
    this.put(this.bottom, 'h', me ? '1' : '0', () => { this.bottom.hidden = !me; });
    if (!me) return;
    const hp = Math.max(0, Math.min(MAX_HEALTH, me.visible ? me.health : 0));
    this.put(this.hpFill, 'w', String(Math.round(hp)), () => {
      this.hpFill.style.width = `${(hp / MAX_HEALTH) * 100}%`;
      this.hpFill.style.background = hpColor(hp);
      this.hpVal.textContent = String(Math.round(hp));
    });
    if (this.slotEls.length !== me.weapons.length) {
      this.slots.replaceChildren();
      this.slotEls = me.weapons.map((_, i) => {
        const root = h('div', 'slot glass');
        const nm = h('span', 'nm');
        const ammo = h('div', 'ammo');
        const bar = h('i');
        ammo.append(bar);
        root.append(h('span', 'key', String(i + 1)), nm, ammo);
        this.slots.append(root);
        return { root, nm, bar, type: -1, cls: '', w: '' };
      });
    }
    me.weapons.forEach((ww, i) => {
      const sl = this.slotEls[i];
      const def = WEAPONS[ww.type];
      if (!def) return;
      if (sl.type !== ww.type) {
        sl.type = ww.type;
        sl.root.querySelector('.wicon')?.remove();
        sl.root.insertBefore(weaponIcon(ww.type, 3), sl.nm);
        sl.nm.textContent = niceName(def);
        sl.root.title = niceName(def);
      }
      const reloading = ww.loadingLeft > 0;
      const frac = reloading ? 1 - ww.loadingLeft / Math.max(1, def.loadingTime) : ww.ammo / Math.max(1, def.ammo);
      const cls = `slot glass${i === me.cur ? ' sel' : ''}${reloading || !weaponAvailable(ww) ? ' reload' : ''}`;
      if (cls !== sl.cls) { sl.cls = cls; sl.root.className = cls; }
      const w = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
      if (w !== sl.w) { sl.w = w; sl.bar.style.width = w; }
    });

    // Respawn banner
    const dead = !me.visible;
    const secs = dead ? Math.max(0, Math.ceil(me.killedTimer / TICK_RATE)) : 0;
    this.put(this.respawn, 'r', dead ? `${secs}` : '', () => {
      this.respawn.hidden = !dead;
      this.respawnBig.textContent = secs > 0 ? `Respawning in ${secs}…` : 'Respawning…';
      this.respawnBy.textContent = this.killedBy;
      this.respawnBy.hidden = !this.killedBy;
    });
    if (!dead) this.killedBy = '';
  }
}
