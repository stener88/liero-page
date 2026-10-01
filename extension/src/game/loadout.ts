// Weapon picker: choose 5 of Liero's 40 weapons. Changes apply on your next respawn.

import { DEFAULT_LOADOUT, LOADOUT_SIZE, WEAPONS, WEAPON_ORDER, type WeaponType } from '../../../shared/liero/data.ts';
import { CATEGORIES, blurbOf, categoryOf, niceName, reloadSeconds, statLine, weaponIcon } from './weapons-info.ts';

export const LOADOUT_CSS = `
.picker .sheet { width: min(860px, calc(100vw - 32px)); padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.pk-head { padding: 16px 18px 0; }
.pk-head .sub { margin-bottom: 12px; white-space: normal; }
.pk-slots { display: grid; grid-template-columns: repeat(${LOADOUT_SIZE}, 1fr); gap: 6px; padding: 0 18px 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
.pk-slot { position: relative; display: flex; align-items: center; gap: 7px; padding: 9px 8px; border-radius: 10px; min-width: 0;
  background: rgba(255,255,255,.05); border: 1.5px dashed rgba(255,255,255,.14); color: #8a93a3; cursor: pointer; font-weight: 600; font-size: 12px; }
.pk-slot.full { border-style: solid; border-color: rgba(255,255,255,.12); color: #e9ecf2; background: rgba(255,255,255,.07); }
.pk-slot.active { border-color: #ffd23f; box-shadow: 0 0 0 1px #ffd23f; }
.pk-slot .n { font: 700 10px/14px ui-monospace, Menlo, monospace; padding: 0 5px; border-radius: 5px; background: #2a2f3a; color: #aab2c0; flex: none; }
.pk-slot.active .n { background: #ffd23f; color: #12141a; }
.pk-slot .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-slot .rm { margin-left: auto; color: #8a93a3; padding: 0 2px; font-size: 13px; line-height: 1; }
.pk-slot .rm:hover { color: #ff8a8e; }
.pk-body { display: grid; grid-template-columns: 1fr 240px; min-height: 0; flex: 1; overflow: hidden; }
.pk-list { overflow: auto; padding: 12px 18px 16px; max-height: calc(100vh - 290px); }
.pk-cat { color: #8a93a3; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; margin: 10px 0 6px; }
.pk-cat:first-child { margin-top: 0; }
.pk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.pk-card { position: relative; display: flex; align-items: center; gap: 8px; text-align: left; padding: 8px 9px; border-radius: 9px;
  background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07); font-weight: 500; min-width: 0; }
.pk-card:hover { background: rgba(255,255,255,.09); }
.pk-card.on { background: rgba(255,210,63,.13); border-color: rgba(255,210,63,.75); }
.pk-card .tx { min-width: 0; flex: 1; }
.pk-card .nm { font-weight: 650; font-size: 12px; color: #e9ecf2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-card .st { font-size: 11px; color: #8a93a3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-card .badge { position: absolute; right: 6px; top: 6px; font: 700 10px/14px ui-monospace, Menlo, monospace; padding: 0 5px; border-radius: 5px;
  background: #ffd23f; color: #12141a; }
.pk-detail { border-left: 1px solid rgba(255,255,255,.08); padding: 18px; display: flex; flex-direction: column; gap: 10px; }
.pk-detail .wicon { width: 56px; height: 56px; padding: 8px; border-radius: 12px; background: rgba(255,255,255,.06); box-sizing: content-box; }
.pk-detail .dn { font-size: 16px; font-weight: 750; }
.pk-detail .dc { color: #ffd23f; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.pk-detail .db { color: #c5ccd8; }
.pk-detail dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 4px 0 0; font-size: 12px; }
.pk-detail dt { color: #8a93a3; }
.pk-detail dd { margin: 0; text-align: right; font-weight: 600; }
.pk-foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid rgba(255,255,255,.08); }
.pk-foot .count { margin-left: auto; color: #8a93a3; font-size: 12px; }
.pk-foot .primary[disabled] { opacity: .45; cursor: default; }
@media (max-width: 720px) {
  .pk-body { grid-template-columns: 1fr; }
  .pk-detail { display: none; }
  .pk-slots { grid-template-columns: repeat(${LOADOUT_SIZE}, minmax(0, 1fr)); }
  .pk-slot .t { display: none; }
}
`;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function fireRate(w: WeaponType): string {
  if (w.ammo <= 1) return 'Single shot';
  if (w.delay <= 3) return 'Very fast';
  if (w.delay <= 12) return 'Fast';
  if (w.delay <= 40) return 'Medium';
  return 'Slow';
}

