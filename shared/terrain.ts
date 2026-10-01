// Pixel terrain. 0 = air, 1..255 = solid (value is a palette index used for rendering).
// Out of bounds: left/right/bottom are walls, the sky above y=0 is open air.

export class Terrain {
  constructor(public w: number, public h: number, public data: Uint8Array) {}

  isSolid(x: number, y: number): boolean {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || x >= this.w || y >= this.h) return true;
    if (y < 0) return false;
    return this.data[y * this.w + x] !== 0;
  }

  /** Does an axis-aligned box centred on (cx, cy) touch any solid pixel? */
  rectHits(cx: number, cy: number, hw: number, hh: number): boolean {
    const x0 = Math.floor(cx - hw), x1 = Math.floor(cx + hw);
    const y0 = Math.floor(cy - hh), y1 = Math.floor(cy + hh);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.isSolid(x, y)) return true;
      }
    }
    return false;
  }

  /**
   * Remove a disc of terrain. Deterministic so every client carves the same hole.
   * Returns the affected bounding box (clamped), or null if nothing was in range.
   */
  carve(
    cx: number, cy: number, r: number,
    onRemoved?: (x: number, y: number, v: number) => void,
  ): { x0: number; y0: number; x1: number; y1: number } | null {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return null;
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) {
          const i = y * this.w + x;
          const v = this.data[i];
          if (v !== 0) {
            this.data[i] = 0;
            onRemoved?.(x, y, v);
          }
        }
      }
    }
    return { x0, y0, x1, y1 };
  }
}
