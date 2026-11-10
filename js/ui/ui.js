import { TOWERS, TOWER_ORDER, TARGET_MODES, TARGET_LABEL, statList, traitList } from '../data/towers.js';
import { ENEMIES, ENEMY_ORDER } from '../data/enemies.js';
import { MAPS, mapById } from '../data/maps.js';
import { UNLOCK } from '../data/waves.js';
import { Save } from '../engine/save.js';
import { Game, ABILITIES } from '../game/game.js';
import { GameMap } from '../game/map.js';
import { TILE, fmt, fmtTime } from '../engine/util.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const SPEEDS = [1, 2, 3];
const isStandalone = () =>
  matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;

export class UI {
  constructor(app) {
    this.app = app;
    this.atlas = app.atlas;
    this.audio = app.audio;
    this.game = null;
    this.gameOpts = null;
    this.screen = 'boot';
    this.diff = 'normal';
    this.dbTab = 'towers';
    this.root = $('#app');
    this.canvas = $('#game');
    this.ctx = this.canvas.getContext('2d');
    this.depth = 0;
    this.ignorePop = false;
    this.settingsReturn = null;
    this.modalOpts = null;
    this.introQueue = [];
    this.hudCache = {};
    this.drag = null;
    this.pdown = null;
    this.wake = null;
    this.installEvt = null;
    this.dbAnim = null;
    this.sellConfirmT = 0;
    this.tutStep = -1;
    this.fsTried = false;
  }