export function buildLoadout(root: ShadowRoot, initial: number[], onSave: (lo: number[]) => void) {
  let saved = initial.slice(0, LOADOUT_SIZE);
  let picked: (number | null)[] = saved.slice();
  let active = 0;
  let focus = saved[0] ?? WEAPON_ORDER[0];

  const el = h('div', 'modal picker');
  el.hidden = true;
  const sheet = h('div', 'sheet glass');

  const head = h('div', 'pk-head');
  const title = h('h2', '', 'Choose your weapons');
  const x = h('button', 'x', '✕');
  x.title = 'Close (Esc)';
  title.append(x);
  head.append(title, h('div', 'sub', `Pick ${LOADOUT_SIZE}. Click a slot, then a weapon to put in it. Keys 1–${LOADOUT_SIZE} switch between them in the game. New picks apply when you respawn.`));

  const slots = h('div', 'pk-slots');
  const body = h('div', 'pk-body');
  const list = h('div', 'pk-list');
  const detail = h('div', 'pk-detail');
  body.append(list, detail);

  const cards = new Map<number, HTMLButtonElement>();
  for (const cat of CATEGORIES) {
    list.append(h('div', 'pk-cat', cat));
    const grid = h('div', 'pk-grid');
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      if (categoryOf(w) !== cat) continue;
      const b = h('button', 'pk-card');
      const tx = h('div', 'tx');
      tx.append(h('div', 'nm', niceName(w)), h('div', 'st', statLine(w)));
      b.append(weaponIcon(id, 3), tx);
      b.addEventListener('click', () => pick(id));
      b.addEventListener('pointerenter', () => { focus = id; renderDetail(); });
      cards.set(id, b);
      grid.append(b);
    }
    list.append(grid);
  }

  const foot = h('div', 'pk-foot');
  const rnd = h('button', '', 'Random');
  const def = h('button', '', 'Default');
  const count = h('span', 'count');
  const done = h('button', 'primary', 'Done');
  foot.append(rnd, def, count, done);
  sheet.append(head, slots, body, foot);
  el.append(sheet);

  const nextEmpty = () => picked.findIndex((p) => p === null);

  function pick(id: number) {
    focus = id;
    const at = picked.indexOf(id);
    if (at >= 0) { picked[at] = null; active = at; }
    else {
      picked[active] = id;
      const e = nextEmpty();
      if (e >= 0) active = e;
    }
    render();
  }

  function renderDetail() {
    const w = WEAPONS[focus];
    if (!w) return;
    const dl = h('dl');
    const row = (k: string, v: string) => dl.append(h('dt', '', k), h('dd', 'num', v));
    row('Magazine', `${w.ammo} ${w.ammo === 1 ? 'shot' : 'shots'}`);
    row('Reload', reloadSeconds(w));
    row('Fire rate', fireRate(w));
    if (w.parts > 1) row('Projectiles', `${w.parts} per shot`);
    if (w.laserSight) row('Laser sight', 'Yes');
    detail.replaceChildren(weaponIcon(focus, 8), h('div', 'dc', categoryOf(w)), h('div', 'dn', niceName(w)), h('div', 'db', blurbOf(w)), dl);
  }

  function render() {
    slots.replaceChildren(...picked.map((id, i) => {
      const s = h('div', `pk-slot${id !== null ? ' full' : ''}${i === active ? ' active' : ''}`);
      s.append(h('span', 'n', String(i + 1)));
      if (id !== null) {
        s.append(weaponIcon(id, 3), h('span', 't', niceName(WEAPONS[id])));
        const rm = h('span', 'rm', '✕');
        rm.title = 'Remove';
        rm.addEventListener('click', (e) => { e.stopPropagation(); picked[i] = null; active = i; render(); });
        s.append(rm);
      } else {
        s.append(h('span', 't', 'Empty'));
      }
      s.addEventListener('click', () => { active = i; if (id !== null) focus = id; render(); });
      return s;
    }));
    for (const [id, b] of cards) {
      const at = picked.indexOf(id);
      b.classList.toggle('on', at >= 0);
      b.querySelector('.badge')?.remove();
      if (at >= 0) b.append(h('span', 'badge', String(at + 1)));
    }
    const n = picked.filter((p) => p !== null).length;
    count.textContent = n < LOADOUT_SIZE ? `Pick ${LOADOUT_SIZE - n} more` : 'Ready';
    done.disabled = n < LOADOUT_SIZE;
    renderDetail();
  }

  rnd.addEventListener('click', () => {
    const pool = WEAPONS.map((w) => w.id);
    picked = [];
    while (picked.length < LOADOUT_SIZE) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    active = 0; render();
  });
  def.addEventListener('click', () => { picked = DEFAULT_LOADOUT.slice(0, LOADOUT_SIZE); active = 0; render(); });

  let onClose: (open: boolean) => void = () => {};
  const close = () => {
    if (el.hidden) return;
    if (picked.every((p) => p !== null)) {
      const lo = picked as number[];
      const changed = lo.join() !== saved.join();
      saved = lo.slice();
      if (changed) onSave(lo.slice());
    } else {
      picked = saved.slice(); // incomplete: keep what you had
    }
    el.hidden = true;
    onClose(false);
  };
  done.addEventListener('click', close);
  x.addEventListener('click', close);
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === el) close(); });
  el.addEventListener('wheel', (e) => e.stopPropagation());
  render();
  (root.querySelector('.ui') ?? root).append(el);

  return {
    get open() { return !el.hidden; },
    set onOpenChange(fn: (open: boolean) => void) { onClose = fn; },
    toggle() {
      if (el.hidden) {
        picked = saved.slice();
        active = Math.max(0, nextEmpty());
        el.hidden = false;
        render();
        onClose(true);
      } else close();
    },
    close,
  };
}
