import { TOWERS, towerStats } from '../data/towers.js';
import { TILE, angleDiff, dist2 } from '../engine/util.js';

export class Tower {
  constructor(game, type, c, r) {
    this.game = game;
    this.type = type;
    this.def = TOWERS[type];
    this.c = c;
    this.r = r;
    this.x = c * TILE + 8;
    this.y = r * TILE + 8;
    this.level = 0;
    this.angle = -Math.PI / 2;
    this.cd = 0.25;
    this.retarget = 0;
    this.targeting = this.def.defaultTarget || 'first';
    this.target = null;
    this.kills = 0;
    this.dmgDone = 0;
    this.invested = this.def.cost;
    this.buildT = 0;
    this.recoil = 0;
    this.lockT = 0;
    this.pulseT = 0;
    this.disabledT = 0;
    this.rateMul = 1;
    this.dmgMul = 1;
    this.rangeMul = 1;
    this.twinSide = 1;
    this.firing = false;
    this.animT = Math.random() * 4;
    this.refresh();
  }

  refresh() {
    this.s = towerStats(this.type, this.level);
  }

  get range() {
    return (this.s.range || 0) * TILE * this.rangeMul;
  }

  get maxLevel() {
    return this.def.levels.length - 1;
  }

  get upgradeCost() {
    return this.level < this.maxLevel ? this.def.levels[this.level + 1].cost : null;
  }

  get sellValue() {
    return Math.floor(this.invested * 0.7);
  }

  muzzle(dist = 7) {
    return { x: this.x + Math.cos(this.angle) * dist, y: this.y + Math.sin(this.angle) * dist };
  }

  update(dt) {
    this.animT += dt;
    if (this.buildT < 1) this.buildT = Math.min(1, this.buildT + dt * 3.5);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 18);
    if (this.pulseT > 0) this.pulseT = Math.max(0, this.pulseT - dt * 4);
    if (this.disabledT > 0) {
      this.disabledT -= dt;
      this.firing = false;
      this.target = null;
      if (Math.random() < dt * 12) {
        this.game.fx.particle(this.x + (Math.random() - 0.5) * 12, this.y + (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 30, -20 - Math.random() * 20, 0.3, Math.random() < 0.5 ? '#ff3355' : '#ffe600', 1);
      }
      return;
    }
    switch (this.type) {
      case 'pulse':
      case 'sniper':
      case 'bomb':
        this.updateGun(dt);
        break;
      case 'beam':
        this.updateBeam(dt);
        break;
      case 'ice':
        this.updateIce(dt);
        break;
      case 'arc':
        this.updateArc(dt);
        break;
      default:
        break;
    }
  }

  validTarget(t, R) {
    return t && t.targetable && dist2(this.x, this.y, t.x, t.y) <= R * R;
  }

  turnTo(want, dt) {
    const diff = angleDiff(this.angle, want);
    const step = (this.def.turn || 10) * dt;
    this.angle += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    return Math.abs(angleDiff(this.angle, want));
  }

  updateGun(dt) {
    const g = this.game;
    const R = this.range;
    this.cd = Math.max(0, this.cd - dt * this.rateMul);
    this.retarget -= dt;
    if (!this.validTarget(this.target, R) || this.retarget <= 0) {
      this.target = g.findTarget(this.x, this.y, R, this.targeting);
      this.retarget = 0.15;
    }
    const t = this.target;
    if (!t) return;
    let ax = t.x, ay = t.y;
    if (this.type === 'bomb') {
      const lead = g.predict(t, 0.7);
      ax = lead.x;
      ay = lead.y;
    }
    const off = this.turnTo(Math.atan2(ay - this.y, ax - this.x), dt);
    if (this.cd <= 0 && off < 0.3) {
      this.fire(t, ax, ay);
      this.cd += 1 / this.s.rate;
    }
  }

