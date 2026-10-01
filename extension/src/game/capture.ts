// Turns the live page into a terrain bitmap.
// Everything visible becomes solid: text lines (with real glyphs drawn on them),
// images, form controls, coloured boxes and borders. Page background becomes air.

import { MAX_WORLD_H, MAX_WORLD_W, PAGE_PX } from '../../../shared/constants.ts';
import type { MapHeader } from '../../../shared/protocol.ts';

export interface Capture {
  header: MapHeader;
  mask: Uint8Array; // 1 px per world px (PAGE_PX CSS px), 0 = air, 1 = solid
  fg: Uint8Array; // WebP, solid layer at header.scale
  bg: Uint8Array; // WebP, background layer at 1x
  /** Where the world sits in document coordinates, CSS px (for the intro transition). */
  originX: number;
  originY: number;
}

type RGBA = [number, number, number, number];

interface Box { x: number; y: number; w: number; h: number }
type Prim =
  | ({ k: 'fill'; color: string } & Box)
  | ({ k: 'img'; el: HTMLImageElement | null; url: string; fit: string; pos: string; fallback: string } & Box)
  | ({ k: 'text'; paper: string; color: string; font: string; words: { s: string; r: DOMRect }[]; lines: DOMRect[] } & Box);

const MAX_ELEMENTS = 20000;
const MAX_WORDS = 30000;

function parseColor(s: string): RGBA {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 0];
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
}
const cssOf = (c: RGBA) => `rgb(${c[0]},${c[1]},${c[2]})`;
const dist = (a: RGBA, b: RGBA) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/**
 * Build a map from the live page.
 * With `shot` (a screenshot of the visible tab), the map is exactly what's on screen: the screenshot
 * is the picture and the DOM only decides what's solid. Without it, the page is re-drawn from the DOM
 * (fallback, and it can cover more than one screen).
 */
