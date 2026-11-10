/**
 * Texture atlas: loads assets/sprites.json + sprites.png (built by
 * tools/generate_sprites.py) and draws frames / animations.
 */
export class Atlas {
  constructor() {
    this.img = null;
    this.frames = {};
    this.anims = {};
    this.base = null;
  }

  async load(base) {
    const meta = await (await fetch(base + 'sprites.json')).json();
    this.frames = meta.frames;
    this.anims = meta.anims;
    this.img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = base + meta.image;
    });
  }

  has(name) {
    return !!(this.frames[name] || this.anims[name]);
  }

  /** Frame name for an animation at time t (seconds). Plain sprites return themselves. */
  frame(name, t = 0, fps = 8) {
    const a = this.anims[name];
    if (!a) return name;
    return a[Math.floor(t * fps) % a.length];
  }

  frameAt(name, i) {
    const a = this.anims[name];
    if (!a) return name;
    return a[((i % a.length) + a.length) % a.length];
  }

  count(name) {
    const a = this.anims[name];
    return a ? a.length : 1;
  }

  /**
   * Draw a frame centred at (x, y) in the current transform.
   * When `base` ([S, ox, oy]) is set by the renderer, rotated/scaled draws use
   * a direct setTransform instead of save()/restore() (much cheaper).
   */
  draw(ctx, name, x, y, rot = 0, scale = 1, alpha = 1) {
    const f = this.frames[name] || this.frames[this.frameAt(name, 0)];
    if (!f) return;
    const sx = f[0], sy = f[1], w = f[2], h = f[3];
    let pa = 1;
    if (alpha !== 1) {
      pa = ctx.globalAlpha;
      ctx.globalAlpha = pa * alpha;
    }
    if (rot === 0 && scale === 1) {
      ctx.drawImage(this.img, sx, sy, w, h, x - w / 2, y - h / 2, w, h);
    } else if (this.base) {
      const b = this.base;
      const S = b[0];
      const c = Math.cos(rot) * scale * S, s = Math.sin(rot) * scale * S;
      ctx.setTransform(c, s, -s, c, b[1] + x * S, b[2] + y * S);
      ctx.drawImage(this.img, sx, sy, w, h, -w / 2, -h / 2, w, h);
      ctx.setTransform(S, 0, 0, S, b[1], b[2]);
    } else {
      ctx.save();
      ctx.translate(x, y);
      if (rot) ctx.rotate(rot);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.drawImage(this.img, sx, sy, w, h, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    if (alpha !== 1) ctx.globalAlpha = pa;
  }

  /** Draw a frame with its top-left at (x, y). */
  drawTL(ctx, name, x, y, w, h) {
    const f = this.frames[name];
    if (!f) return;
    ctx.drawImage(this.img, f[0], f[1], f[2], f[3], x, y, w ?? f[2], h ?? f[3]);
  }

  /**
   * Build a small DOM canvas containing one or more layered sprites at 1x.
   * CSS scales it with `image-rendering: pixelated`.
   */
  canvas(names, frame = 0, cls = 'ico') {
    if (!Array.isArray(names)) names = [names];
    const fs = names.map((n) => this.frames[this.frameAt(n, frame)]).filter(Boolean);
    const w = Math.max(1, ...fs.map((f) => f[2]));
    const h = Math.max(1, ...fs.map((f) => f[3]));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.className = cls;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (const f of fs) {
      ctx.drawImage(this.img, f[0], f[1], f[2], f[3], (w - f[2]) / 2, (h - f[3]) / 2, f[2], f[3]);
    }
    return cv;
  }
}
