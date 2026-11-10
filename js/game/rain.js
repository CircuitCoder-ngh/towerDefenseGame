/**
 * Digital rain made from the generated glyph sprites. Glyphs step cell by
 * cell like a terminal; used on the map ground and the menu background.
 */
const GLYPHS = 40;

export class Rain {
  constructor(w, h, opts = {}) {
    this.colW = opts.colW || 8;
    this.cellH = 8;
    this.density = opts.density ?? 0.5;
    this.speed = opts.speed || 1;
    this.resize(w, h);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    const n = Math.ceil(w / this.colW);
    this.cols = [];
    for (let i = 0; i < n; i++) this.cols.push(this.newCol(i, true));
  }

  newCol(i, init) {
    return {
      x: i * this.colW + Math.floor((this.colW - 6) / 2),
      y: init ? Math.random() * this.h * 1.4 - this.h * 0.4 : -Math.random() * this.h * 0.5,
      speed: (20 + Math.random() * 45) * this.speed,
      len: 5 + Math.floor(Math.random() * 14),
      glyphs: Array.from({ length: 24 }, () => Math.floor(Math.random() * GLYPHS)),
      swapT: Math.random() * 0.2,
      active: Math.random() < this.density,
    };
  }

  update(dt) {
    for (let i = 0; i < this.cols.length; i++) {
      const col = this.cols[i];
      col.y += col.speed * dt;
      col.swapT -= dt;
      if (col.swapT <= 0) {
        col.glyphs[Math.floor(Math.random() * col.glyphs.length)] = Math.floor(Math.random() * GLYPHS);
        col.swapT = 0.06 + Math.random() * 0.15;
      }
      if (col.y - col.len * this.cellH > this.h) this.cols[i] = this.newCol(i, false);
    }
  }

  draw(ctx, atlas, alpha = 1, mask = null) {
    const ch = this.cellH;
    const prev = ctx.globalAlpha;
    for (const col of this.cols) {
      if (!col.active) continue;
      const head = Math.floor(col.y / ch);
      for (let k = 0; k < col.len; k++) {
        const gy = (head - k) * ch;
        if (gy < -ch || gy > this.h) continue;
        if (mask && !mask(col.x + 3, gy + 4)) continue;
        const a = k === 0 ? 1 : 0.85 * (1 - k / col.len);
        const g = col.glyphs[(head - k + 9999) % col.glyphs.length];
        ctx.globalAlpha = prev * alpha * a;
        atlas.drawTL(ctx, (k === 0 ? 'glyph_w_' : 'glyph_g_') + g, col.x, gy);
      }
    }
    ctx.globalAlpha = prev;
  }
}
