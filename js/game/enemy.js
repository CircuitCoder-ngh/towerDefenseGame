import { ENEMIES } from '../data/enemies.js';
import { TILE, angleDiff } from '../engine/util.js';
import { TUNE } from '../data/waves.js';

let NEXT_ID = 1;

export class Enemy {
  constructor(game, type, routeIdx, opts) {
    const def = ENEMIES[type];
    this.def = def;
    this.type = type;
    this.id = NEXT_ID++;
    this.game = game;
    this.routeIdx = routeIdx;
    this.route = game.map.routes[routeIdx];
    this.waveN = opts.waveN;
    this.track = opts.track || null;
    this.maxHp = Math.max(1, Math.round(def.hp * opts.hpMul));
    this.hp = this.maxHp;
    this.armor = def.armor || 0;
    this.shield = 0;
    this.maxShield = 0;
    this.baseSpeed = def.speed * TILE * (opts.spdMul || 1);
    this.d = opts.d || 0;
    this.seg = 0;
    const spread = def.boss ? 0.5 : 2.6;
    this.ox = (Math.random() * 2 - 1) * spread;
    this.oy = (Math.random() * 2 - 1) * spread;
    this.x = 0;
    this.y = 0;
    this.ang = 0;
    this.dirAng = 0;
    this.slowT = 0;
    this.slowAmt = 0;
    this.stunT = 0;
    this.flash = 0;
    this.animT = Math.random();
    this.revealed = false;
    this.alive = true;
    this.blinkT = def.blink ? def.blink.every * (0.5 + Math.random() * 0.8) : 0;
    this.auraT = def.aura ? def.aura.every * Math.random() : 0;
    this.summonT = def.summon ? def.summon.every : 0;
    this.dmgAcc = 0;
    this.dmgT = 0;
    this.crit = false;
    this.phase = 0;
    this.reward = Math.max(1, Math.round(def.reward * (1 + TUNE.rewardGrowth * (this.waveN - 1))));
    this.size = def.size || 16;
    this.updatePos(true);
  }

  get remaining() {
    return this.route.len - this.d;
  }

  get targetable() {
    return this.alive && (!this.def.stealth || this.revealed);
  }

  updatePos(snap) {
    const r = this.route;
    if (snap) this.seg = 0;
    while (this.seg < r.cum.length - 2 && r.cum[this.seg + 1] <= this.d) this.seg++;
    const i = this.seg;
    const a = r.pts[i], b = r.pts[i + 1];
    const segLen = r.cum[i + 1] - r.cum[i];
    const t = segLen > 0 ? Math.min(1, (this.d - r.cum[i]) / segLen) : 0;
    this.x = a.x + (b.x - a.x) * t + this.ox;
    this.y = a.y + (b.y - a.y) * t + this.oy;
    this.dirAng = Math.atan2(b.y - a.y, b.x - a.x);
    if (snap) this.ang = this.dirAng;
  }

  update(dt) {
    const g = this.game;
    this.animT += dt;
    if (this.flash > 0) this.flash -= dt * 5;
    if (this.stunT > 0) {
      this.stunT -= dt;
    } else {
      let spd = this.baseSpeed;
      if (this.slowT > 0) {
        this.slowT -= dt;
        spd *= 1 - this.slowAmt * (1 - (this.def.slowResist || 0));
      }
      this.d += spd * dt;
    }
    if (this.d >= this.route.len) {
      g.onLeak(this);
      return;
    }
    this.updatePos(false);
    this.ang += angleDiff(this.ang, this.dirAng) * Math.min(1, dt * 12);

    const def = this.def;
    if (def.blink && this.stunT <= 0) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blinkT = def.blink.every * (0.7 + Math.random() * 0.6);
        g.enemyBlink(this);
      }
    }
    if (def.aura) {
      this.auraT -= dt;
      if (this.auraT <= 0) {
        this.auraT = def.aura.every;
        g.enemyAura(this);
      }
    }
    if (def.summon && this.stunT <= 0) {
      this.summonT -= dt;
      if (this.summonT <= 0) {
        this.summonT = def.summon.every;
        g.enemySummon(this);
      }
    }
    if (this.dmgAcc > 0) {
      this.dmgT -= dt;
      if (this.dmgT <= 0) this.flushDamage();
    }
  }

  flushDamage() {
    if (this.dmgAcc >= 0.5) this.game.showDamage(this, this.dmgAcc, this.crit);
    this.dmgAcc = 0;
    this.crit = false;
  }

  /** Apply damage; returns damage actually dealt (for stats). */
  damage(amount, opts = {}) {
    if (!this.alive || amount <= 0) return 0;
    let dmg = amount;
    if (!opts.pierce && this.armor > 0) dmg = Math.max(dmg * 0.2, dmg - this.armor);
    let dealt = 0;
    if (this.shield > 0) {
      const s = Math.min(this.shield, dmg);
      this.shield -= s;
      dmg -= s;
      dealt += s;
    }
    const h = Math.min(this.hp, dmg);
    this.hp -= h;
    dealt += h;
    this.flash = 1;
    if (this.dmgAcc === 0) this.dmgT = opts.instant ? 0.05 : 0.3;
    this.dmgAcc += dealt;
    if (opts.crit) this.crit = true;
    if (opts.src) opts.src.dmgDone += dealt;
    if (this.hp <= 0.001) {
      this.flushDamage();
      this.game.onKill(this, opts.src);
    } else if (this.def.phases) {
      this.game.checkPhase(this);
    }
    return dealt;
  }

  slow(amt, dur) {
    if (amt >= this.slowAmt || this.slowT <= 0) this.slowAmt = amt;
    this.slowT = Math.max(this.slowT, dur);
  }

  stun(dur) {
    this.stunT = Math.max(this.stunT, this.def.boss ? dur * 0.4 : dur);
  }
}
