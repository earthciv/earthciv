// Minimap: a pre-rendered thumbnail of the current colours + the camera's view box.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
const packRGBA = LITTLE_ENDIAN
  ? (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)
  : (r, g, b) => ((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | 255;
const BG_PX = packRGBA(0x0d, 0x2a, 0x47);

export class Minimap {
  constructor(canvas, world, camera, onJump) {
    this.canvas = canvas;
    this.w = world;
    this.cam = camera;
    // 230 px wide, and never taller than the U.S. map's 152 px: Canada's nearly square map would stand 200 px tall
    // and reach the Vancouver banner in short windows. (The U.S. map is still exactly 230 × 152.)
    const W = 230, MAX_H = 152;
    this.k = Math.min(W / world.raw.width, MAX_H / world.raw.height);
    this.cssW = Math.round(world.raw.width * this.k);
    this.cssH = Math.round(world.raw.height * this.k);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = this.cssW * dpr;
    canvas.height = this.cssH * dpr;
    canvas.style.width = this.cssW + "px";
    canvas.style.height = this.cssH + "px";
    this.dpr = dpr;
    this.base = document.createElement("canvas");
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    this.baseCtx = this.base.getContext("2d");
    this.img = this.baseCtx.createImageData(this.base.width, this.base.height);
    this.u32 = new Uint32Array(this.img.data.buffer);
    // Precompute pixel → cell index once so both setup and rebuild() are O(minimap pixels) at any grid size.
    const pw = this.base.width, ph = this.base.height;
    const cellOf = new Int32Array(pw * ph);
    const g = world.grid, invK = 1 / (this.k * dpr);
    for (let y = 0, p = 0; y < ph; y++) {
      const wy = (y + 0.5) * invK;
      for (let x = 0; x < pw; x++, p++) cellOf[p] = g.cellAt((x + 0.5) * invK, wy);
    }
    this.cellOf = cellOf;
    this.palette = new Uint32Array(g.size);

    let dragging = false;
    const jump = (e) => {
      const r = canvas.getBoundingClientRect();
      onJump((e.clientX - r.left) / this.k, (e.clientY - r.top) / this.k);
    };
    canvas.addEventListener("pointerdown", (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); jump(e); });
    canvas.addEventListener("pointermove", (e) => dragging && jump(e));
    canvas.addEventListener("pointerup", () => (dragging = false));
  }

  rebuild() {
    const rgb = this.w.rgb;
    if (rgb) {
      const pal = this.palette;
      for (let i = 0; i < pal.length; i++) {
        const c = rgb[i];
        pal[i] = packRGBA(c[0] | 0, c[1] | 0, c[2] | 0);
      }
      const cellOf = this.cellOf, u32 = this.u32;
      for (let p = 0; p < u32.length; p++) {
        const i = cellOf[p];
        u32[p] = i >= 0 ? pal[i] : BG_PX;
      }
      this.baseCtx.putImageData(this.img, 0, 0);
    } else {
      const g = this.w.grid;
      const ctx = this.baseCtx;
      const k = this.k * this.dpr;
      ctx.fillStyle = "#0d2a47";
      ctx.fillRect(0, 0, this.base.width, this.base.height);
      const cw = g.W * k + 1, ch = g.H * k + 1;
      for (let i = 0; i < g.size; i++) {
        ctx.fillStyle = this.w.colors[i];
        ctx.fillRect((g.cx(i) - g.W / 2) * k, (g.cy(i) - g.H / 2) * k, cw, ch);
      }
    }
    this.sig = "";
    this.draw();
  }

  // Called every map frame: repaints only when the view box moved (or rebuild() changed the thumbnail).
  draw() {
    const v = this.cam.view();
    const sig = `${v.x0},${v.y0},${v.x1},${v.y1}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    const k = this.k * this.dpr;
    ctx.strokeStyle = "#ffe9a8";
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.strokeRect(v.x0 * k, v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k);
  }
}
