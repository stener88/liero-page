import { LOADOUT_SIZE } from '../../../shared/liero/data.ts';
import { K_DOWN, K_FIRE, K_JUMP, K_LEFT, K_RIGHT, K_ROPE, K_UP } from '../../../shared/liero/game.ts';

const GAME_KEYS = new Set([
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyE', 'KeyQ', 'KeyZ', 'KeyF', 'KeyM', 'KeyL',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'ShiftRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Escape', 'Tab',
]);

export class Input {
  private down = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  ropeDown = false;
  weapon = 0;
  /** While true (e.g. a menu is open) game keys are ignored. */
  paused = false;
  onEscape: () => void = () => {};
  onZoom: () => void = () => {};
  onMute: () => void = () => {};
  onLoadout: () => void = () => {};
  onActivity: () => void = () => {};
  private cleanup: (() => void)[] = [];

  constructor(private surface: HTMLElement) {
    const opts = { capture: true };
    const host = (surface.getRootNode() as ShadowRoot).host ?? null;
    // Typing into the page (Google's search box has focus when the page loads, for example) would
    // insert letters, and on macOS holding a key opens the accent picker. Keep focus off the page.
    const blurPage = () => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== host && a !== document.body && typeof a.blur === 'function') a.blur();
    };
    blurPage();
    const onFocusIn = (e: FocusEvent) => { if (e.target !== host) blurPage(); };
    const onKey = (e: KeyboardEvent) => {
      if (!GAME_KEYS.has(e.code)) return;
      // Let people type in our own text fields (the name box in the menu), except Esc which closes it.
      const path = e.composedPath();
      const inOurField = !!host && path.includes(host) && path.some((n) => n instanceof HTMLInputElement && !n.readOnly);
      if (inOurField && e.code !== 'Escape') return;
      if (!inOurField) blurPage();
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'keydown') {
        if (e.repeat) return;
        this.onActivity();
        if (e.code === 'Escape') { this.onEscape(); return; }
        if (e.code === 'KeyL') { this.onLoadout(); return; }
        if (this.paused) return;
        this.down.add(e.code);
        if (e.code === 'KeyM') this.onMute();
        if (e.code === 'KeyZ') this.onZoom();
        const digit = /^Digit([1-5])$/.exec(e.code);
        if (digit) this.weapon = Math.min(LOADOUT_SIZE - 1, Number(digit[1]) - 1);
        if (e.code === 'KeyQ') this.weapon = (this.weapon + 1) % LOADOUT_SIZE;
      } else {
        this.down.delete(e.code);
      }
    };
    const onBlur = () => { this.down.clear(); this.mouseDown = false; this.ropeDown = false; };
    const onMove = (e: PointerEvent) => { this.mouseX = e.clientX; this.mouseY = e.clientY; };
    const onPDown = (e: PointerEvent) => {
      e.preventDefault();
      blurPage();
      this.onActivity();
      if (this.paused) return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.ropeDown = true;
      this.mouseX = e.clientX; this.mouseY = e.clientY;
    };
    const onPUp = (e: PointerEvent) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.ropeDown = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.paused) return;
      this.weapon = (this.weapon + (e.deltaY > 0 ? 1 : LOADOUT_SIZE - 1)) % LOADOUT_SIZE;
    };
    const onCtx = (e: Event) => e.preventDefault();

    window.addEventListener('focusin', onFocusIn, opts);
    window.addEventListener('keydown', onKey, opts);
    window.addEventListener('keyup', onKey, opts);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointermove', onMove, opts);
    surface.addEventListener('pointerdown', onPDown);
    window.addEventListener('pointerup', onPUp, opts);
    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('contextmenu', onCtx);
    this.cleanup.push(
      () => window.removeEventListener('focusin', onFocusIn, opts),
      () => window.removeEventListener('keydown', onKey, opts),
      () => window.removeEventListener('keyup', onKey, opts),
      () => window.removeEventListener('blur', onBlur),
      () => window.removeEventListener('pointermove', onMove, opts),
      () => surface.removeEventListener('pointerdown', onPDown),
      () => window.removeEventListener('pointerup', onPUp, opts),
      () => surface.removeEventListener('wheel', onWheel),
      () => surface.removeEventListener('contextmenu', onCtx),
    );
  }

  has(code: string) { return this.down.has(code); }

  /** Keys bitmask. With the rope out, W/Up and S/Down reel it in and out instead of jumping. */
  keys(ropeOut: boolean): number {
    if (this.paused) return 0;
    const d = this.down;
    let k = 0;
    const left = d.has('KeyA') || d.has('ArrowLeft');
    const right = d.has('KeyD') || d.has('ArrowRight');
    if (left) k |= K_LEFT;
    if (right) k |= K_RIGHT;
    const up = d.has('KeyW') || d.has('ArrowUp');
    if (up) k |= ropeOut ? K_UP : K_JUMP;
    if (d.has('Space')) k |= K_JUMP;
    if (d.has('KeyS') || d.has('ArrowDown')) k |= K_DOWN;
    if (this.mouseDown || d.has('KeyF')) k |= K_FIRE;
    if (this.ropeDown || d.has('KeyE') || d.has('ShiftLeft') || d.has('ShiftRight')) k |= K_ROPE;
    return k;
  }

  destroy() { this.cleanup.forEach((f) => f()); this.down.clear(); }
}