  fire(t, ax, ay) {
    const g = this.game;
    const fx = g.fx;
    const dmg = this.s.dmg * this.dmgMul;
    if (this.type === 'pulse') {
      const m = this.muzzle(7);
      if (this.s.twin) {
        const px = -Math.sin(this.angle) * 2.5 * this.twinSide, py = Math.cos(this.angle) * 2.5 * this.twinSide;
        m.x += px;
        m.y += py;
        this.twinSide *= -1;
      }
      g.spawnBullet({ x: m.x, y: m.y, target: t, dmg, speed: 230, sprite: this.level >= 1 ? 'proj_pulse_3' : 'proj_pulse_1', tower: this });
      fx.sprite('glow_g', m.x, m.y, 30, { add: true, scale: 0.5 });
      this.recoil = 1.5;
      g.sfx('pulse');
    } else if (this.type === 'sniper') {
      const m = this.muzzle(8);
      const crit = this.s.crit && Math.random() < this.s.crit;
      const d = dmg * (crit ? 2.5 : 1);
      t.damage(d, { pierce: this.s.pierce, src: this, crit, instant: true });
      fx.line([{ x: m.x, y: m.y }, { x: t.x, y: t.y }], crit ? '#ffe600' : '#ff3355', 0.14, 1, true);
      fx.line([{ x: m.x, y: m.y }, { x: t.x, y: t.y }], '#ffffff', 0.06, 0.4, false);
      fx.sprite('glow_r', m.x, m.y, 24, { add: true, scale: 0.8 });
      fx.sprite('fx_spark', t.x, t.y, 20);
      fx.burst(t.x, t.y, 6, ['#ff3355', '#ffb0bd'], 40, 0.3);
      this.recoil = 3;
      fx.addShake(0.6);
      g.sfx(crit ? 'crit' : 'sniper');
      if (crit) g.sfx('sniper');
    } else if (this.type === 'bomb') {
      const m = this.muzzle(7);
      g.spawnBomb({ x0: m.x, y0: m.y, x1: ax, y1: ay, dmg, splash: this.s.splash * TILE, burn: this.s.burn, tower: this,
        sprite: this.level >= 2 ? 'proj_bomb_3' : 'proj_bomb_1' });
      fx.burst(m.x, m.y, 4, ['#ff8a1f', '#5e7480'], 20, 0.3);
      this.recoil = 2.5;
      g.sfx('bomb');
    }
  }

  updateBeam(dt) {
    const g = this.game;
    const R = this.range;
    if (!this.validTarget(this.target, R)) {
      const nt = g.findTarget(this.x, this.y, R, this.targeting);
      if (nt !== this.target) {
        this.lockT = 0;
        if (nt) g.sfx('beam');
      }
      this.target = nt;
    }
    const t = this.target;
    this.firing = false;
    if (!t) {
      this.lockT = Math.max(0, this.lockT - dt * 2);
      return;
    }
    const off = this.turnTo(Math.atan2(t.y - this.y, t.x - this.x), dt);
    if (off < 0.4) {
      this.firing = true;
      this.lockT += dt * this.rateMul;
      const k = Math.min(1, this.lockT / this.s.rampTime);
      const dps = this.s.dps * (1 + (this.s.ramp - 1) * k) * this.dmgMul * this.rateMul;
      t.damage(dps * dt, { pierce: true, src: this });
      if (Math.random() < dt * 14) g.fx.sprite('fx_spark_c', t.x + (Math.random() - 0.5) * 4, t.y + (Math.random() - 0.5) * 4, 24);
    }
  }

  updateIce(dt) {
    const g = this.game;
    this.cd = Math.max(0, this.cd - dt * this.rateMul);
    if (this.cd > 0) return;
    const R = this.range;
    const hits = g.enemiesInRange(this.x, this.y, R, false);
    if (!hits.length) return;
    this.cd = 1 / this.s.rate;
    this.pulseT = 1;
    for (const e of hits) {
      e.slow(this.s.slow, this.s.slowDur);
      if (this.s.freeze && Math.random() < this.s.freeze) {
        e.stun(0.8);
        g.fx.sprite('fx_spark_i', e.x, e.y, 16);
      }
      e.damage(this.s.dmg * this.dmgMul, { src: this });
    }
    g.fx.ring(this.x, this.y, 4, R, 0.5, '#a8ecff', 1.2);
    g.fx.ring(this.x, this.y, 2, R * 0.7, 0.35, '#f0ffff', 0.6);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = R * (1.2 + Math.random());
      g.fx.particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, 0.4, i % 2 ? '#a8ecff' : '#f0ffff', 1);
    }
    g.sfx('ice');
  }

  updateArc(dt) {
    const g = this.game;
    this.cd = Math.max(0, this.cd - dt * this.rateMul);
    if (this.cd > 0) return;
    const R = this.range;
    const first = g.findTarget(this.x, this.y, R, this.targeting);
    if (!first) return;
    this.cd = 1 / this.s.rate;
    this.pulseT = 1;
    let dmg = this.s.dmg * this.dmgMul;
    let cur = first;
    let px = this.x, py = this.y - 2;
    const hit = new Set();
    for (let i = 0; i < this.s.chains && cur; i++) {
      hit.add(cur);
      g.fx.bolt(px, py, cur.x, cur.y, '#ff2bd6', 0.18, 3.5, 1);
      g.fx.bolt(px, py, cur.x, cur.y, '#ffb3f2', 0.1, 1.5, 0.5);
      g.fx.sprite('fx_spark_m', cur.x, cur.y, 20);
      const ex = cur.x, ey = cur.y;
      cur.damage(dmg, { src: this });
      px = ex;
      py = ey;
      dmg *= 0.8;
      cur = g.nearestEnemy(px, py, this.s.chainRange * TILE, hit);
    }
    g.fx.sprite('glow_m', this.x, this.y - 2, 24, { add: true, scale: 1 });
    g.sfx('arc');
  }
}
