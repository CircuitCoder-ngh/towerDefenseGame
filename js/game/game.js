import { TILE, TAU, dist2, compact, easeOutBack, hexA } from '../engine/util.js';
import { TOWERS, towerStats } from '../data/towers.js';
import { ENEMIES } from '../data/enemies.js';
import { buildWave, hpScale, bossScale, waveTypes, TUNE } from '../data/waves.js';
import { GameMap } from './map.js';
import { Enemy } from './enemy.js';
import { Tower } from './tower.js';
import { FX } from './fx.js';
import { Rain } from './rain.js';

const STEP = 1 / 60;

export const ABILITIES = {
  emp: { name: 'EMP', cd: 45, desc: 'Stuns all malware for 2.5s and strips shields.' },
  purge: { name: 'PURGE', cd: 35, desc: 'Orbital strike on a zone you tap. Pierces armor.' },
  overclock: { name: 'OVERCLOCK', cd: 60, dur: 8, desc: '+60% fire rate for every tower for 8s.' },
};

class Spawner {
  constructor(wave) {
    this.n = wave.n;
    this.groups = wave.groups.map((g) => ({ ...g, t: -g.delay, spawned: 0 }));
    this.done = false;
  }

  update(dt, game) {
    for (const g of this.groups) {
      if (g.spawned >= g.count) continue;
      g.t += dt;
      while (g.t >= 0 && g.spawned < g.count) {
        game.spawnEnemy(g.type, Math.min(g.spawn, game.map.routes.length - 1), this.n);
        g.spawned++;
        g.t -= Math.max(0.05, g.gap);
      }
    }
    this.done = this.groups.every((g) => g.spawned >= g.count);
  }
}

export class Game {
  constructor({ mapDef, diff = 'normal', endless = false, atlas, audio, settings, resume = null, emit }) {
    this.def = mapDef;
    this.map = new GameMap(mapDef);
    this.atlas = atlas;
    this.audio = audio;
    this.settings = settings;
    this.emit = emit || (() => {});
    this.diff = diff;
    this.endless = endless;
    this.totalWaves = mapDef.waves;
    this.maxLives = diff === 'hard' ? 10 : 20;
    this.lives = this.maxLives;
    this.bits = Math.round(mapDef.startBits * (diff === 'hard' ? 0.85 : 1));
    this.waveNum = 0;
    this.towers = [];
    this.enemies = [];
    this.projs = [];
    this.zones = [];
    this.strikes = [];
    this.spawners = [];
    this.tracks = new Map();
    this.detectors = [];
    this.grid = Array.from({ length: this.map.rows }, () => Array(this.map.cols).fill(null));
    this.fx = new FX(this);
    this.rain = new Rain(this.map.w, this.map.h, { density: 0.6 });
    this.time = 0;
    this.rt = 0;
    this.acc = 0;
    this.speed = 1;
    this.paused = false;
    this.over = false;
    this.result = null;
    this.abilities = { emp: { t: 0 }, purge: { t: 0 }, overclock: { t: 0, active: 0 } };
    this.stats = { kills: 0, earned: 0, built: 0, leaked: 0, time: 0, bossKills: 0 };
    this.mapCanvas = this.map.prerender(atlas);
    this.rainCv = document.createElement('canvas');
    this.rainCv.width = this.map.w;
    this.rainCv.height = this.map.h;
    this.ui = { selected: null, ghost: null, armed: null, purgeAim: false };
    this.view = { S: 1, ox: 0, oy: 0, cw: 1, ch: 1 };
    this.autoT = 0;
    this.coreHitT = 0;
    if (resume) this.restore(resume);
  }

  // ------------------------------------------------------------ helpers
  sfx(name) {
    this.audio.play(name);
  }