  // ================================================================ init
  init() {
    for (const el of $$('i[data-ico]')) el.replaceWith(this.icon(el.dataset.ico));

    document.addEventListener('pointerdown', () => this.onFirstGesture(), { capture: true });
    document.addEventListener('click', (e) => {
      if (e.target.closest('button') && !e.target.closest('#dock')) this.audio.play('click');
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    $('#btn-play').onclick = () => this.go('maps');
    $('#btn-db').onclick = () => this.go('db');
    $('#btn-help').onclick = () => this.go('help');
    $('#btn-settings').onclick = () => {
      this.settingsReturn = null;
      this.go('settings');
    };
    $('#btn-continue').onclick = () => this.resumeRun();
    $('#btn-install').onclick = async () => {
      if (!this.installEvt) return;
      this.installEvt.prompt();
      await this.installEvt.userChoice.catch(() => {});
      this.installEvt = null;
      $('#btn-install').hidden = true;
    };
    for (const b of $$('[data-back]')) b.onclick = () => this.back();

    for (const b of $$('#diff-seg button')) {
      b.onclick = () => {
        this.diff = b.dataset.diff;
        this.renderMaps();
      };
    }
    for (const b of $$('#db-seg button')) {
      b.onclick = () => {
        this.dbTab = b.dataset.tab;
        this.renderDB();
      };
    }
    this.bindSettings();

    $('#btn-pause').onclick = () => this.openPause();
    $('#btn-speed').onclick = () => this.cycleSpeed();
    $('#btn-wave').onclick = () => this.callWave();
    for (const b of $$('.ability')) b.onclick = () => this.useAbility(b.dataset.ab);

    this.buildDock();
    this.bindCanvas();

    new ResizeObserver(() => this.resize()).observe($('#stage'));
    window.addEventListener('resize', () => this.resize());

    history.replaceState({ zd: 0 }, '');
    window.addEventListener('popstate', () => this.onPop());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.screen === 'game' && this.game && !this.game.over && !this.modalOpen()) this.openPause();
        this.audio.suspend();
      } else {
        this.audio.resume();
        if (this.screen === 'game') this.requestWake();
      }
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvt = e;
      $('#btn-install').hidden = false;
    });

    document.body.classList.toggle('crt', !!Save.settings.crt);
    this.audio.setVolumes(Save.settings.sfx, Save.settings.music);
  }

  icon(name, cls = 'ico') {
    return this.atlas.canvas(name, 0, cls);
  }

  towerIcon(type, level = 0, cls = 'ico') {
    return this.atlas.canvas([`base_${type}_${level + 1}`, `head_${type}_${level + 1}`], 0, cls);
  }

  paint(cv, names, frame) {
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const n of names) {
      const f = this.atlas.frames[this.atlas.frameAt(n, frame)];
      if (f) ctx.drawImage(this.atlas.img, f[0], f[1], f[2], f[3], (cv.width - f[2]) / 2, (cv.height - f[3]) / 2, f[2], f[3]);
    }
  }

  onFirstGesture() {
    this.audio.unlock();
    if (this.fsTried) return;
    this.fsTried = true;
    if (Save.settings.fullscreen && coarse() && !isStandalone() && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('portrait').catch(() => {}))
        .catch(() => {});
    }
  }

  // ================================================================ boot
  boot() {
    const lines = [
      '> ZERO//DAY firewall v1.0',
      '> mounting sprite atlas ...... OK',
      '> synthesizing audio ......... OK',
      '> calibrating ICE nodes ...... OK',
      '> scanning data bus .......... !!',
      '> MALWARE SIGNATURES DETECTED',
      '> threat level: CRITICAL',
    ];
    const log = $('#boot-log');
    let i = 0;
    const next = () => {
      if (i < lines.length) {
        log.textContent += (i ? '\n' : '') + lines[i++];
        setTimeout(next, 120 + Math.random() * 120);
      } else {
        const tap = $('#boot-tap');
        tap.hidden = false;
        const go = () => {
          this.audio.unlock();
          this.audio.play('boot');
          this.audio.setMusic('menu');
          this.show('menu');
        };
        $('#scr-boot').addEventListener('click', go, { once: true });
      }
    };
    next();
  }

  // ========================================================= navigation
  show(name) {
    this.root.dataset.screen = name;
    this.screen = name;
    if (this.dbAnim && name !== 'db') {
      clearInterval(this.dbAnim);
      this.dbAnim = null;
    }
    if (name === 'menu') this.renderMenu();
    else if (name === 'maps') this.renderMaps();
    else if (name === 'db') this.renderDB();
    else if (name === 'settings') this.renderSettings();
    if (name === 'game') {
      this.resize();
      this.requestWake();
    } else {
      this.releaseWake();
      if (!(name === 'settings' && this.settingsReturn === 'game') && this.audio.music.mode !== 'menu') {
        this.audio.setMusic('menu');
        this.audio.muffle(false);
      }
    }
  }

  go(name) {
    if (name === 'menu') {
      if (this.depth > 0) {
        this.ignorePop = true;
        this.depth = 0;
        history.back();
      }
      this.show('menu');
      return;
    }
    if (this.depth === 0) {
      history.pushState({ zd: 1 }, '');
      this.depth = 1;
    }
    this.show(name);
  }

  back() {
    if (this.screen === 'settings' && this.settingsReturn === 'game') {
      this.settingsReturn = null;
      this.show('game');
      this.openPause();
      return;
    }
    this.go('menu');
  }

  onPop() {
    if (this.ignorePop) {
      this.ignorePop = false;
      return;
    }
    this.depth = 0;
    const repush = () => {
      history.pushState({ zd: 1 }, '');
      this.depth = 1;
    };
    if (this.modalOpen()) {
      const o = this.modalOpts || {};
      if (o.onBack) o.onBack();
      else if (o.dismissable) this.closeModal();
      if (this.screen !== 'menu') repush();
      return;
    }
    if (this.screen === 'game') {
      if (this.game && this.game.ui.armed) this.disarm();
      else if (this.game && this.game.ui.selected) this.deselect();
      else this.openPause();
      repush();
      return;
    }
    if (this.screen === 'settings' && this.settingsReturn === 'game') {
      this.back();
      repush();
      return;
    }
    this.show('menu');
  }

  // ================================================================ menu
  renderMenu() {
    const run = Save.data.run;
    const btn = $('#btn-continue');
    const def = run && mapById(run.mapId);
    btn.hidden = !def;
    if (def) {
      $('#continue-info').textContent = `SECTOR ${def.sector} · WAVE ${run.waveNum + 1}${run.endless ? ' · ENDLESS' : ''}${run.diff === 'hard' ? ' · HARD' : ''}`;
    }
    const t = Save.data.totals;
    const stars = MAPS.reduce((a, m) => a + Save.map(m.id).stars + Save.map(m.id).hardStars, 0);
    $('#menu-stats').textContent = `★ ${stars}/${MAPS.length * 6} · ${fmt(t.kills)} PURGED`;
  }

  // ================================================================ maps
  renderMaps() {
    for (const b of $$('#diff-seg button')) b.classList.toggle('on', b.dataset.diff === this.diff);
    $('#diff-note').textContent = this.diff === 'hard'
      ? 'HARD: +35% malware integrity · 10 core integrity · -15% starting bits'
      : 'NORMAL: 20 core integrity · standard malware';
    const list = $('#map-list');
    list.innerHTML = '';
    MAPS.forEach((m, i) => {
      const prog = Save.map(m.id);
      const locked = i > 0 && !Save.map(MAPS[i - 1].id).cleared;
      const gm = new GameMap(m);
      const pv = gm.preview(9);
      pv.className = 'map-pv';
      const stars = (n) => [0, 1, 2].map((k) => this.icon(k < n ? 'ico_star' : 'ico_star_off'));
      const card = h('div', { class: 'map-card' + (locked ? ' locked' : '') },
        pv,
        h('div', { class: 'map-info' },
          h('div', { class: 'map-sector', text: `SECTOR ${m.sector}` }),
          h('div', { class: 'map-name', text: m.name }),
          h('div', { class: 'map-desc', text: m.desc }),
          h('div', { class: 'map-meta', text: `${m.waves} WAVES · ${gm.spawns.length} UPLINK${gm.spawns.length > 1 ? 'S' : ''}` }),
          h('div', { class: 'map-stars' },
            h('span', { class: 'lbl', text: 'N' }), stars(prog.stars),
            h('span', { class: 'lbl', text: 'H' }), stars(prog.hardStars)),
          prog.best ? h('div', { class: 'map-best', text: `ENDLESS BEST: WAVE ${prog.best}` }) : null,
          h('div', { class: 'map-btns' },
            h('button', { class: 'btn btn-primary btn-sm', disabled: locked, onclick: () => this.startGame(m, { diff: this.diff }) }, 'DEPLOY'),
            h('button', { class: 'btn btn-sm', disabled: !prog.cleared, onclick: () => this.startGame(m, { diff: this.diff, endless: true }) }, 'ENDLESS'))),
        locked ? h('div', { class: 'lock-overlay' }, this.icon('ico_lock'), h('span', { text: `CLEAR SECTOR ${MAPS[i - 1].sector} TO UNLOCK` })) : null);
      list.append(card);
    });
  }

  // ============================================================ database
  renderDB() {
    for (const b of $$('#db-seg button')) b.classList.toggle('on', b.dataset.tab === this.dbTab);
    const list = $('#db-list');
    list.innerHTML = '';
    const anim = [];
    if (this.dbTab === 'towers') {
      for (const type of TOWER_ORDER) {
        const def = TOWERS[type];
        const ico = this.towerIcon(type, 2, 'db-ico');
        anim.push({ cv: ico, names: [`base_${type}_3`, `head_${type}_3`] });
        const rows = def.levels.map((lv, i) => h('div', { class: 'db-lv' },
          h('b', { text: `LV${i + 1}` }),
          h('span', { class: 'chip' }, h('b', { text: '◆' }), String(i === 0 ? def.cost : lv.cost)),
          statList(type, i).map(([k, v]) => h('span', { class: 'chip' }, h('b', { text: k }), String(v))),
          traitList(type, i).filter((t) => i === 0 || !traitList(type, i - 1).includes(t)).map((t) => h('span', { class: 'chip trait', text: t }))));
        list.append(h('div', { class: 'db-card' }, ico,
          h('div', { class: 'db-body' },
            h('div', { class: 'db-name', style: `color:${def.color}` }, def.name, h('em', { text: `◆${def.cost}` })),
            h('div', { class: 'db-desc', text: def.desc }),
            rows)));
      }
    } else {
      for (const type of ENEMY_ORDER) {
        const def = ENEMIES[type];
        const seen = !!Save.data.seen[type];
        const ico = this.atlas.canvas(type, 0, 'db-ico');
        if (seen) anim.push({ cv: ico, names: [type] });
        else {
          const c2 = ico.getContext('2d');
          c2.globalCompositeOperation = 'source-in';
          c2.fillStyle = '#145a30';
          c2.fillRect(0, 0, ico.width, ico.height);
        }
        const traits = [];
        if (def.boss) traits.push(['BOSS', 'warn']);
        if (def.armor) traits.push([`ARMOR ${def.armor}`, '']);
        if (def.stealth) traits.push(['CLOAKED', 'trait']);
        if (def.aura?.heal) traits.push(['HEALER', 'trait']);
        if (def.aura?.shield) traits.push(['SHIELDER', 'trait']);
        if (def.blink) traits.push(['TELEPORTS', 'trait']);
        if (def.onDeath) traits.push(['SPLITS', 'trait']);
        if (def.summon) traits.push(['SUMMONER', 'trait']);
        if (def.slowResist) traits.push([`${Math.round(def.slowResist * 100)}% SLOW RESIST`, 'trait']);
        const first = UNLOCK[type] ? `FIRST SEEN: WAVE ${UNLOCK[type]}` : 'BOSS WAVES';
        list.append(h('div', { class: 'db-card' + (seen ? '' : ' unknown') }, ico,
          h('div', { class: 'db-body' },
            h('div', { class: 'db-name', style: `color:${seen ? def.colors[0] : '#4f8f66'}` }, seen ? def.name : '??? UNKNOWN', h('em', { text: first })),
            h('div', { class: 'db-desc', text: seen ? def.desc : 'Signature not decrypted. Encounter this malware to unlock its profile.' }),
            seen ? h('div', { class: 'db-lv' },
              h('span', { class: 'chip' }, h('b', { text: 'HP' }), String(def.hp)),
              h('span', { class: 'chip' }, h('b', { text: 'SPD' }), String(def.speed)),
              h('span', { class: 'chip' }, h('b', { text: '◆' }), String(def.reward)),
              h('span', { class: 'chip warn' }, h('b', { text: 'LEAK' }), `-${def.dmg}`)) : null,
            seen && traits.length ? h('div', { class: 'db-lv' }, traits.map(([t, c]) => h('span', { class: 'chip ' + c, text: t }))) : null)));
      }
    }
    if (this.dbAnim) clearInterval(this.dbAnim);
    let f = 0;
    this.dbAnim = setInterval(() => {
      f++;
      for (const a of anim) this.paint(a.cv, a.names, f);
    }, 150);
  }

  // ============================================================ settings
  bindSettings() {
    for (const inp of $$('[data-set]')) {
      const key = inp.dataset.set;
      inp.addEventListener('input', () => {
        const s = Save.settings;
        s[key] = inp.type === 'checkbox' ? inp.checked : parseFloat(inp.value);
        if (key === 'sfx' || key === 'music') this.audio.setVolumes(s.sfx, s.music);
        if (key === 'crt') document.body.classList.toggle('crt', s.crt);
        Save.write();
      });
      if (inp.type === 'range') inp.addEventListener('change', () => this.audio.play('coin'));
    }
    $('#btn-reset').onclick = () => {
      this.confirm('RESET PROGRESS?', 'All stars, unlocks, saved runs and database entries will be erased.', 'ERASE', () => {
        Save.reset();
        this.toast('PROGRESS ERASED', 'bad');
        this.renderSettings();
      });
    };
  }

  renderSettings() {
    for (const inp of $$('[data-set]')) {
      const v = Save.settings[inp.dataset.set];
      if (inp.type === 'checkbox') inp.checked = !!v;
      else inp.value = v;
    }
  }

  // ========================================================= game start
  startGame(mapDef, opts = {}, confirmed = false) {
    if (!confirmed && !opts.resume && Save.data.run) {
      this.confirm('ABANDON SAVED RUN?', 'Starting a new deployment overwrites your saved progress.', 'DEPLOY', () => this.startGame(mapDef, opts, true));
      return;
    }
    if (!opts.resume) Save.data.run = null;
    this.closeModal(true);
    this.gameOpts = { mapDef, diff: opts.diff || 'normal', endless: !!opts.endless };
    this.game = new Game({
      mapDef, diff: this.gameOpts.diff, endless: this.gameOpts.endless, atlas: this.atlas, audio: this.audio,
      settings: Save.settings, resume: opts.resume || null, emit: (ev, d) => this.onGameEvent(ev, d),
    });
    if (this.app.debug) this.app.game = this.game;
    this.hudCache = {};
    this.introQueue = [];
    this.game.speed = 1;
    $('#btn-speed').textContent = '1×';
    $('#btn-speed').classList.remove('fast');
    this.disarm();
    this.deselect();
    $('#bossbar').hidden = true;
    $('#toasts').innerHTML = '';
    $('#banner').innerHTML = '';
    this.go('game');
    this.audio.setMusic('calm');
    this.audio.muffle(false);
    Save.data.totals.games++;
    Save.write();
    const g = this.game;
    this.banner(`SECTOR ${mapDef.sector}`, `${mapDef.name} · ${g.endless ? 'ENDLESS' : g.totalWaves + ' WAVES'}${g.diff === 'hard' ? ' · HARD' : ''}`, '', 2);
    this.tutStep = -1;
    if (!Save.data.tutorial && mapDef.id === 's1' && !opts.resume) {
      this.tutStep = 0;
      setTimeout(() => this.tutorial(0), 1800);
    } else if (opts.resume) {
      setTimeout(() => this.toast(`RUN RESTORED · WAVE ${g.waveNum + 1} READY`, 'info', 2.5), 1500);
    }
  }

  resumeRun() {
    const run = Save.data.run;
    const def = run && mapById(run.mapId);
    if (!def) return;
    this.startGame(def, { diff: run.diff, endless: run.endless, resume: run });
  }

  restart() {
    const o = this.gameOpts;
    Save.data.run = null;
    this.startGame(o.mapDef, { diff: o.diff, endless: o.endless }, true);
  }

  quitToMenu() {
    const g = this.game;
    if (g && !g.over && g.waveNum > 0 && g.idle) Save.data.run = g.snapshot();
    Save.write();
    this.closeModal(true);
    this.game = null;
    this.go('menu');
  }

  // ========================================================= game events
  onGameEvent(ev, d) {
    const g = this.game;
    switch (ev) {
      case 'error':
        this.toast(d, 'bad', 1.2);
        this.audio.play('error');
        g.vibrate(30);
        break;
      case 'toast':
        this.toast(d.text, d.kind);
        break;
      case 'banner':
        this.banner(d.text, d.sub, d.kind, 2);
        break;
      case 'lives':
        this.flashStat('#hud-lives');
        break;
      case 'wave': {
        const names = d.types.filter((t) => !ENEMIES[t].boss).map((t) => ENEMIES[t].name.toUpperCase());
        if (!d.boss) this.banner(`WAVE ${d.n}`, names.slice(0, 3).join(' · '), '', 1.4);
        const fresh = d.types.filter((t) => !Save.data.seen[t]);
        if (fresh.length) {
          this.introQueue.push(...fresh);
          if (!this.modalOpen()) this.nextIntro();
        }
        if (this.tutStep === 1 && d.n === 1) this.tutorial(2);
        break;
      }
      case 'boss':
        this.banner('⚠ WARNING ⚠', `${d.def.name} DETECTED`, 'bad', 2.6);
        break;
      case 'bossDown':
        this.banner('THREAT NEUTRALIZED', `${d.def.name} PURGED  +${d.reward}`, 'gold', 2.2);
        break;
      case 'waveCleared':
        this.toast(`WAVE ${d.n} CLEARED  +${d.bonus}${d.income ? `  ⛏+${d.income}` : ''}`, 'gold', 2);
        if (this.tutStep === 2 && d.n >= 2) this.tutorial(3);
        break;
      case 'idle':
        if (!g.over) {
          Save.data.run = g.snapshot();
          Save.write();
        }
        break;
      case 'gameover':
        Save.data.run = null;
        Save.data.totals.kills += d.kills;
        if (g.endless) {
          const p = Save.map(g.def.id);
          d.newBest = d.wave > p.best;
          p.best = Math.max(p.best, d.wave);
        }
        Save.write();
        this.disarm();
        this.deselect();
        setTimeout(() => this.showGameOver(d), 1400);
        break;
      case 'victory': {
        Save.data.run = null;
        Save.data.totals.kills += d.kills;
        Save.data.totals.wins++;
        const p = Save.map(g.def.id);
        p.cleared = true;
        if (g.diff === 'hard') p.hardStars = Math.max(p.hardStars, d.stars);
        else p.stars = Math.max(p.stars, d.stars);
        Save.write();
        this.disarm();
        this.deselect();
        this.banner('SECTOR SECURED', 'ALL THREATS PURGED', 'gold', 2);
        setTimeout(() => this.showVictory(d), 1800);
        break;
      }
      default:
        break;
    }
  }

  tutorial(step) {
    this.tutStep = step;
    const pulse = $('.card[data-type="pulse"]');
    if (step === 0) {
      pulse?.classList.add('new');
      this.toast('TAP A DEFENSE BELOW, THEN A DARK TILE', 'info', 6);
    } else if (step === 1) {
      pulse?.classList.remove('new');
      this.toast('TAP START TO SEND THE FIRST WAVE', 'info', 5);
    } else if (step === 2) {
      setTimeout(() => this.toast('TAP A TOWER TO UPGRADE, SELL OR RE-TARGET', 'info', 5), 2500);
    } else if (step === 3) {
      this.toast('ABILITIES RECHARGE · USE THEM IN A PINCH', 'info', 5);
      Save.data.tutorial = true;
      Save.write();
      this.tutStep = -1;
    }
  }

  // ================================================================ dock
  buildDock() {
    const dock = $('#dock');
    dock.innerHTML = '';
    for (const type of TOWER_ORDER) {
      const def = TOWERS[type];
      const card = h('button', { class: 'card', 'data-type': type },
        this.towerIcon(type, 0),
        h('div', { class: 'card-txt' }, h('span', { class: 'card-name', text: def.short }), h('span', { class: 'cost', text: `◆${def.cost}` })),
        h('i', { class: 'hot' }));
      card.addEventListener('pointerdown', (e) => this.dockDown(e, type, card));
      card.addEventListener('pointermove', (e) => this.dockMove(e));
      card.addEventListener('pointerup', (e) => this.dockUp(e));
      card.addEventListener('pointercancel', () => {
        if (this.drag && this.game) this.game.ui.ghost = null;
        this.drag = null;
      });
      dock.append(card);
    }
  }

  dockDown(e, type, card) {
    if (!this.game || this.game.over) return;
    e.preventDefault();
    try {
      card.setPointerCapture(e.pointerId);
    } catch (err) { /* ignore */ }
    this.drag = { type, sx: e.clientX, sy: e.clientY, active: false, mouse: e.pointerType === 'mouse' };
  }

  dockMove(e) {
    const d = this.drag;
    if (!d || !this.game) return;
    if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 14) {
      d.active = true;
      this.arm(d.type);
    }
    if (d.active) {
      const t = this.clientToTile(e.clientX, e.clientY - (d.mouse ? 0 : 40));
      this.game.ui.ghost = t.inside ? { c: t.c, r: t.r } : null;
    }
  }

  dockUp() {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.game) return;
    const g = this.game;
    if (d.active) {
      const gh = g.ui.ghost;
      if (gh && g.canBuild(gh.c, gh.r) && g.bits >= TOWERS[d.type].cost) this.tryBuild(gh.c, gh.r);
      else if (gh) {
        g.ui.ghost = null;
        this.onGameEvent('error', g.canBuild(gh.c, gh.r) ? 'INSUFFICIENT BITS' : 'CANNOT DEPLOY HERE');
      }
    } else if (g.ui.armed === d.type) {
      this.disarm();
    } else {
      this.arm(d.type);
      this.audio.play('select');
    }
  }

  arm(type) {
    const g = this.game;
    if (!g) return;
    this.deselect();
    this.cancelPurge();
    g.ui.armed = type;
    g.ui.ghost = null;
    for (const c of $$('.card')) c.classList.toggle('armed', c.dataset.type === type);
    const def = TOWERS[type];
    const info = $('#armed-info');
    info.innerHTML = '';
    const stats = statList(type, 0).map(([k, v]) => `${k} ${v}`).join(' · ');
    info.append(
      this.towerIcon(type, 0),
      h('div', { class: 'armed-text' },
        h('div', { class: 'armed-name' }, def.name.toUpperCase() + ' ', h('em', { text: `◆${def.cost}` })),
        h('div', { class: 'armed-hint', text: stats || def.desc }),
        h('div', { class: 'armed-hint', text: 'TAP A TILE · TAP AGAIN TO DEPLOY' })),
      h('button', { class: 'btn-icon armed-cancel', 'aria-label': 'Cancel', onclick: () => this.disarm() }, this.icon('ico_close')));
    $('#actionbar').classList.add('armed');
  }

  disarm() {
    if (this.game) {
      this.game.ui.armed = null;
      this.game.ui.ghost = null;
    }
    for (const c of $$('.card')) c.classList.remove('armed');
    $('#actionbar').classList.remove('armed');
  }

  tryBuild(c, r) {
    const g = this.game;
    const t = g.build(g.ui.armed, c, r);
    if (t) {
      this.disarm();
      if (this.tutStep === 0) this.tutorial(1);
    }
    return t;
  }

  // ============================================================== canvas
  bindCanvas() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      this.pdown = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointerup', (e) => {
      const p = this.pdown;
      this.pdown = null;
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 16) return;
      this.tapAt(e.clientX, e.clientY);
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.game || !this.game.ui.armed || this.drag) return;
      const t = this.clientToTile(e.clientX, e.clientY);
      this.game.ui.ghost = t.inside ? { c: t.c, r: t.r } : null;
    });
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.game && !this.drag) this.game.ui.ghost = null;
    });
  }

  clientToTile(cx, cy) {
    const g = this.game;
    const rect = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / (rect.width || 1);
    const w = g.screenToWorld((cx - rect.left) * k, (cy - rect.top) * k);
    const c = Math.floor(w.x / TILE), r = Math.floor(w.y / TILE);
    return { c, r, x: w.x, y: w.y, inside: g.inBounds(c, r) };
  }

  tapAt(cx, cy) {
    const g = this.game;
    if (!g || g.over || this.modalOpen()) return;
    const t = this.clientToTile(cx, cy);
    if (g.ui.purgeAim) {
      if (t.inside && g.usePurge(t.x, t.y)) {
        g.ui.purgeAim = false;
        $('.ability[data-ab="purge"]').classList.remove('aiming');
      }
      return;
    }
    if (g.ui.armed) {
      const tw = g.towerAt(t.c, t.r);
      if (tw) {
        this.disarm();
        this.select(tw);
        return;
      }
      if (!t.inside) {
        this.disarm();
        return;
      }
      const gh = g.ui.ghost;
      if (gh && gh.c === t.c && gh.r === t.r) {
        this.tryBuild(t.c, t.r);
      } else {
        g.ui.ghost = { c: t.c, r: t.r };
        if (!g.canBuild(t.c, t.r)) {
          this.audio.play('error');
        } else {
          this.audio.play('click');
        }
      }
      return;
    }
    const tw = g.towerAt(t.c, t.r);
    if (tw && tw !== g.ui.selected) this.select(tw);
    else this.deselect();
  }

  // =============================================================== panel
  select(t) {
    const g = this.game;
    g.ui.selected = t;
    this.sellConfirmT = 0;
    $('#dock').hidden = true;
    $('#panel').hidden = false;
    this.audio.play('select');
    this.renderPanel();
  }

  deselect() {
    if (this.game) this.game.ui.selected = null;
    $('#dock').hidden = false;
    $('#panel').hidden = true;
    this.panelRef = null;
  }

  renderPanel() {
    const g = this.game;
    const t = g.ui.selected;
    const p = $('#panel');
    p.innerHTML = '';
    if (!t) return;
    const cur = statList(t.type, t.level);
    const nxt = t.level < t.maxLevel ? statList(t.type, t.level + 1) : null;
    const chips = cur.map(([k, v], i) => {
      const n = nxt && nxt[i] && nxt[i][0] === k && String(nxt[i][1]) !== String(v) ? nxt[i][1] : null;
      return h('span', { class: 'chip' }, h('b', { text: k }), String(v), n != null ? h('em', { text: `▸${n}` }) : null);
    });
    for (const tr of traitList(t.type, t.level)) chips.push(h('span', { class: 'chip trait', text: tr }));
    if (nxt) {
      const newTraits = traitList(t.type, t.level + 1).filter((x) => !traitList(t.type, t.level).includes(x));
      for (const tr of newTraits) chips.push(h('span', { class: 'chip' }, h('em', { text: `▸${tr}` })));
    }
    const pips = h('span', { class: 'p-lv' }, [0, 1, 2].map((i) => h('i', { class: i <= t.level ? 'on' : '' })));
    const kills = h('span', { text: String(t.kills) });
    const top = h('div', { class: 'p-top' },
      this.towerIcon(t.type, t.level, 'ico p-ico'),
      h('div', { class: 'p-title' },
        h('div', { class: 'p-name' }, t.def.name.toUpperCase(), pips),
        h('div', { class: 'p-stats' }, chips)),
      t.type !== 'miner' && t.type !== 'hub' ? h('div', { class: 'p-kills' }, this.icon('ico_skull'), kills) : null,
      h('button', { class: 'btn-icon p-close', 'aria-label': 'Close', onclick: () => this.deselect() }, this.icon('ico_close')));

    const upCost = t.upgradeCost;
    const up = h('button', { class: 'p-up', disabled: upCost == null, onclick: () => this.upgradeSelected() },
      upCost == null ? 'MAX LEVEL' : 'UPGRADE', upCost == null ? null : h('span', { text: `◆${upCost}` }));
    const btns = h('div', { class: 'p-btns' }, up);
    let tgt = null;
    if (t.def.targets) {
      tgt = h('button', { class: 'p-target', onclick: () => this.cycleTarget() }, 'TARGET', h('span', { text: TARGET_LABEL[t.targeting] }));
      btns.append(tgt);
    }
    const sell = h('button', { class: 'p-sell', onclick: () => this.sellSelected() }, 'SELL', h('span', { text: `+◆${t.sellValue}` }));
    btns.append(sell);
    p.append(top, btns);
    this.panelRef = { t, up, kills, sell, upCost };
    this.syncPanel(true);
  }

  syncPanel(force) {
    const r = this.panelRef;
    const g = this.game;
    if (!r || !g || r.t !== g.ui.selected) return;
    const poor = r.upCost != null && g.bits < r.upCost;
    if (force || r.poor !== poor) {
      r.up.classList.toggle('poor', poor);
      r.poor = poor;
    }
    if (r.k !== r.t.kills) {
      r.kills.textContent = String(r.t.kills);
      r.k = r.t.kills;
    }
    if (this.sellConfirmT > 0) {
      this.sellConfirmT -= 1 / 60;
      if (this.sellConfirmT <= 0) {
        r.sell.classList.remove('confirm');
        r.sell.firstChild.textContent = 'SELL';
      }
    }
  }

  upgradeSelected() {
    const g = this.game;
    const t = g.ui.selected;
    if (t && g.upgrade(t)) this.renderPanel();
  }

  cycleTarget() {
    const t = this.game.ui.selected;
    if (!t) return;
    t.targeting = TARGET_MODES[(TARGET_MODES.indexOf(t.targeting) + 1) % TARGET_MODES.length];
    t.target = null;
    this.renderPanel();
  }

  sellSelected() {
    const g = this.game;
    const t = g.ui.selected;
    if (!t) return;
    if (this.sellConfirmT <= 0) {
      this.sellConfirmT = 2.5;
      const s = this.panelRef.sell;
      s.classList.add('confirm');
      s.firstChild.textContent = 'CONFIRM?';
      return;
    }
    this.sellConfirmT = 0;
    g.sell(t);
    this.deselect();
  }

  // ============================================================ controls
  cycleSpeed() {
    const g = this.game;
    if (!g) return;
    g.speed = SPEEDS[(SPEEDS.indexOf(g.speed) + 1) % SPEEDS.length];
    const b = $('#btn-speed');
    b.textContent = `${g.speed}×`;
    b.classList.toggle('fast', g.speed > 1);
  }

  callWave() {
    const g = this.game;
    if (!g) return;
    if (!g.callNextWave()) this.audio.play('error');
  }

  useAbility(k) {
    const g = this.game;
    if (!g || g.over) return;
    if (!g.abilityReady(k)) {
      this.audio.play('error');
      this.toast(`${ABILITIES[k].name} RECHARGING · ${Math.ceil(g.abilities[k].t)}s`, 'bad', 1);
      return;
    }
    if (k === 'emp') g.useEmp();
    else if (k === 'overclock') g.useOverclock();
    else if (k === 'purge') {
      if (g.ui.purgeAim) {
        this.cancelPurge();
        return;
      }
      this.disarm();
      this.deselect();
      g.ui.purgeAim = true;
      $('.ability[data-ab="purge"]').classList.add('aiming');
      this.toast('PURGE ARMED · TAP A TARGET ZONE', 'info', 2);
    }
  }

  cancelPurge() {
    if (this.game) this.game.ui.purgeAim = false;
    $('.ability[data-ab="purge"]')?.classList.remove('aiming');
  }

  // ================================================================ HUD
  flashStat(sel) {
    const el = $(sel);
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  setText(key, el, val) {
    if (this.hudCache[key] === val) return false;
    this.hudCache[key] = val;
    el.textContent = val;
    return true;
  }

  syncHUD() {
    const g = this.game;
    const c = this.hudCache;
    this.setText('lives', $('#hud-lives span'), String(g.lives));
    const low = g.lives / g.maxLives <= 0.3;
    if (c.low !== low) {
      $('#hud-lives').classList.toggle('low', low);
      c.low = low;
    }
    const bits = fmt(g.bits);
    if (c.bitsRaw !== undefined && g.bits > c.bitsRaw) {
      const el = $('#hud-bits');
      el.classList.remove('gain');
      void el.offsetWidth;
      el.classList.add('gain');
    }
    c.bitsRaw = g.bits;
    this.setText('bits', $('#hud-bits span'), bits);
    this.setText('wave', $('#hud-wave span'), g.endless ? `${g.waveNum}∞` : `${g.waveNum}/${g.totalWaves}`);

    for (const b of $$('.ability')) {
      const k = b.dataset.ab;
      const a = g.abilities[k];
      const frac = a.t / ABILITIES[k].cd;
      const key = 'ab_' + k;
      const sec = a.t > 0 ? String(Math.ceil(a.t)) : '';
      const active = k === 'overclock' && a.active > 0;
      const sig = `${frac.toFixed(3)}|${sec}|${active}`;
      if (c[key] !== sig) {
        c[key] = sig;
        b.style.setProperty('--cd', frac.toFixed(3));
        b.querySelector('.cd').textContent = sec;
        b.classList.toggle('ready', a.t <= 0);
        b.classList.toggle('active', active);
      }
    }

    let main, sub = '', dis = false, cls = '';
    if (g.over) {
      main = '—';
      dis = true;
    } else if (g.waveNum === 0) {
      main = 'START';
      sub = 'WAVE 1';
      cls = 'pulse';
    } else if (g.canCallWave) {
      main = 'NEXT';
      if (g.enemies.length > 0) {
        sub = `+◆${g.earlyBonus}`;
        cls = 'early';
      } else {
        sub = `WAVE ${g.waveNum + 1}`;
        cls = g.settings.autoWave ? '' : 'pulse';
      }
    } else if (!g.endless && g.waveNum >= g.totalWaves) {
      main = 'FINAL';
      sub = 'WAVE';
      dis = true;
    } else {
      main = 'INBOUND';
      sub = `WAVE ${g.waveNum}`;
      dis = true;
    }
    const wsig = `${main}|${sub}|${dis}|${cls}`;
    if (c.wave_btn !== wsig) {
      c.wave_btn = wsig;
      const b = $('#btn-wave');
      b.querySelector('.w-main').textContent = main;
      b.querySelector('.w-sub').textContent = sub;
      b.disabled = dis;
      b.classList.toggle('pulse', cls === 'pulse');
      b.classList.toggle('early', cls === 'early');
    }

    const bsig = Math.floor(g.bits);
    if (c.dock !== bsig) {
      c.dock = bsig;
      for (const card of $$('.card')) card.classList.toggle('poor', g.bits < TOWERS[card.dataset.type].cost);
    }

    const boss = g.boss;
    const bb = $('#bossbar');
    if (boss) {
      if (bb.hidden) {
        bb.hidden = false;
        bb.querySelector('.bb-name').textContent = boss.def.name;
      }
      const w = `${Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(1)}%`;
      if (c.bossW !== w) {
        c.bossW = w;
        bb.querySelector('.bb-fill').style.width = w;
      }
    } else if (!bb.hidden) {
      bb.hidden = true;
      c.bossW = null;
    }

    if (g.ui.selected) this.syncPanel(false);
  }

  // ================================================================ loop
  frame(dt) {
    const g = this.game;
    if (!g || this.screen !== 'game') return;
    g.frame(dt);
    g.render(this.ctx);
    this.syncHUD();
  }

  resize() {
    const stage = $('#stage');
    const rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(rect.width * dpr), hgt = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w;
      this.canvas.height = hgt;
    }
    if (this.game) this.game.resize(w, hgt);
  }

  // ============================================================= modals
  modal(build, opts = {}) {
    const wrap = $('#modal');
    const box = $('#modal-box');
    box.innerHTML = '';
    box.className = 'modal-box ' + (opts.cls || '');
    build(box);
    wrap.hidden = false;
    this.modalOpts = opts;
    if (this.game) this.game.paused = true;
    this.audio.muffle(!!opts.muffle);
  }

  closeModal(silent = false) {
    const wrap = $('#modal');
    if (wrap.hidden) return;
    wrap.hidden = true;
    this.modalOpts = null;
    this.audio.muffle(false);
    if (this.game && !this.game.over) this.game.paused = false;
    if (!silent && this.introQueue.length) this.nextIntro();
  }

  modalOpen() {
    return !$('#modal').hidden;
  }

  confirm(title, text, okLabel, onOk) {
    this.modal((box) => {
      box.append(
        h('h2', { class: 'bad', text: title }),
        h('p', { text }),
        h('div', { class: 'm-btns' },
          h('div', { class: 'm-row' },
            h('button', { class: 'btn', onclick: () => this.closeModal() }, 'CANCEL'),
            h('button', { class: 'btn btn-danger', onclick: () => { this.closeModal(true); onOk(); } }, okLabel))));
    }, { dismissable: true });
  }

  openPause() {
    const g = this.game;
    if (!g || g.over || this.modalOpen()) return;
    this.cancelPurge();
    this.modal((box) => {
      box.append(
        h('h2', { text: 'PAUSED' }),
        h('p', { class: 'modal-sub', text: `SECTOR ${g.def.sector} · ${g.def.name}` }),
        h('div', { class: 'm-stats' },
          h('div', {}, h('b', { text: 'WAVE' }), g.endless ? `${g.waveNum}` : `${g.waveNum}/${g.totalWaves}`),
          h('div', {}, h('b', { text: 'MODE' }), `${g.diff.toUpperCase()}${g.endless ? '∞' : ''}`),
          h('div', {}, h('b', { text: 'PURGED' }), String(g.stats.kills)),
          h('div', {}, h('b', { text: 'TIME' }), fmtTime(g.stats.time))),
        h('div', { class: 'm-btns' },
          h('button', { class: 'btn btn-primary', onclick: () => this.closeModal() }, 'RESUME'),
          h('div', { class: 'm-row' },
            h('button', { class: 'btn btn-sm', onclick: () => {
              this.confirm('RESTART SECTOR?', 'Current progress in this run will be lost.', 'RESTART', () => this.restart());
            } }, 'RESTART'),
            h('button', { class: 'btn btn-sm', onclick: () => {
              this.closeModal(true);
              this.game.paused = true;
              this.settingsReturn = 'game';
              this.show('settings');
            } }, 'SETTINGS')),
          h('button', { class: 'btn btn-danger btn-sm', onclick: () => this.quitToMenu() }, 'QUIT TO MENU')),
        h('p', { class: 'modal-sub', text: 'Progress auto-saves between waves.' }));
    }, { muffle: true, onBack: () => this.closeModal() });
  }

  nextIntro() {
    if (!this.introQueue.length || this.modalOpen() || !this.game || this.game.over) return;
    const type = this.introQueue.shift();
    if (Save.data.seen[type]) {
      this.nextIntro();
      return;
    }
    const def = ENEMIES[type];
    Save.data.seen[type] = true;
    Save.write();
    const cv = this.atlas.canvas(type, 0, 'threat-ico');
    let f = 0;
    const iv = setInterval(() => {
      if (!cv.isConnected) {
        clearInterval(iv);
        return;
      }
      this.paint(cv, [type], ++f);
    }, 140);
    const stats = [['HP', def.hp], ['SPEED', def.speed], ['LEAK', `-${def.dmg}`]];
    if (def.armor) stats.push(['ARMOR', def.armor]);
    this.modal((box) => {
      box.append(
        h('div', { class: 'threat-kicker', text: def.boss ? '⚠ BOSS SIGNATURE ⚠' : 'NEW THREAT DETECTED' }),
        cv,
        h('h2', { class: def.boss ? 'bad' : '', style: `color:${def.colors[0]}`, text: def.name.toUpperCase() }),
        h('div', { class: 'threat-stats' }, stats.map(([k, v]) => h('span', { class: 'chip' }, h('b', { text: k }), String(v)))),
        h('p', { text: def.desc }),
        h('div', { class: 'm-btns' }, h('button', { class: 'btn btn-primary', onclick: () => this.closeModal() }, 'ACKNOWLEDGE')));
    }, { dismissable: true });
  }

  statGrid(d) {
    return h('div', { class: 'm-stats' },
      h('div', {}, h('b', { text: 'WAVE' }), d.endless ? String(d.wave) : `${d.wave}/${d.total}`),
      h('div', {}, h('b', { text: 'CORE' }), `${d.lives}/${d.maxLives}`),
      h('div', {}, h('b', { text: 'PURGED' }), String(d.kills)),
      h('div', {}, h('b', { text: 'LEAKED' }), String(d.leaked)),
      h('div', {}, h('b', { text: 'BITS' }), fmt(d.earned)),
      h('div', {}, h('b', { text: 'BUILT' }), String(d.built)),
      h('div', {}, h('b', { text: 'BOSSES' }), String(d.bossKills)),
      h('div', {}, h('b', { text: 'TIME' }), fmtTime(d.time)));
  }

  showGameOver(d) {
    if (!this.game || this.screen !== 'game') return;
    const g = this.game;
    this.modal((box) => {
      box.append(
        h('h2', { class: 'bad glitch', 'data-text': g.endless ? 'RUN TERMINATED' : 'SYSTEM COMPROMISED', text: g.endless ? 'RUN TERMINATED' : 'SYSTEM COMPROMISED' }),
        h('p', { text: g.endless ? `You held the line until wave ${d.wave}.` : `The core was breached on wave ${d.wave}.` }),
        d.newBest ? h('p', { class: 'modal-sub', style: 'color:var(--y)', text: '★ NEW ENDLESS RECORD ★' }) : null,
        this.statGrid(d),
        h('div', { class: 'm-btns' },
          h('button', { class: 'btn btn-primary', onclick: () => this.restart() }, 'RETRY'),
          h('div', { class: 'm-row' },
            h('button', { class: 'btn btn-sm', onclick: () => { this.quitToMenu(); this.go('maps'); } }, 'SECTORS'),
            h('button', { class: 'btn btn-sm', onclick: () => this.quitToMenu() }, 'MENU'))));
    }, { onBack: () => {} });
  }

  showVictory(d) {
    if (!this.game || this.screen !== 'game') return;
    const g = this.game;
    const idx = MAPS.findIndex((m) => m.id === g.def.id);
    const nextMap = MAPS[idx + 1];
    const stars = [0, 1, 2].map((k) => this.icon(k < d.stars ? 'ico_star' : 'ico_star_off'));
    this.modal((box) => {
      box.append(
        h('h2', { class: 'gold', text: 'SECTOR SECURED' }),
        h('p', { class: 'modal-sub', text: `SECTOR ${g.def.sector} · ${g.def.name}${g.diff === 'hard' ? ' · HARD' : ''}` }),
        h('div', { class: 'm-stars' }, stars),
        this.statGrid(d),
        h('div', { class: 'm-btns' },
          nextMap ? h('button', { class: 'btn btn-primary', onclick: () => this.startGame(nextMap, { diff: g.diff }, true) }, `NEXT: SECTOR ${nextMap.sector}`) : null,
          h('div', { class: 'm-row' },
            h('button', { class: 'btn btn-sm', onclick: () => this.startGame(g.def, { diff: g.diff, endless: true }, true) }, 'ENDLESS'),
            h('button', { class: 'btn btn-sm', onclick: () => this.quitToMenu() }, 'MENU'))),
        !nextMap ? h('p', { class: 'modal-sub', style: 'color:var(--c)', text: 'The kernel is safe. Every sector secured. Try HARD or ENDLESS.' }) : null);
    }, { onBack: () => {} });
    stars.forEach((s, i) => setTimeout(() => {
      s.classList.add('in');
      if (i < d.stars) this.audio.play('star');
    }, 300 + i * 350));
  }

  // ======================================================= toast/banner
  toast(text, kind = '', life = 1.8) {
    const box = $('#toasts');
    while (box.children.length > 3) box.firstChild.remove();
    const el = h('div', { class: `toast ${kind}`, text, style: `--life:${life}s` });
    box.append(el);
    setTimeout(() => el.remove(), (life + 0.4) * 1000);
  }

  banner(text, sub = '', kind = '', life = 1.6) {
    const box = $('#banner');
    box.innerHTML = '';
    const el = h('div', { class: `bn ${kind}`, style: `--life:${life}s` },
      h('div', { class: 'bn-main', text }), sub ? h('div', { class: 'bn-sub', text: sub }) : null);
    box.append(el);
    setTimeout(() => el.remove(), (life + 0.5) * 1000);
  }

  // ============================================================= device
  async requestWake() {
    try {
      if ('wakeLock' in navigator && !this.wake && document.visibilityState === 'visible') {
        this.wake = await navigator.wakeLock.request('screen');
        this.wake.addEventListener('release', () => { this.wake = null; });
      }
    } catch (e) { /* not supported / denied */ }
  }

  releaseWake() {
    if (this.wake) {
      this.wake.release().catch(() => {});
      this.wake = null;
    }
  }
}
