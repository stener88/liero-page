// Original Liero sound effects (8-bit signed PCM, 22050 Hz) played through Web Audio.

import { SOUNDS } from './liero-sounds.gen.ts';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers: (AudioBuffer | null)[] = [];
  private recent: number[] = [];
  enabled = true;
  volume = 0.6;

  /** Must be called from a user gesture (key/pointer) the first time, or browsers keep audio muted. */
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.12;
      this.master.connect(comp).connect(this.ctx.destination);
      this.buffers = SOUNDS.map((s) => this.decode(s.data));
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private decode(b64: string): AudioBuffer | null {
    if (!this.ctx || !b64) return null;
    const bin = atob(b64);
    if (!bin.length) return null;
    const buf = this.ctx.createBuffer(1, bin.length, 22050);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bin.length; i++) {
      const v = bin.charCodeAt(i);
      ch[i] = (v > 127 ? v - 256 : v) / 128;
    }
    return buf;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.ensure();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.02);
  }

  destroy() { void this.ctx?.close(); this.ctx = null; }

  /** Play Liero sound `id` with a volume (0..1) and stereo position (-1..1). */
  play(id: number, vol = 1, pan = 0) {
    const c = this.ctx, buf = this.buffers[id];
    if (!c || !buf || !this.enabled || c.state !== 'running' || vol <= 0.01) return;
    const now = c.currentTime;
    this.recent = this.recent.filter((t) => now - t < 0.06);
    if (this.recent.length > 12) return; // don't let a minigun + 40 debris hits stack into noise
    this.recent.push(now);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    let node: AudioNode = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      node = p;
    }
    node.connect(this.master!);
    src.connect(g);
    src.start();
  }
}
