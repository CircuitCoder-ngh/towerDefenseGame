/**
 * Fully synthesized audio (WebAudio) - no sound files needed.
 * SFX are short oscillator/noise recipes; music is a step sequencer
 * playing a dark synthwave loop whose intensity follows the game state.
 */
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

const GAPS = {
  pulse: 0.05, death: 0.035, coin: 0.06, arc: 0.08, explode: 0.07, ice: 0.12, sniper: 0.06,
  beam: 0.25, blink: 0.12, heal: 0.4, shield: 0.4, bomb: 0.08, click: 0.03, crit: 0.08,
};

// A-minor progressions: { root (bass midi), chord (midi notes) }
const PROG = [
  { root: 45, chord: [57, 60, 64] }, // Am
  { root: 41, chord: [53, 57, 60] }, // F
  { root: 48, chord: [55, 60, 64] }, // C
  { root: 43, chord: [55, 59, 62] }, // G
];
const BOSS_PROG = [
  { root: 45, chord: [57, 60, 64] }, // Am
  { root: 46, chord: [58, 62, 65] }, // Bb
  { root: 45, chord: [57, 60, 64] }, // Am
  { root: 40, chord: [56, 59, 64] }, // E
];
const ARP = [0, 2, 1, 3, 2, 4, 3, 5, 0, 2, 1, 3, 4, 3, 2, 1];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.8;
    this.musicVol = 0.45;
    this.last = Object.create(null);
    this.music = { on: false, mode: 'menu', step: 0, next: 0, timer: null };
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.ratio.value = 4;
      this.comp.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.comp);
      this.musBus = ctx.createGain();
      this.musFilter = ctx.createBiquadFilter();
      this.musFilter.type = 'lowpass';
      this.musFilter.frequency.value = 18000;
      this.musBus.connect(this.musFilter);
      this.musFilter.connect(this.comp);
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.applyVolumes();
      if (this.music.on) this._startScheduler();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes(sfx, mus) {
    this.sfxVol = sfx;
    this.musicVol = mus;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.sfxBus.gain.value = this.sfxVol * 0.9;
    this.musBus.gain.value = this.musicVol * 0.6;
  }

  /** Muffle music (e.g. while paused). */
  muffle(on) {
    if (!this.ctx) return;
    this.musFilter.frequency.setTargetAtTime(on ? 700 : 18000, this.ctx.currentTime, 0.15);
  }

  osc(type, f0, f1, t0, dur, vol, dest, opts = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter.type || 'lowpass';
      f.frequency.setValueAtTime(opts.filter.f0, t0);
      if (opts.filter.f1) f.frequency.exponentialRampToValueAtTime(opts.filter.f1, t0 + dur);
      f.Q.value = opts.filter.q ?? 1;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest || this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(t0, dur, vol, f0, f1, type = 'lowpass', q = 1, dest) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t0);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxBus);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.05);
  }

  play(name) {
    if (!this.ctx || this.ctx.state !== 'running' || this.sfxVol <= 0) return;
    const now = this.ctx.currentTime;
    const gap = GAPS[name] ?? 0.04;
    if (now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    const t = now + 0.005;
    switch (name) {
      case 'pulse':
        this.osc('square', 1100, 480, t, 0.07, 0.06);
        break;
      case 'beam':
        this.osc('sawtooth', 220, 880, t, 0.2, 0.05, null, { filter: { f0: 1800, q: 5 } });
        break;
      case 'bomb':
        this.osc('sine', 190, 60, t, 0.18, 0.22);
        this.noise(t, 0.08, 0.07, 1200, 300);
        break;
      case 'explode':
        this.noise(t, 0.45, 0.32, 2400, 120);
        this.osc('sine', 110, 35, t, 0.35, 0.32);
        break;
      case 'ice':
        this.osc('triangle', 1400, 2300, t, 0.25, 0.07);
        this.osc('sine', 2800, 1900, t + 0.03, 0.2, 0.035);
        this.noise(t, 0.2, 0.04, 6000, 3000, 'highpass');
        break;
      case 'arc':
        for (let i = 0; i < 4; i++) {
          this.osc('sawtooth', 300 + Math.random() * 1800, 200 + Math.random() * 900, t + i * 0.025, 0.05, 0.05);
        }
        this.noise(t, 0.12, 0.09, 5000, 2000, 'bandpass', 2);
        break;
      case 'sniper':
        this.noise(t, 0.12, 0.28, 4000, 600);
        this.osc('square', 220, 55, t, 0.2, 0.14);
        this.osc('sine', 1800, 300, t, 0.06, 0.07);
        break;
      case 'crit':
        this.osc('square', 2400, 1200, t, 0.09, 0.06);
        this.osc('square', 3200, 1600, t + 0.04, 0.08, 0.04);
        break;
      case 'death':
        this.osc('square', 880 + Math.random() * 200, 110, t, 0.09, 0.045);
        break;
      case 'bigdeath':
        this.noise(t, 0.9, 0.32, 1800, 60);
        this.osc('sawtooth', 300, 30, t, 0.8, 0.18);
        this.osc('square', 150, 20, t + 0.2, 0.7, 0.12);
        break;
      case 'coin':
        this.osc('triangle', 1318, 1318, t, 0.06, 0.05);
        this.osc('triangle', 1760, 1760, t + 0.05, 0.08, 0.05);
        break;
      case 'build':
        [523, 659, 784].forEach((f, i) => this.osc('square', f, f, t + i * 0.05, 0.08, 0.06));
        this.noise(t, 0.1, 0.05, 3000, 800);
        break;
      case 'upgrade':
        [523, 659, 784, 1046].forEach((f, i) => this.osc('square', f, f * 1.01, t + i * 0.055, 0.1, 0.06));
        break;
      case 'sell':
        [784, 523, 392].forEach((f, i) => this.osc('square', f, f, t + i * 0.06, 0.08, 0.06));
        break;
      case 'click':
        this.osc('square', 1600, 1200, t, 0.025, 0.035);
        break;
      case 'select':
        this.osc('square', 900, 1300, t, 0.05, 0.04);
        break;
      case 'error':
        this.osc('square', 140, 120, t, 0.16, 0.09);
        this.osc('square', 147, 125, t, 0.16, 0.05);
        break;
      case 'core':
        this.osc('sawtooth', 120, 40, t, 0.4, 0.24, null, { filter: { f0: 900, f1: 200 } });
        this.noise(t, 0.3, 0.18, 900, 100);
        break;
      case 'wave':
        [0, 0.2].forEach((d) => {
          this.osc('square', 660, 660, t + d, 0.1, 0.06);
          this.osc('square', 990, 990, t + d + 0.09, 0.08, 0.045);
        });
        break;
      case 'boss':
        for (let i = 0; i < 3; i++) {
          this.osc('sawtooth', 220, 440, t + i * 0.45, 0.42, 0.09, null, { filter: { f0: 1400 } });
          this.osc('sawtooth', 110, 220, t + i * 0.45, 0.42, 0.07, null, { filter: { f0: 900 } });
        }
        break;
      case 'emp':
        this.osc('sawtooth', 1600, 40, t, 0.9, 0.18, null, { filter: { f0: 3000, f1: 200 } });
        this.noise(t, 0.8, 0.22, 3000, 100);
        break;
      case 'purge_charge':
        this.osc('sine', 200, 1800, t, 0.55, 0.1);
        this.osc('square', 100, 900, t, 0.55, 0.03);
        break;
      case 'purge':
        this.noise(t, 0.8, 0.38, 5000, 80);
        this.osc('square', 80, 30, t, 0.6, 0.22);
        break;
      case 'overclock':
        this.osc('sawtooth', 200, 1200, t, 0.5, 0.07, null, { filter: { f0: 600, f1: 4000 } });
        [880, 1108, 1318].forEach((f, i) => this.osc('square', f, f, t + 0.3 + i * 0.05, 0.1, 0.045));
        break;
      case 'blink':
        this.osc('square', 200 + Math.random() * 800, 2000, t, 0.06, 0.035);
        break;
      case 'heal':
        this.osc('sine', 600, 900, t, 0.15, 0.035);
        break;
      case 'shield':
        this.osc('triangle', 300, 600, t, 0.15, 0.035);
        break;
      case 'clear':
        [784, 988, 1175].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.07, 0.14, 0.07));
        break;
      case 'disable':
        this.osc('square', 900, 60, t, 0.5, 0.09);
        this.noise(t, 0.5, 0.14, 2000, 200, 'bandpass', 3);
        break;
      case 'victory':
        [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.osc('square', f, f, t + i * 0.11, 0.16, 0.07));
        break;
      case 'defeat':
        [440, 415, 392, 330, 262].forEach((f, i) =>
          this.osc('sawtooth', f, f * 0.98, t + i * 0.18, 0.3, 0.07, null, { filter: { f0: 1400 } })
        );
        break;
      case 'star':
        this.osc('square', 1046, 2093, t, 0.18, 0.06);
        break;
      case 'boot':
        [220, 330, 440, 660, 880].forEach((f, i) => this.osc('square', f, f, t + i * 0.06, 0.07, 0.04));
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------- music
  setMusic(mode) {
    this.music.mode = mode;
    if (mode === 'off') {
      this.music.on = false;
      this._stopScheduler();
      return;
    }
    if (!this.music.on) {
      this.music.on = true;
      if (this.ctx) this._startScheduler();
    }
  }

  _startScheduler() {
    if (this.music.timer) return;
    this.music.next = this.ctx.currentTime + 0.1;
    this.music.step = 0;
    this.music.timer = setInterval(() => this._schedule(), 25);
  }

  _stopScheduler() {
    clearInterval(this.music.timer);
    this.music.timer = null;
  }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.musicVol <= 0) {
      if (ctx) this.music.next = ctx.currentTime + 0.05;
      return;
    }
    const m = this.music;
    const bpm = m.mode === 'boss' ? 120 : m.mode === 'wave' ? 108 : 94;
    const sp = 60 / bpm / 4;
    if (m.next < ctx.currentTime - 0.2) m.next = ctx.currentTime + 0.05;
    while (m.next < ctx.currentTime + 0.12) {
      this._step(m.step, m.next, sp);
      m.next += sp;
      m.step = (m.step + 1) % 64;
    }
  }

  _step(step, t, sp) {
    const mode = this.music.mode;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ch = (mode === 'boss' ? BOSS_PROG : PROG)[bar];
    const dest = this.musBus;
    const intense = mode === 'wave' || mode === 'boss';

    if (s === 0) {
      for (const n of ch.chord) {
        this.osc('triangle', midi(n), midi(n), t, sp * 16 * 0.98, mode === 'menu' ? 0.03 : 0.022, dest, { attack: 0.35 });
        this.osc('sawtooth', midi(n - 12), midi(n - 12), t, sp * 16 * 0.98, 0.008, dest, { attack: 0.6, detune: 7, filter: { f0: 700 } });
      }
    }
    if (s % 2 === 0) {
      const n = ch.root + (s % 4 === 2 ? 12 : 0);
      this.osc('sawtooth', midi(n), midi(n), t, sp * 1.8, intense ? 0.085 : 0.055, dest, {
        filter: { f0: intense ? 1000 : 520, f1: 140, q: 6 },
      });
    }
    if (intense ? s % 4 === 0 : s === 0 || s === 8) {
      this.osc('sine', 150, 40, t, 0.22, intense ? 0.32 : 0.16, dest);
    }
    if (intense && (s === 4 || s === 12)) this.noise(t, 0.14, 0.11, 3000, 900, 'bandpass', 0.8, dest);
    if (s % 2 === 1 || intense) this.noise(t, 0.035, s % 2 === 1 ? 0.045 : 0.02, 8000, 6000, 'highpass', 1, dest);

    if (mode !== 'menu') {
      const idx = ARP[s];
      const notes = ch.chord;
      const n = notes[idx % notes.length] + 12 * (1 + Math.floor(idx / notes.length)) - 12;
      if (intense || s % 2 === 0) {
        this.osc('square', midi(n), midi(n), t, sp * 0.9, intense ? 0.026 : 0.016, dest, { filter: { f0: 2600 } });
      }
      if (mode === 'boss' && s % 8 === 6) {
        this.osc('sawtooth', midi(ch.root + 24), midi(ch.root + 23), t, sp * 2, 0.03, dest, { filter: { f0: 1600 } });
      }
    } else if (s % 4 === 0) {
      const n = ch.chord[(s / 4) % 3] + 12;
      this.osc('sine', midi(n), midi(n), t, sp * 3.5, 0.028, dest);
      this.osc('sine', midi(n + 12), midi(n + 12), t + sp * 2, sp * 2, 0.012, dest);
    }
  }
}
