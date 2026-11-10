import { TAU, compact, easeOutCubic } from '../engine/util.js';

/**
 * Visual effects: pixel particles, sprite animations, floating text,
 * expanding rings, lightning/tracer lines, screen flash and shake.
 */
export class FX {
  constructor(game) {
    this.g = game;
    this.parts = [];
    this.sprites = [];
    this.texts = [];
    this.rings = [];
    this.lines = [];
    this.flash = null;
    this.shake = 0;
  }

  particle(x, y, vx, vy, life, color, size = 1, opts = {}) {
    if (this.parts.length > 900) this.parts.splice(0, 100);
    this.parts.push({
      x, y, vx, vy, life, max: life, color, size,
      grav: opts.grav || 0, drag: opts.drag ?? 0.92, add: opts.add ?? true,
    });
  }

  burst(x, y, n, colors, speed = 30, life = 0.5, size = 1, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6),
        colors[i % colors.length], size, opts);
    }
  }

  /** Disintegration: chunky squares in the malware's palette fall apart. */
  derez(x, y, colors, size = 16, n = 14) {
    const half = size * 0.35;
    for (let i = 0; i < n; i++) {
      const px = x + (Math.random() * 2 - 1) * half;
      const py = y + (Math.random() * 2 - 1) * half;
      this.particle(px, py, (px - x) * 3 + (Math.random() - 0.5) * 20, (py - y) * 3 - 15 - Math.random() * 25,
        0.45 + Math.random() * 0.45, colors[i % colors.length], 1 + Math.floor(Math.random() * 2),
        { grav: 90, drag: 0.94, add: false });
    }
    for (let i = 0; i < 5; i++) {
      this.particle(x + (Math.random() - 0.5) * size * 0.6, y, 0, -20 - Math.random() * 30, 0.6, '#00ff41', 1,
        { drag: 0.96, add: true });
    }
  }

  sprite(name, x, y, fps = 16, opts = {}) {
    this.sprites.push({
      name, x, y, t: 0, fps, rot: opts.rot || 0, scale: opts.scale || 1,
      add: opts.add ?? false, vy: opts.vy || 0, alpha: opts.alpha ?? 1, life: opts.life || 0,
    });
  }

  text(x, y, str, color = '#b6ffb0', opts = {}) {
    if (this.texts.length > 60) this.texts.shift();
    this.texts.push({ x, y, str, color, t: 0, life: opts.life || 0.9, vy: opts.vy ?? -16, size: opts.size || 7 });
  }

  ring(x, y, r0, r1, life, color, width = 1) {
    this.rings.push({ x, y, r0, r1, t: 0, life, color, width });
  }

  line(pts, color, life, width = 1, glow = true) {
    this.lines.push({ pts, color, t: 0, life, width, glow });
  }

  bolt(x0, y0, x1, y1, color, life = 0.16, jag = 3, width = 1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.floor(len / 5));
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    const pts = [{ x: x0, y: y0 }];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = (Math.random() * 2 - 1) * jag;
      pts.push({ x: x0 + (x1 - x0) * t + nx * off, y: y0 + (y1 - y0) * t + ny * off });
    }
    pts.push({ x: x1, y: y1 });
    this.line(pts, color, life, width, true);
  }

  doFlash(color, life = 0.25, alpha = 0.35) {
    this.flash = { color, t: 0, life, alpha };
  }

  addShake(a) {
    if (this.g.settings.shake) this.shake = Math.min(7, this.shake + a);
  }

  update(dt) {
    for (const p of this.parts) {
      const dr = Math.pow(p.drag, dt * 60);
      p.vx *= dr;
      p.vy = p.vy * dr + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    compact(this.parts, (p) => p.life > 0);
    for (const s of this.sprites) {
      s.t += dt;
      s.y += s.vy * dt;
    }
    const atlas = this.g.atlas;
    compact(this.sprites, (s) => (s.life ? s.t < s.life : Math.floor(s.t * s.fps) < atlas.count(s.name)));
    for (const t of this.texts) {
      t.t += dt;
      t.y += t.vy * dt * (1 - t.t / t.life);
    }
    compact(this.texts, (t) => t.t < t.life);
    for (const r of this.rings) r.t += dt;
    compact(this.rings, (r) => r.t < r.life);
    for (const l of this.lines) l.t += dt;
    compact(this.lines, (l) => l.t < l.life);
    if (this.flash) {
      this.flash.t += dt;
      if (this.flash.t >= this.flash.life) this.flash = null;
    }
    this.shake = Math.max(0, this.shake - dt * 14);
  }

  draw(ctx) {
    const atlas = this.g.atlas;
    for (const r of this.rings) {
      const k = r.t / r.life;
      const rad = r.r0 + (r.r1 - r.r0) * easeOutCubic(k);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0.1, rad), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const s of this.sprites) {
      const f = atlas.frameAt(s.name, Math.floor(s.t * s.fps));
      if (s.add) ctx.globalCompositeOperation = 'lighter';
      atlas.draw(ctx, f, s.x, s.y, s.rot, s.scale, s.life ? s.alpha * (1 - s.t / s.life) : s.alpha);
      if (s.add) ctx.globalCompositeOperation = 'source-over';
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    for (const l of this.lines) {
      const a = 1 - l.t / l.life;
      if (l.glow) {
        ctx.globalAlpha = a * 0.35;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width * 3;
        this.poly(ctx, l.pts);
      }
      ctx.globalAlpha = a;
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width;
      this.poly(ctx, l.pts);
    }
    for (const p of this.parts) {
      if (!p.add) continue;
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.parts) {
      if (p.add) continue;
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let font = '';
    for (const t of this.texts) {
      const k = t.t / t.life;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const pop = k < 0.12 ? 1 + (0.12 - k) * 3 : 1;
      const f = `${Math.round(t.size * pop)}px VT323`;
      if (f !== font) {
        ctx.font = f;
        font = f;
      }
      ctx.fillStyle = '#020604';
      ctx.fillText(t.str, t.x + 0.8, t.y + 0.8);
      ctx.fillText(t.str, t.x - 0.5, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}
