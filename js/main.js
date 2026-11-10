import { Atlas } from './engine/atlas.js';
import { AudioEngine } from './engine/audio.js';
import { Save } from './engine/save.js';
import { UI } from './ui/ui.js';
import { Rain } from './game/rain.js';

const app = {
  atlas: new Atlas(),
  audio: new AudioEngine(),
  debug: new URLSearchParams(location.search).has('debug'),
};

/** Full-screen menu background: big chunky digital rain. */
class Backdrop {
  constructor(canvas, atlas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.atlas = atlas;
    this.scale = 3;
    this.rain = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.scale = Math.max(2, Math.round(2.2 * dpr));
    const w = this.cv.width / this.scale, h = this.cv.height / this.scale;
    if (!this.rain) this.rain = new Rain(w, h, { colW: 8, density: 0.7, speed: 0.8 });
    else this.rain.resize(w, h);
  }

  frame(dt) {
    const { ctx, cv } = this;
    this.rain.update(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#010402';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.rain.draw(ctx, this.atlas, 0.55);
  }
}

async function boot() {
  Save.load();
  try {
    await Promise.all([
      app.atlas.load('assets/'),
      document.fonts.load('20px VT323'),
      document.fonts.load('12px PS2P'),
    ]);
  } catch (e) {
    console.error(e);
    document.getElementById('boot-log').textContent = '> FATAL: asset load failed\n> ' + e;
    return;
  }

  const ui = new UI(app);
  ui.init();
  const bg = new Backdrop(document.getElementById('bg'), app.atlas);
  if (app.debug) window.__zd = { app, ui, Save };

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      if (ui.screen === 'game') ui.frame(dt);
      else bg.frame(dt);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  ui.boot();

  if (!app.debug && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

boot();