export async function capturePage(ignore: Element | null, scale: number, shot: HTMLImageElement | null = null): Promise<Capture> {
  const sx = window.scrollX, sy = window.scrollY;
  const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, window.innerHeight);

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let s = styleCache.get(el);
    if (!s) { s = getComputedStyle(el); styleCache.set(el, s); }
    return s;
  };

  let pageBg = parseColor(style(document.body ?? document.documentElement).backgroundColor);
  if (pageBg[3] < 0.5) pageBg = parseColor(style(document.documentElement).backgroundColor);
  if (pageBg[3] < 0.5) pageBg = [255, 255, 255, 1];

  // Effective background behind an element (first opaque ancestor background).
  const bgCache = new Map<Element, RGBA>();
  const effectiveBg = (el: Element | null): RGBA => {
    const chain: Element[] = [];
    let found: RGBA = pageBg;
    for (let e = el; e; e = e.parentElement) {
      const cached = bgCache.get(e);
      if (cached) { found = cached; break; }
      chain.push(e);
      const c = parseColor(style(e).backgroundColor);
      if (c[3] >= 0.5) { found = c; break; }
    }
    for (const e of chain) bgCache.set(e, found);
    return found;
  };

  const visible = (el: Element) => {
    const s = style(el);
    return s.visibility === 'visible' && Number(s.opacity) > 0.1 && s.display !== 'none';
  };

  const prims: Prim[] = [];
  const backs: Prim[] = []; // non-solid backgrounds (visual only)
  const toDoc = (r: DOMRect): Box => ({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
  let fixedRoots: Element[] = [];

  // --- Elements -------------------------------------------------------------
  const all = document.body ? document.body.getElementsByTagName('*') : ([] as unknown as HTMLCollectionOf<Element>);
  const n = Math.min(all.length, MAX_ELEMENTS);
  for (let i = 0; i < n; i++) {
    const el = all[i];
    if (ignore && (el === ignore || ignore.contains(el))) continue;
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue; // svg internals
    if (fixedRoots.some((f) => f.contains(el))) continue;
    const s = style(el);
    if (s.display === 'none') continue;
    // Fixed elements (cookie banners, sticky navs) only exist in the screenshot's viewport.
    if (s.position === 'fixed' && !shot) { fixedRoots.push(el); continue; }
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const b = toDoc(rect);
    const tag = el.tagName;

    if (tag === 'IMG') {
      const img = el as HTMLImageElement;
      prims.push({ k: 'img', el: img, url: img.currentSrc || img.src, fit: s.objectFit, pos: s.objectPosition, fallback: '#8a8f98', ...b });
      continue;
    }
    if (el instanceof SVGSVGElement) {
      const fill = parseColor(s.fill);
      prims.push({ k: 'fill', color: fill[3] > 0.3 ? cssOf(fill) : s.color, ...b });
      continue;
    }
    if (tag === 'VIDEO' || tag === 'CANVAS' || tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
      prims.push({ k: 'fill', color: '#2b2f36', ...b });
      continue;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'PROGRESS' || tag === 'METER') {
      const bg = parseColor(s.backgroundColor);
      const border = parseColor(s.borderTopColor);
      const c = bg[3] > 0.3 ? bg : border[3] > 0.3 ? border : ([150, 150, 150, 1] as RGBA);
      prims.push({ k: 'fill', color: cssOf(c), ...b });
      if (tag !== 'BUTTON') continue; // buttons have text children too
    }
    if (tag === 'HR') {
      prims.push({ k: 'fill', color: cssOf(parseColor(s.borderTopColor)), ...b, h: Math.max(2, b.h) });
      continue;
    }

    // Backgrounds: everything goes on the visual backdrop; small distinct boxes are also solid.
    const bg = parseColor(s.backgroundColor);
    const big = b.w * b.h > 0.3 * MAX_WORLD_W * MAX_WORLD_H * PAGE_PX * PAGE_PX || (b.w > docW * 0.9 && b.h > 900);
    if (bg[3] >= 0.1) backs.push({ k: 'fill', color: s.backgroundColor, ...b });
    const bgUrl = s.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
    if (bgUrl && b.w > 4 && b.h > 4 && !/^data:image\/svg/.test(bgUrl)) {
      const fit = s.backgroundSize === 'cover' || s.backgroundSize === 'contain' ? s.backgroundSize : 'cover';
      const prim: Prim = { k: 'img', el: null, url: new URL(bgUrl, location.href).href, fit, pos: s.backgroundPosition, fallback: '#6b7280', ...b };
      (!big && b.w * b.h < 400 * 400 ? prims : backs).push(prim);
    } else if (bg[3] >= 0.5 && !big && dist(bg, effectiveBg(el.parentElement)) > 24) {
      prims.push({ k: 'fill', color: cssOf(bg), ...b });
    }

    // Borders become thin platforms.
    const sides: [string, string, Box][] = [
      [s.borderTopWidth, s.borderTopColor, { x: b.x, y: b.y, w: b.w, h: parseFloat(s.borderTopWidth) }],
      [s.borderBottomWidth, s.borderBottomColor, { x: b.x, y: b.y + b.h - parseFloat(s.borderBottomWidth), w: b.w, h: parseFloat(s.borderBottomWidth) }],
      [s.borderLeftWidth, s.borderLeftColor, { x: b.x, y: b.y, w: parseFloat(s.borderLeftWidth), h: b.h }],
      [s.borderRightWidth, s.borderRightColor, { x: b.x + b.w - parseFloat(s.borderRightWidth), y: b.y, w: parseFloat(s.borderRightWidth), h: b.h }],
    ];
    for (const [w, col, box] of sides) {
      const c = parseColor(col);
      if (parseFloat(w) >= 1 && c[3] >= 0.5 && box.w > 0 && box.h > 0) prims.push({ k: 'fill', color: cssOf(c), ...box, w: Math.max(box.w, 2), h: Math.max(box.h, 2) });
    }
  }

  // --- Text -----------------------------------------------------------------
  let wordBudget = MAX_WORDS;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const text = node.data;
      if (!text.trim()) continue;
      const parent = node.parentElement;
      if (!parent || (ignore && ignore.contains(parent))) continue;
      if (fixedRoots.some((f) => f.contains(parent))) continue;
      if (!visible(parent)) continue;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'OPTION') continue;
      const s = style(parent);
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!lines.length) continue;
      const words: { s: string; r: DOMRect }[] = [];
      if (wordBudget > 0) {
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) && wordBudget-- > 0) {
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const r = range.getClientRects()[0];
          if (r && r.width > 0) words.push({ s: m[0], r });
        }
      }
      const u = lines.reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
      prims.push({
        k: 'text',
        paper: cssOf(effectiveBg(parent)),
        color: s.color,
        font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`,
        words, lines,
        x: u.l + sx, y: u.t + sy, w: u.r - u.l, h: u.b - u.t,
      });
    }
  }

  if (shot) return fromScreenshot(shot, prims, sx, sy);

  // --- World bounds -----------------------------------------------------------
  // Layout below is in CSS px (Wc x Hc); the world is PAGE_PX times smaller (W x H).
  const P = PAGE_PX, maxW = MAX_WORLD_W * P, maxH = MAX_WORLD_H * P;
  let minX = Infinity, maxX = -Infinity;
  for (const p of prims) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w); }
  if (!isFinite(minX)) { minX = 0; maxX = window.innerWidth; }
  minX = Math.max(0, minX - 24);
  maxX = Math.min(docW, maxX + 24);
  const Wc = Math.ceil(Math.min(maxW, Math.max(800, maxX - minX)));
  let ox = Math.floor(minX);
  if (maxX - minX > maxW) ox = Math.floor(Math.max(0, Math.min(docW - Wc, sx + window.innerWidth / 2 - Wc / 2)));
  const oy = Math.floor(Math.max(0, sy - 300));
  const Hc = Math.ceil(Math.min(maxH, Math.max(800, docH - oy)));
  const W = Math.ceil(Wc / P), H = Math.ceil(Hc / P);

  // --- Rasterise ---------------------------------------------------------------
  const S = scale * P; // picture px per world px
  const fgCanvas = document.createElement('canvas');
  fgCanvas.width = W * S; fgCanvas.height = H * S;
  const ctx = fgCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(scale, scale);
  ctx.imageSmoothingQuality = 'high';
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = W; bgCanvas.height = H;
  const bctx = bgCanvas.getContext('2d')!;
  bctx.scale(1 / P, 1 / P);
  bctx.fillStyle = cssOf(pageBg);
  bctx.fillRect(0, 0, Wc, Hc);

  const inWorld = (p: Box) => !(p.x - ox + p.w < 0 || p.y - oy + p.h < 0 || p.x - ox > Wc || p.y - oy > Hc);
  const images = await loadImages([...prims, ...backs].filter((p): p is Extract<Prim, { k: 'img' }> => p.k === 'img' && inWorld(p)), scale);
  const fontCache = new Map<string, { asc: number; desc: number }>();

  const draw = (c: CanvasRenderingContext2D, p: Prim) => {
    const x = p.x - ox, y = p.y - oy;
    if (!inWorld(p)) return;
    if (p.k === 'fill') {
      c.fillStyle = p.color;
      c.fillRect(x, y, p.w, p.h);
    } else if (p.k === 'img') {
      const src = images.get(p);
      if (src) c.drawImage(src, x, y, p.w, p.h);
      else { c.fillStyle = p.fallback; c.fillRect(x, y, p.w, p.h); }
    } else {
      c.fillStyle = p.paper;
      for (const r of p.lines) c.fillRect(r.left + sx - ox, r.top + sy - oy, r.width, r.height);
      c.fillStyle = p.color;
      c.font = p.font;
      let m = fontCache.get(p.font);
      if (!m) {
        const tm = c.measureText('Hg');
        m = { asc: tm.fontBoundingBoxAscent ?? tm.actualBoundingBoxAscent, desc: tm.fontBoundingBoxDescent ?? tm.actualBoundingBoxDescent };
        fontCache.set(p.font, m);
      }
      c.textBaseline = 'alphabetic';
      for (const w of p.words) {
        const wx = w.r.left + sx - ox, wy = w.r.top + sy - oy;
        c.fillText(w.s, wx, wy + (w.r.height + m.asc - m.desc) / 2, w.r.width * 1.15 + 2);
      }
    }
  };
  for (const p of backs) draw(bctx, p);
  for (const p of prims) draw(ctx, p);

  // --- Collision mask (sample the solid layer at the centre of each world pixel) ---
  const px = ctx.getImageData(0, 0, W * S, H * S).data;
  const mask = new Uint8Array(W * H);
  const half = Math.floor(S / 2), rowStride = W * S * 4;
  for (let y = 0; y < H; y++) {
    const row = (y * S + half) * rowStride;
    for (let x = 0; x < W; x++) {
      if (px[row + (x * S + half) * 4 + 3] >= 128) mask[y * W + x] = 1;
    }
  }

  // --- Encode the visuals ----------------------------------------------------------
  let fg: Uint8Array = new Uint8Array(0), bgBytes: Uint8Array = new Uint8Array(0);
  for (const q of [0.92, 0.8, 0.65, 0.5]) {
    fg = await canvasBytes(fgCanvas, q);
    bgBytes = await canvasBytes(bgCanvas, Math.min(0.85, q));
    if (fg.length + bgBytes.length < 9 * 1024 * 1024) break;
  }

  return {
    header: { w: W, h: H, scale: S, fgLen: fg.length, bgLen: bgBytes.length, title: document.title.slice(0, 200), url: location.href.split('#')[0].slice(0, 2000) },
    mask, fg, bg: bgBytes,
    originX: ox,
    originY: oy,
  };
}

function canvasBytes(c: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob(async (b) => {
      if (!b) return reject(new Error('could not encode map image'));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, 'image/webp', quality);
  });
}

/**
 * Get a drawable for every image. Same-origin images are used directly; everything else is
 * fetched and pre-rendered by the background worker (object-fit aware) so the canvas stays readable.
 */
async function loadImages(list: Extract<Prim, { k: 'img' }>[], S: number): Promise<Map<Prim, CanvasImageSource>> {
  const out = new Map<Prim, CanvasImageSource>();
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const readable = (img: HTMLImageElement) => {
    if (!img.complete || !img.naturalWidth) return false;
    try { probe.clearRect(0, 0, 1, 1); probe.drawImage(img, 0, 0, 1, 1); probe.getImageData(0, 0, 1, 1); return true; } catch { return false; }
  };
  const todo = list.filter((p) => p.url && !p.url.startsWith('blob:')).slice(0, 120);
  const deadline = Date.now() + 5000;
  let next = 0;
  const worker = async () => {
    while (next < todo.length && Date.now() < deadline) {
      const p = todo[next++];
      const simple = p.el && (p.fit === 'fill' || !p.fit) && readable(p.el);
      if (simple) { out.set(p, p.el!); continue; }
      try {
        const url: string | null = await chrome.runtime.sendMessage({
          type: 'liero:img', url: p.url, w: p.w * S, h: p.h * S, fit: p.fit, pos: p.pos,
        });
        if (!url) continue;
        const img = new Image();
        img.src = url;
        await img.decode();
        out.set(p, img);
      } catch { /* fallback colour */ }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

/** Map = the visible viewport. Picture from the screenshot, collision from the DOM. */
async function fromScreenshot(shot: HTMLImageElement, prims: Prim[], sx: number, sy: number): Promise<Capture> {
  const P = PAGE_PX;
  const W = Math.min(MAX_WORLD_W, Math.floor(window.innerWidth / P)), H = Math.min(MAX_WORLD_H, Math.floor(window.innerHeight / P));
  const k = shot.naturalWidth / window.innerWidth; // screenshot px per CSS px
  const S = Math.max(1, Math.min(2, k)) * P; // picture px per world px

  // Collision mask: solid prims as plain boxes, rounded outwards to whole world pixels so thin lines survive.
  const mc = document.createElement('canvas');
  mc.width = W; mc.height = H;
  const m = mc.getContext('2d', { willReadFrequently: true })!;
  m.fillStyle = '#000';
  const box = (x: number, y: number, w: number, h: number) => {
    const x0 = Math.floor(x / P), y0 = Math.floor(y / P), x1 = Math.ceil((x + w) / P), y1 = Math.ceil((y + h) / P);
    m.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  for (const p of prims) {
    if (p.k === 'text') {
      for (const r of p.lines) box(r.left, r.top, r.width, r.height);
    } else {
      box(p.x - sx, p.y - sy, p.w, p.h);
    }
  }
  const a = m.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) if (a[i * 4 + 3] >= 128) mask[i] = 1;

  // Picture: the screenshot, cropped to the world and capped at 2x.
  const c = document.createElement('canvas');
  c.width = Math.round(W * S); c.height = Math.round(H * S);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shot, 0, 0, W * P * k, H * P * k, 0, 0, c.width, c.height);
  let fg: Uint8Array = new Uint8Array(0);
  for (const q of [0.92, 0.82, 0.7]) {
    fg = await canvasBytes(c, q);
    if (fg.length < 6 * 1024 * 1024) break;
  }
  return {
    header: { w: W, h: H, scale: S, fgLen: fg.length, bgLen: 0, title: document.title.slice(0, 200), url: location.href.split('#')[0].slice(0, 2000) },
    mask, fg, bg: new Uint8Array(0),
    originX: sx, originY: sy,
  };
}