  vibrate(p) {
    if (this.settings.haptics && navigator.vibrate) {
      try {
        navigator.vibrate(p);
      } catch (e) { /* ignore */ }
    }
  }

  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.map.cols && r < this.map.rows;
  }

  towerAt(c, r) {
    return this.inBounds(c, r) ? this.grid[r][c] : null;
  }

  canBuild(c, r) {
    return this.inBounds(c, r) && this.map.isBuildable(c, r) && !this.grid[r][c];
  }

  get canCallWave() {
    return !this.over && this.spawners.length === 0 && (this.endless || this.waveNum < this.totalWaves);
  }

  get earlyBonus() {
    return Math.round(8 + this.waveNum * 1.5);
  }

  get idle() {
    return this.tracks.size === 0 && this.spawners.length === 0 && this.enemies.length === 0;
  }

  get boss() {
    for (const e of this.enemies) if (e.alive && e.def.boss) return e;
    return null;
  }

  // -------------------------------------------------------------- build
  build(type, c, r) {
    const def = TOWERS[type];
    if (!this.canBuild(c, r)) {
      this.emit('error', 'CANNOT DEPLOY HERE');
      return null;
    }
    if (this.bits < def.cost) {
      this.emit('error', 'INSUFFICIENT BITS');
      return null;
    }
    this.bits -= def.cost;
    const t = new Tower(this, type, c, r);
    this.towers.push(t);
    this.grid[r][c] = t;
    this.stats.built++;
    this.fx.ring(t.x, t.y, 2, 13, 0.4, def.color, 1);
    this.fx.burst(t.x, t.y, 14, [def.color, '#ffffff'], 40, 0.45);
    for (let i = 0; i < 6; i++) {
      this.fx.particle(t.x - 6 + i * 2.4, t.y + 7, 0, -30 - Math.random() * 20, 0.5, def.color, 1);
    }
    this.sfx('build');
    this.vibrate(12);
    this.emit('bits');
    return t;
  }

  upgrade(t) {
    const cost = t.upgradeCost;
    if (cost == null) return false;
    if (this.bits < cost) {
      this.emit('error', 'INSUFFICIENT BITS');
      return false;
    }
    this.bits -= cost;
    t.level++;
    t.invested += cost;
    t.refresh();
    t.buildT = 0.55;
    this.fx.sprite('fx_upgrade', t.x, t.y - 4, 10);
    this.fx.burst(t.x, t.y, 18, [t.def.color, '#ffffff', '#00ff41'], 50, 0.5);
    this.fx.ring(t.x, t.y, 3, 14, 0.45, '#00ff41', 1);
    this.fx.text(t.x, t.y - 11, `LV${t.level + 1}`, '#00ff41', { size: 7 });
    this.sfx('upgrade');
    this.vibrate(15);
    this.emit('bits');
    return true;
  }

  sell(t) {
    const v = t.sellValue;
    this.bits += v;
    this.towers = this.towers.filter((o) => o !== t);
    this.grid[t.r][t.c] = null;
    this.fx.burst(t.x, t.y, 16, [t.def.color, '#5e7480', '#93aab5'], 40, 0.6, 1, { add: false, grav: 70 });
    this.fx.text(t.x, t.y - 6, `+${v}`, '#ffe600');
    this.sfx('sell');
    if (this.ui.selected === t) this.ui.selected = null;
    this.emit('bits');
  }

  // -------------------------------------------------------------- waves
  callNextWave() {
    if (!this.canCallWave) return false;
    if (this.waveNum > 0 && this.enemies.length > 0) {
      const b = this.earlyBonus;
      this.bits += b;
      this.stats.earned += b;
      this.emit('toast', { text: `EARLY CALL +${b}`, kind: 'gold' });
    }
    this.waveNum++;
    const n = this.waveNum;
    const wave = buildWave(this.def, n, this.map.routes.length, this.endless);
    this.spawners.push(new Spawner(wave));
    this.tracks.set(n, { n, alive: 0, spawning: true });
    const boss = wave.groups.some((g) => ENEMIES[g.type].boss);
    this.audio.setMusic(boss ? 'boss' : 'wave');
    this.sfx('wave');
    for (const s of this.map.spawns) this.fx.ring(s.x, s.y, 2, 16, 0.6, '#ff2bd6', 1.5);
    this.emit('wave', { n, types: waveTypes(wave), boss });
    this.emit('bits');
    return true;
  }

  spawnEnemy(type, routeIdx, waveN, opts = {}) {
    const def = ENEMIES[type];
    const hpMul = (def.boss ? bossScale(waveN, this.diff) : hpScale(waveN, this.diff)) * (this.def.hpMul || 1);
    const track = opts.track !== undefined ? opts.track : this.tracks.get(waveN) || null;
    const e = new Enemy(this, type, routeIdx, {
      waveN, hpMul, spdMul: 1 + Math.min(0.2, waveN * 0.005), d: opts.d || 0, track,
    });
    if (track) track.alive++;
    this.enemies.push(e);
    if (def.boss && !opts.silent) {
      this.emit('boss', e);
      this.sfx('boss');
      this.vibrate([60, 40, 60, 40, 120]);
    }
    if (!opts.d) {
      const sp = this.map.routes[routeIdx].pts[1];
      this.fx.burst(sp.x, sp.y, 5, def.colors, 25, 0.35);
    }
    return e;
  }

  release(e) {
    e.alive = false;
    if (e.track) {
      e.track.alive--;
      e.track = null;
    }
  }

  onKill(e, src) {
    if (!e.alive) return;
    const def = e.def;
    if (def.onDeath) {
      for (let i = 0; i < def.onDeath.count; i++) {
        this.spawnEnemy(def.onDeath.type, e.routeIdx, e.waveN, { d: Math.max(1, e.d + (i - 1) * 5), track: e.track, silent: true });
      }
      this.fx.burst(e.x, e.y, 10, ['#ff8a1f', '#5e7480'], 50, 0.5, 1, { add: false, grav: 60 });
    }
    this.release(e);
    this.bits += e.reward;
    this.stats.kills++;
    this.stats.earned += e.reward;
    if (src) src.kills++;
    this.fx.derez(e.x, e.y, def.colors, e.size, def.boss ? 50 : 12);
    this.fx.sprite('fx_bits', e.x, e.y - 4, 10, { vy: -22 });
    if (def.boss) {
      this.stats.bossKills++;
      for (let i = 0; i < 6; i++) {
        const ox = (Math.random() - 0.5) * 24, oy = (Math.random() - 0.5) * 24;
        this.fx.sprite('fx_explode', e.x + ox, e.y + oy, 12 + i * 2, { scale: 1 + Math.random() });
      }
      this.fx.ring(e.x, e.y, 4, 48, 0.8, '#ffffff', 2);
      this.fx.text(e.x, e.y - 18, `+${e.reward}`, '#ffe600', { size: 12, life: 1.6 });
      this.fx.doFlash('#ffffff', 0.35, 0.4);
      this.fx.addShake(6);
      this.sfx('bigdeath');
      this.vibrate([80, 40, 160]);
      this.emit('bossDown', e);
    } else {
      this.sfx('death');
    }
    this.emit('bits');
  }

  onLeak(e) {
    if (!e.alive) return;
    this.release(e);
    this.lives = Math.max(0, this.lives - e.def.dmg);
    this.stats.leaked++;
    const core = this.map.core;
    this.fx.burst(core.x, core.y, 16, ['#ff3355', '#ffffff', '#ff2bd6'], 50, 0.5);
    this.fx.ring(core.x, core.y, 3, 20, 0.5, '#ff3355', 1.5);
    this.fx.text(core.x, core.y - 11, `-${e.def.dmg}`, '#ff3355', { size: 10 });
    this.fx.doFlash('#ff0030', 0.3, 0.25);
    this.fx.addShake(e.def.boss ? 6 : 2.5);
    this.coreHitT = 1;
    this.sfx('core');
    this.vibrate(e.def.boss ? [100, 50, 200] : 50);
    this.emit('lives');
    if (this.lives <= 0) this.gameOver();
  }

  onWaveCleared(n) {
    if (this.over) return;
    const bonus = Math.round(TUNE.clearBase + TUNE.clearPer * n);
    let income = 0;
    for (const t of this.towers) {
      if (t.type !== 'miner') continue;
      income += t.s.income;
      this.fx.text(t.x, t.y - 9, `+${t.s.income}`, '#ffe600', { size: 8, life: 1.3 });
      this.fx.sprite('fx_bits', t.x, t.y - 6, 8, { vy: -16 });
    }
    this.bits += bonus + income;
    this.stats.earned += bonus + income;
    this.sfx('clear');
    this.emit('waveCleared', { n, bonus, income });
    this.emit('bits');
    if (this.idle) {
      if (!this.endless && this.waveNum >= this.totalWaves) {
        this.victory();
        return;
      }
      this.audio.setMusic('calm');
      this.emit('idle');
    }
  }

  gameOver() {
    if (this.over) return;
    this.over = true;
    this.result = 'defeat';
    this.ui.armed = null;
    this.ui.purgeAim = false;
    this.sfx('defeat');
    this.audio.setMusic('menu');
    this.fx.doFlash('#ff0030', 1.2, 0.5);
    this.emit('gameover', this.summary());
  }

  victory() {
    if (this.over) return;
    this.over = true;
    this.result = 'victory';
    this.ui.armed = null;
    const ratio = this.lives / this.maxLives;
    const stars = ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : 1;
    this.sfx('victory');
    this.audio.setMusic('menu');
    const c = this.map.core;
    for (let i = 0; i < 5; i++) this.fx.ring(c.x, c.y, 2, 30 + i * 20, 0.8 + i * 0.2, i % 2 ? '#00f0ff' : '#00ff41', 2);
    this.emit('victory', { ...this.summary(), stars });
  }

  summary() {
    return { wave: this.waveNum, total: this.totalWaves, lives: this.lives, maxLives: this.maxLives, endless: this.endless, ...this.stats };
  }

  // ---------------------------------------------------------- abilities
  abilityReady(k) {
    return !this.over && this.abilities[k].t <= 0;
  }

  useEmp() {
    if (!this.abilityReady('emp')) return false;
    this.abilities.emp.t = ABILITIES.emp.cd;
    const c = this.map.core;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.stun(2.5);
      e.shield = 0;
      this.fx.sprite('fx_spark_c', e.x, e.y, 14);
      e.damage(15, { pierce: true });
    }
    const far = Math.hypot(this.map.w, this.map.h);
    this.fx.ring(c.x, c.y, 4, far, 0.9, '#00f0ff', 3);
    this.fx.ring(c.x, c.y, 2, far * 0.8, 0.7, '#c8ffff', 1);
    this.fx.doFlash('#00f0ff', 0.4, 0.3);
    this.fx.addShake(3);
    this.sfx('emp');
    this.vibrate([30, 30, 80]);
    return true;
  }

  usePurge(x, y) {
    if (!this.abilityReady('purge')) return false;
    this.abilities.purge.t = ABILITIES.purge.cd;
    this.strikes.push({ x, y, t: 0.65, max: 0.65, done: false });
    this.sfx('purge_charge');
    return true;
  }

  useOverclock() {
    if (!this.abilityReady('overclock')) return false;
    this.abilities.overclock.t = ABILITIES.overclock.cd;
    this.abilities.overclock.active = ABILITIES.overclock.dur;
    for (const t of this.towers) {
      this.fx.ring(t.x, t.y, 2, 12, 0.5, '#ffe600', 1);
      this.fx.sprite('fx_upgrade', t.x, t.y - 4, 12);
    }
    this.fx.doFlash('#ffe600', 0.3, 0.18);
    this.sfx('overclock');
    this.vibrate(30);
    return true;
  }

  updateStrikes(dt) {
    for (const s of this.strikes) {
      s.t -= dt;
      if (s.t > 0 || s.done) continue;
      s.done = true;
      const dmg = 180 + 35 * this.waveNum;
      const R = 1.4 * TILE;
      for (const e of this.enemies) {
        if (e.alive && dist2(e.x, e.y, s.x, s.y) <= R * R) e.damage(dmg, { pierce: true, instant: true });
      }
      this.fx.line([{ x: s.x, y: s.y - 300 }, { x: s.x, y: s.y }], '#ff2bd6', 0.4, 8, true);
      this.fx.line([{ x: s.x, y: s.y - 300 }, { x: s.x, y: s.y }], '#ffffff', 0.3, 3, true);
      this.fx.sprite('fx_explode', s.x, s.y, 14, { scale: 2.2 });
      this.fx.burst(s.x, s.y, 40, ['#ff2bd6', '#ffffff', '#ff8a1f', '#ffe600'], 90, 0.7);
      this.fx.ring(s.x, s.y, 4, R * 1.5, 0.5, '#ff2bd6', 2);
      this.fx.doFlash('#ffffff', 0.2, 0.35);
      this.fx.addShake(5);
      this.sfx('purge');
      this.vibrate([50, 30, 100]);
    }
    compact(this.strikes, (s) => !s.done);
  }

  // -------------------------------------------------------- projectiles
  spawnBullet(o) {
    this.projs.push({
      kind: 'bullet', x: o.x, y: o.y, target: o.target, tx: o.target.x, ty: o.target.y, dmg: o.dmg,
      speed: o.speed, sprite: o.sprite, tower: o.tower, life: 1.2, ang: Math.atan2(o.target.y - o.y, o.target.x - o.x), dead: false,
    });
  }

  spawnBomb(o) {
    const dist = Math.hypot(o.x1 - o.x0, o.y1 - o.y0);
    this.projs.push({ kind: 'bomb', ...o, x: o.x0, y: o.y0, t: 0, dur: 0.5 + (dist / TILE) * 0.06, arc: 10 + dist * 0.18, h: 0, dead: false });
  }

  updateProjectiles(dt) {
    for (const p of this.projs) {
      if (p.kind === 'bullet') {
        if (p.target && p.target.alive) {
          p.tx = p.target.x;
          p.ty = p.target.y;
        } else {
          p.target = null;
        }
        const dx = p.tx - p.x, dy = p.ty - p.y;
        const d = Math.hypot(dx, dy);
        const step = p.speed * dt;
        p.ang = Math.atan2(dy, dx);
        if (d <= step + 2) {
          p.dead = true;
          if (p.target) {
            p.target.damage(p.dmg, { src: p.tower });
            this.fx.sprite('fx_spark_g', p.tx, p.ty, 24);
          } else {
            this.fx.burst(p.tx, p.ty, 3, ['#00ff41'], 15, 0.2);
          }
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
        }
        p.life -= dt;
        if (p.life <= 0) p.dead = true;
      } else {
        p.t += dt / p.dur;
        if (p.t >= 1) {
          p.dead = true;
          this.explode(p.x1, p.y1, p.dmg, p.splash, p.burn, p.tower);
        } else {
          p.x = p.x0 + (p.x1 - p.x0) * p.t;
          p.y = p.y0 + (p.y1 - p.y0) * p.t;
          p.h = Math.sin(Math.PI * p.t) * p.arc;
        }
      }
    }
    compact(this.projs, (p) => !p.dead);
  }

  explode(x, y, dmg, R, burn, tower) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.sqrt(dist2(x, y, e.x, e.y));
      if (d <= R + 2) e.damage(dmg * (1 - 0.5 * Math.min(1, d / R)), { src: tower });
    }
    this.fx.sprite('fx_explode', x, y, 18, { scale: R / 12 + 0.2 });
    this.fx.sprite('glow_o', x, y, 10, { add: true, scale: R / 6 });
    this.fx.burst(x, y, 12, ['#ff8a1f', '#ffe600', '#ff3355'], 60, 0.4);
    this.fx.burst(x, y, 6, ['#5e7480', '#3a4a52'], 30, 0.6, 1, { add: false, grav: 40 });
    this.fx.addShake(1.2);
    this.sfx('explode');
    if (burn) {
      this.zones.push({ x, y, r: R * 0.85, dps: burn.dps * (tower ? tower.dmgMul : 1), t: burn.dur, max: burn.dur, tower, anim: Math.random() });
    }
  }

  updateZones(dt) {
    for (const z of this.zones) {
      z.t -= dt;
      z.anim += dt;
      for (const e of this.enemies) {
        if (e.alive && dist2(e.x, e.y, z.x, z.y) <= z.r * z.r) e.damage(z.dps * dt, { src: z.tower });
      }
      if (Math.random() < dt * 15) {
        this.fx.particle(z.x + (Math.random() - 0.5) * z.r * 1.5, z.y + (Math.random() - 0.5) * z.r * 1.5, 0,
          -15 - Math.random() * 15, 0.4, Math.random() < 0.5 ? '#ff2bd6' : '#ff8a1f', 1);
      }
    }
    compact(this.zones, (z) => z.t > 0);
  }

  // ------------------------------------------------- malware abilities
  enemyBlink(e) {
    if (e.d > e.route.len - TILE * 1.4) return;
    const ox = e.x, oy = e.y;
    e.d = Math.min(e.route.len - TILE * 0.8, e.d + e.def.blink.dist * TILE);
    e.updatePos(false);
    this.fx.burst(ox, oy, 8, e.def.colors, 30, 0.3);
    this.fx.burst(e.x, e.y, 8, e.def.colors, 30, 0.3);
    this.fx.line([{ x: ox, y: oy }, { x: e.x, y: e.y }], '#ff2bd6', 0.15, 0.6, true);
    this.sfx('blink');
  }

  enemyAura(e) {
    const a = e.def.aura;
    const R = a.radius * TILE;
    const R2 = R * R;
    for (const o of this.enemies) {
      if (!o.alive || dist2(o.x, o.y, e.x, e.y) > R2) continue;
      if (a.heal && o.hp < o.maxHp) {
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * a.heal * (o === e ? 0.5 : 1));
        this.fx.sprite('fx_heal', o.x, o.y - 6, 1, { vy: -14, life: 0.6 });
      }
      if (a.shield && o !== e && !o.def.boss) {
        const cap = o.maxHp * a.shield;
        if (o.shield < cap) {
          o.maxShield = Math.max(o.maxShield, cap);
          o.shield = Math.min(cap, o.shield + cap);
        }
      }
    }
    this.fx.ring(e.x, e.y, 2, R, 0.5, a.heal ? '#7dffb0' : '#7aa8ff', 1);
    this.sfx(a.heal ? 'heal' : 'shield');
  }

  enemySummon(e) {
    const s = e.def.summon;
    for (let i = 0; i < s.count; i++) {
      this.spawnEnemy(s.type, e.routeIdx, e.waveN, { d: Math.max(1, e.d - 6 - i * 6), track: e.track, silent: true });
    }
    this.fx.ring(e.x, e.y, 3, 20, 0.5, '#ff3355', 1.5);
    this.fx.burst(e.x, e.y, 10, e.def.colors, 40, 0.4);
  }

  checkPhase(e) {
    const ph = e.def.phases;
    while (e.phase < ph.length && e.hp / e.maxHp <= ph[e.phase]) {
      e.phase++;
      this.kernelPanic(e);
    }
  }

  kernelPanic(e) {
    const R = 3 * TILE;
    let n = 0;
    for (const t of this.towers) {
      if (dist2(t.x, t.y, e.x, e.y) > R * R) continue;
      t.disabledT = 3.5;
      n++;
      this.fx.bolt(e.x, e.y, t.x, t.y, '#ff3355', 0.35, 4, 1);
    }
    for (let i = 0; i < 3; i++) {
      this.spawnEnemy('phantom', e.routeIdx, e.waveN, { d: Math.max(1, e.d - 8 - i * 8), track: e.track, silent: true });
    }
    this.fx.ring(e.x, e.y, 4, R, 0.6, '#ff3355', 3);
    this.fx.doFlash('#ff0030', 0.4, 0.35);
    this.fx.addShake(5);
    this.sfx('disable');
    this.vibrate([80, 40, 80]);
    this.emit('banner', { text: 'KERNEL PANIC', sub: n ? `${n} DEFENSE${n > 1 ? 'S' : ''} DISABLED` : 'PANIC BURST', kind: 'bad' });
  }

  // ---------------------------------------------------------- targeting
  findTarget(x, y, R, mode) {
    let best = null, bv = Infinity;
    const R2 = R * R;
    for (const e of this.enemies) {
      if (!e.targetable) continue;
      const d2 = dist2(x, y, e.x, e.y);
      if (d2 > R2) continue;
      let v;
      switch (mode) {
        case 'last': v = -e.remaining; break;
        case 'strong': v = -(e.hp + e.shield); break;
        case 'close': v = d2; break;
        default: v = e.remaining;
      }
      if (v < bv) {
        bv = v;
        best = e;
      }
    }
    return best;
  }

  nearestEnemy(x, y, R, exclude) {
    let best = null, bd = R * R;
    for (const e of this.enemies) {
      if (!e.targetable || exclude.has(e)) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d <= bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  enemiesInRange(x, y, R, targetableOnly) {
    const out = [];
    const R2 = R * R;
    for (const e of this.enemies) {
      if (!e.alive || (targetableOnly && !e.targetable)) continue;
      if (dist2(x, y, e.x, e.y) <= R2) out.push(e);
    }
    return out;
  }

  predict(e, t) {
    const mul = e.stunT > 0 ? 0 : e.slowT > 0 ? 1 - e.slowAmt : 1;
    const p = this.map.posAt(e.route, Math.min(e.route.len, e.d + e.baseSpeed * mul * t));
    return { x: p.x + e.ox, y: p.y + e.oy };
  }

  showDamage(e, amt, crit) {
    if (!this.settings.dmgNums) return;
    const v = Math.round(amt);
    if (v < 1) return;
    this.fx.text(e.x + (Math.random() - 0.5) * 6, e.y - e.size * 0.4, crit ? `${v}!` : String(v),
      crit ? '#ffe600' : v >= 100 ? '#ffffff' : '#c8ffd8', { size: crit ? 10 : v >= 100 ? 8 : 6, life: 0.7, vy: -18 });
  }

  updateBuffs() {
    const oc = this.abilities.overclock.active > 0 ? 0.6 : 0;
    const hubs = [];
    for (const t of this.towers) if (t.type === 'hub' && t.disabledT <= 0) hubs.push(t);
    for (const t of this.towers) {
      let rb = 0, db = 0;
      if (t.type !== 'hub' && t.type !== 'miner') {
        for (const h of hubs) {
          const R = h.range;
          if (dist2(h.x, h.y, t.x, t.y) <= R * R) {
            rb = Math.max(rb, h.s.buffRate || 0);
            db = Math.max(db, h.s.buffDmg || 0);
          }
        }
      }
      t.hubBoost = rb > 0;
      t.rateMul = 1 + rb + oc;
      t.dmgMul = 1 + db;
    }
    const det = this.detectors;
    det.length = 0;
    for (const t of this.towers) if (t.s.detect && t.disabledT <= 0) det.push(t);
    for (const e of this.enemies) {
      if (!e.def.stealth) continue;
      let rev = false;
      for (const t of det) {
        const R = t.range;
        if (dist2(t.x, t.y, e.x, e.y) <= R * R) {
          rev = true;
          break;
        }
      }
      e.revealed = rev;
    }
  }

  // -------------------------------------------------------------- loop
  frame(dt) {
    this.rt += dt;
    this.rain.update(dt);
    if (this.paused) return;
    this.acc += dt * this.speed;
    let steps = 0;
    while (this.acc >= STEP && steps < 10) {
      this.update(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 10) this.acc = 0;
  }

  update(dt) {
    this.time += dt;
    if (!this.over) this.stats.time += dt;
    for (const sp of this.spawners) sp.update(dt, this);
    for (let i = this.spawners.length - 1; i >= 0; i--) {
      const sp = this.spawners[i];
      if (!sp.done) continue;
      const tr = this.tracks.get(sp.n);
      if (tr) tr.spawning = false;
      this.spawners.splice(i, 1);
    }
    const ab = this.abilities;
    for (const k in ab) ab[k].t = Math.max(0, ab[k].t - dt);
    ab.overclock.active = Math.max(0, ab.overclock.active - dt);

    this.updateBuffs();
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.alive) e.update(dt);
    }
    for (const t of this.towers) t.update(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updateStrikes(dt);
    this.fx.update(dt);
    compact(this.enemies, (e) => e.alive);
    if (this.coreHitT > 0) this.coreHitT = Math.max(0, this.coreHitT - dt * 2);

    if (!this.over) {
      for (const [n, tr] of this.tracks) {
        if (!tr.spawning && tr.alive <= 0) {
          this.tracks.delete(n);
          this.onWaveCleared(n);
        }
      }
    }
    if (this.settings.autoWave && !this.over && this.waveNum > 0 && this.canCallWave && this.enemies.length === 0) {
      this.autoT += dt;
      if (this.autoT >= 3) {
        this.autoT = 0;
        this.callNextWave();
      }
    } else {
      this.autoT = 0;
    }
  }

  // ------------------------------------------------------------ persist
  snapshot() {
    return {
      mapId: this.def.id, diff: this.diff, endless: this.endless, waveNum: this.waveNum, lives: this.lives,
      bits: this.bits, stats: { ...this.stats },
      towers: this.towers.map((t) => ({
        type: t.type, level: t.level, c: t.c, r: t.r, targeting: t.targeting, kills: t.kills,
        invested: t.invested, dmgDone: Math.round(t.dmgDone),
      })),
    };
  }

  restore(s) {
    this.waveNum = s.waveNum;
    this.lives = s.lives;
    this.bits = s.bits;
    Object.assign(this.stats, s.stats || {});
    for (const d of s.towers) {
      if (!TOWERS[d.type] || !this.canBuild(d.c, d.r)) continue;
      const t = new Tower(this, d.type, d.c, d.r);
      t.level = Math.min(d.level, t.maxLevel);
      t.targeting = d.targeting || t.targeting;
      t.kills = d.kills || 0;
      t.invested = d.invested || t.def.cost;
      t.dmgDone = d.dmgDone || 0;
      t.refresh();
      t.buildT = 1;
      this.towers.push(t);
      this.grid[d.r][d.c] = t;
    }
  }

  // ------------------------------------------------------------- render
  resize(cw, ch) {
    const m = this.map;
    const fit = Math.min(cw / m.w, ch / m.h);
    let S = Math.floor(fit);
    if (S < 1 || S / fit < 0.92) S = fit;
    this.view = { S, ox: Math.round((cw - m.w * S) / 2), oy: Math.round((ch - m.h * S) / 2), cw, ch };
  }

  screenToWorld(px, py) {
    const v = this.view;
    return { x: (px - v.ox) / v.S, y: (py - v.oy) / v.S };
  }

  render(ctx) {
    const v = this.view;
    const A = this.atlas;
    const m = this.map;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#010402';
    ctx.fillRect(0, 0, v.cw, v.ch);

    let sx = 0, sy = 0;
    if (this.fx.shake > 0) {
      sx = (Math.random() * 2 - 1) * this.fx.shake;
      sy = (Math.random() * 2 - 1) * this.fx.shake;
    }
    const bx = v.ox + Math.round(sx * v.S * 0.5), by = v.oy + Math.round(sy * v.S * 0.5);
    ctx.setTransform(v.S, 0, 0, v.S, bx, by);
    A.base = [v.S, bx, by];

    ctx.drawImage(this.mapCanvas, 0, 0);
    const rc = this.rainCv.getContext('2d');
    rc.clearRect(0, 0, m.w, m.h);
    this.rain.draw(rc, A, 1, (x, y) => m.isGroundAt(x, y));
    ctx.globalAlpha = 0.22;
    ctx.drawImage(this.rainCv, 0, 0);
    ctx.globalAlpha = 1;
    this.drawPackets(ctx);
    for (const d of m.decor) A.draw(ctx, A.frame('decor_' + d.kind, this.rt + d.phase, 2), d.c * TILE + 8, d.r * TILE + 8);
    this.drawPortals(ctx);
    if (this.ui.armed) this.drawBuildGrid(ctx);
    this.drawZones(ctx);

    const sel = this.ui.selected;
    if (sel && sel.range > 0) this.drawRange(ctx, sel.x, sel.y, sel.range, sel.def.color);
    this.drawTowerGlows(ctx, false);
    for (const t of this.towers) A.draw(ctx, `base_${t.type}_${t.level + 1}`, t.x, t.y, 0, this.buildScale(t));

    const sorted = this.enemies.slice().sort((a, b) => a.y - b.y);
    this.drawEnemies(ctx, sorted);
    for (const t of this.towers) this.drawTowerHead(ctx, t);
    this.drawTowerGlows(ctx, true);
    this.drawBeams(ctx);
    this.drawProjectiles(ctx);
    this.fx.draw(ctx);
    this.drawStrikes(ctx);
    this.drawGhost(ctx);
    this.drawHpBars(ctx, sorted);
    if (sel) this.drawSelection(ctx, sel);
    this.fx.drawTexts(ctx);
    A.base = null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.fx.flash) {
      const f = this.fx.flash;
      ctx.globalAlpha = f.alpha * (1 - f.t / f.life);
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, v.cw, v.ch);
      ctx.globalAlpha = 1;
    }
    if (!this.over && this.lives / this.maxLives <= 0.3) {
      const pulse = 0.5 + 0.5 * Math.sin(this.rt * 5);
      const g = ctx.createRadialGradient(v.cw / 2, v.ch / 2, Math.min(v.cw, v.ch) * 0.35, v.cw / 2, v.ch / 2, Math.max(v.cw, v.ch) * 0.7);
      g.addColorStop(0, 'rgba(255,0,48,0)');
      g.addColorStop(1, `rgba(255,0,48,${0.16 + 0.12 * pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, v.cw, v.ch);
    }
    if (this.ui.purgeAim) {
      ctx.strokeStyle = `rgba(255,43,214,${0.5 + 0.3 * Math.sin(this.rt * 8)})`;
      ctx.lineWidth = Math.max(4, v.S * 1.2);
      ctx.strokeRect(v.ox, v.oy, m.w * v.S, m.h * v.S);
    }
  }

  drawPackets(ctx) {
    const A = this.atlas;
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.map.routes) {
      const spacing = 44;
      const off = (this.rt * 26) % spacing;
      for (let d = off + 10; d < r.len; d += spacing) {
        const p = this.map.posAt(r, d);
        ctx.globalAlpha = 0.5;
        A.draw(ctx, 'glow_g', p.x, p.y, 0, 0.35);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#b6ffb0';
        ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawPortals(ctx) {
    const A = this.atlas;
    const pulse = Math.sin(this.rt * 4);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.map.spawns) A.draw(ctx, 'glow_m', s.x, s.y, 0, 1.5 + pulse * 0.15, 0.55);
    const c = this.map.core;
    A.draw(ctx, 'glow_c', c.x, c.y, 0, 1.7 + pulse * 0.2, 0.6);
    if (this.coreHitT > 0) A.draw(ctx, 'glow_r', c.x, c.y, 0, 2.2, this.coreHitT);
    ctx.globalCompositeOperation = 'source-over';
    for (const s of this.map.spawns) A.draw(ctx, A.frame('spawn', this.rt, 10), s.x, s.y);
    A.draw(ctx, A.frame('core', this.rt, 5), c.x, c.y);
    const frac = this.lives / this.maxLives;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10.5, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = frac > 0.5 ? '#00f0ff' : frac > 0.3 ? '#ffe600' : '#ff3355';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10.5, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
    ctx.stroke();
  }

  drawBuildGrid(ctx) {
    const a = 0.16 + 0.08 * Math.sin(this.rt * 5);
    const def = TOWERS[this.ui.armed];
    const ok = this.bits >= def.cost;
    for (let r = 0; r < this.map.rows; r++) {
      for (let c = 0; c < this.map.cols; c++) {
        if (this.canBuild(c, r)) this.atlas.draw(ctx, ok ? 'build_ok' : 'build_bad', c * TILE + 8, r * TILE + 8, 0, 0.8, a);
      }
    }
  }

  drawZones(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const z of this.zones) {
      const a = Math.min(1, z.t / 0.4);
      this.atlas.draw(ctx, this.atlas.frame('fx_burn', z.anim, 10), z.x, z.y, 0, z.r / 7, a);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawRange(ctx, x, y, R, color) {
    ctx.fillStyle = hexA(color, 0.08);
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.fill();
    ctx.setLineDash([2, 2]);
    ctx.lineDashOffset = -this.rt * 6;
    ctx.strokeStyle = hexA(color, 0.8);
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  buildScale(t) {
    return t.buildT < 1 ? 0.4 + 0.6 * easeOutBack(t.buildT) : 1;
  }

  drawTowerGlows(ctx, over) {
    const A = this.atlas;
    const oc = this.abilities.overclock.active > 0;
    ctx.globalCompositeOperation = 'lighter';
    for (const t of this.towers) {
      if (!over) {
        if (oc || t.hubBoost) A.draw(ctx, 'glow_y', t.x, t.y, 0, 1.3, oc ? 0.5 + 0.2 * Math.sin(this.rt * 10) : 0.22);
      } else if (t.type === 'arc' || t.type === 'ice') {
        A.draw(ctx, t.type === 'arc' ? 'glow_m' : 'glow_i', t.x, t.y, 0, 0.6 + t.pulseT * 0.5, 0.35 + t.pulseT * 0.5);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawTowerHead(ctx, t) {
    const A = this.atlas;
    const name = `head_${t.type}_${t.level + 1}`;
    const fr = A.frame(name, t.animT, t.type === 'miner' ? 8 : 6);
    const rot = t.def.rotates ? t.angle : t.type === 'hub' ? t.animT * 1.6 : 0;
    const rec = t.def.rotates ? t.recoil : 0;
    const hx = t.x - Math.cos(rot) * rec, hy = t.y - Math.sin(rot) * rec;
    const sc = this.buildScale(t) * (1 + t.pulseT * 0.12);
    if (t.disabledT > 0) ctx.globalAlpha = 0.4 + Math.random() * 0.25;
    A.draw(ctx, fr, hx, hy, rot, sc);
    ctx.globalAlpha = 1;
    if (t.disabledT > 0) {
      ctx.strokeStyle = '#ff3355';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(t.x - 4, t.y - 4);
      ctx.lineTo(t.x + 4, t.y + 4);
      ctx.moveTo(t.x + 4, t.y - 4);
      ctx.lineTo(t.x - 4, t.y + 4);
      ctx.stroke();
    }
  }

  drawEnemies(ctx, list) {
    const A = this.atlas;
    const rt = this.rt;
    for (const e of list) {
      const def = e.def;
      e._a = def.stealth && !e.revealed ? 0.2 + 0.1 * Math.sin(rt * 12 + e.id) : 1;
      e._x = e.type === 'glitch' && Math.random() < 0.12 ? e.x + (Math.random() - 0.5) * 4 : e.x;
      e._y = def.rotate ? e.y : e.y + Math.sin(e.animT * 6 + e.id) * 0.6;
      e._r = def.rotate ? e.ang : 0;
      e._f = A.frame(e.type, e.animT, def.fps || 8);
    }
    // shadows (single batched path)
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const e of list) {
      if (e._a < 1) continue;
      const s = e.size;
      ctx.moveTo(e.x + s * 0.32, e.y + s * 0.3);
      ctx.ellipse(e.x, e.y + s * 0.3, s * 0.32, s * 0.13, 0, 0, TAU);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    // chill halo (additive, under the sprite)
    ctx.globalCompositeOperation = 'lighter';
    for (const e of list) if (e.slowT > 0) A.draw(ctx, 'glow_i', e._x, e._y, 0, e.size / 16, 0.55 * e._a);
    ctx.globalCompositeOperation = 'source-over';
    // sprites
    for (const e of list) A.draw(ctx, e._f, e._x, e._y, e._r, 1, e._a);
    // hit flash
    ctx.globalCompositeOperation = 'lighter';
    for (const e of list) if (e.flash > 0) A.draw(ctx, e._f, e._x, e._y, e._r, 1, Math.min(1, e.flash) * 0.9 * e._a);
    ctx.globalCompositeOperation = 'source-over';
    // status
    for (const e of list) {
      if (e.shield > 0) A.draw(ctx, 'fx_shield', e._x, e._y, 0, (e.size / 16) * 1.1, 0.45 + 0.5 * Math.min(1, e.shield / (e.maxShield || 1)));
      if (e.stunT > 0) A.draw(ctx, A.frame('fx_stun', rt, 12), e._x, e._y - e.size * 0.55);
    }
  }

  drawHpBars(ctx, list) {
    const bars = [];
    for (const e of list) {
      if (!(e.hp < e.maxHp || e.shield > 0)) continue;
      if (e.def.stealth && !e.revealed) continue;
      const w = e.def.boss ? 22 : 12;
      bars.push({ e, w, x: e.x - w / 2, y: e.y - e.size * 0.5 - 3, f: Math.max(0, e.hp / e.maxHp) });
    }
    if (!bars.length) return;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    for (const b of bars) ctx.fillRect(b.x - 0.5, b.y - 0.5, b.w + 1, 2.5);
    for (const [col, lo, hi] of [['#00ff41', 0.5, 2], ['#ffe600', 0.25, 0.5], ['#ff3355', -1, 0.25]]) {
      ctx.fillStyle = col;
      for (const b of bars) if (b.f > lo && b.f <= hi) ctx.fillRect(b.x, b.y, b.w * b.f, 1.5);
    }
    ctx.fillStyle = '#7aa8ff';
    for (const b of bars) if (b.e.shield > 0) ctx.fillRect(b.x, b.y - 1.3, b.w * Math.min(1, b.e.shield / b.e.maxHp), 1);
    ctx.fillStyle = '#93aab5';
    for (const b of bars) if (b.e.armor > 0) ctx.fillRect(b.x - 2, b.y - 0.5, 1.5, 2.5);
  }

  drawBeams(ctx) {
    const A = this.atlas;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const t of this.towers) {
      if (t.type !== 'beam' || !t.firing || !t.target) continue;
      const k = Math.min(1, t.lockT / t.s.rampTime);
      const m = t.muzzle(8);
      const e = t.target;
      const fl = 0.85 + Math.random() * 0.3;
      const seg = (w, c) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
      };
      seg((2.2 + k * 2.4) * fl, 'rgba(0,240,255,0.22)');
      seg((0.9 + k * 0.9) * fl, 'rgba(0,240,255,0.85)');
      seg(0.4 + k * 0.35, '#e8ffff');
      A.draw(ctx, 'glow_c', e.x, e.y, 0, 0.5 + k * 0.5 * fl);
      A.draw(ctx, 'glow_c', m.x, m.y, 0, 0.35 + k * 0.25);
    }
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  drawProjectiles(ctx) {
    const A = this.atlas;
    for (const p of this.projs) {
      if (p.kind === 'bullet') {
        ctx.globalCompositeOperation = 'lighter';
        A.draw(ctx, 'glow_g', p.x, p.y, 0, 0.45, 0.8);
        ctx.globalCompositeOperation = 'source-over';
        A.draw(ctx, p.sprite, p.x, p.y, p.ang);
      } else {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 2, 2.5, 1.2, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        A.draw(ctx, p.sprite, p.x, p.y - p.h, p.t * 9, 1 + p.h / 45);
        ctx.globalCompositeOperation = 'lighter';
        A.draw(ctx, 'glow_o', p.x, p.y - p.h, 0, 0.4, 0.6);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  drawStrikes(ctx) {
    for (const s of this.strikes) {
      const k = 1 - s.t / s.max;
      const R = 1.4 * TILE * (1.6 - 0.6 * k);
      ctx.fillStyle = `rgba(255,43,214,${0.18 * k})`;
      ctx.fillRect(s.x - 2 - k * 2, -40, 4 + k * 4, s.y + 40);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(this.rt * 3);
      ctx.strokeStyle = `rgba(255,51,85,${0.5 + 0.5 * k})`;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.moveTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4));
        ctx.lineTo(Math.cos(a) * (R + 3), Math.sin(a) * (R + 3));
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  drawGhost(ctx) {
    const g = this.ui.ghost;
    const type = this.ui.armed;
    if (!g || !type) return;
    const A = this.atlas;
    const def = TOWERS[type];
    const x = g.c * TILE + 8, y = g.r * TILE + 8;
    const ok = this.canBuild(g.c, g.r) && this.bits >= def.cost;
    const st = towerStats(type, 0);
    if (st.range) this.drawRange(ctx, x, y, st.range * TILE, ok ? def.color : '#ff3355');
    ctx.globalAlpha = 0.7;
    A.draw(ctx, `base_${type}_1`, x, y);
    A.draw(ctx, A.frameAt(`head_${type}_1`, 0), x, y, def.rotates ? -Math.PI / 2 : 0);
    ctx.globalAlpha = 1;
    A.draw(ctx, ok ? 'build_ok' : 'build_bad', x, y, 0, 1 + 0.06 * Math.sin(this.rt * 8));
  }

  drawSelection(ctx, t) {
    this.atlas.draw(ctx, 'build_ok', t.x, t.y, 0, 1.12 + 0.05 * Math.sin(this.rt * 6));
    if (t.type === 'hub') {
      ctx.globalCompositeOperation = 'lighter';
      for (const o of this.towers) if (o !== t && o.hubBoost && dist2(o.x, o.y, t.x, t.y) <= t.range * t.range) {
        this.atlas.draw(ctx, 'glow_y', o.x, o.y, 0, 1, 0.5);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
