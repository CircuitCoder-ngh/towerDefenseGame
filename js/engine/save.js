const KEY = 'zeroday.save.v1';

const DEFAULTS = () => ({
  maps: {},
  seen: {},
  tutorial: false,
  run: null,
  totals: { kills: 0, games: 0, wins: 0 },
  settings: {
    sfx: 0.8,
    music: 0.45,
    haptics: true,
    dmgNums: true,
    crt: true,
    shake: true,
    autoWave: false,
    fullscreen: true,
  },
});

function merge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      base[k] = merge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

export const Save = {
  data: DEFAULTS(),

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = merge(DEFAULTS(), JSON.parse(raw));
    } catch (e) {
      console.warn('save load failed', e);
    }
    return this.data;
  },

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('save write failed', e);
    }
  },

  get settings() {
    return this.data.settings;
  },

  map(id) {
    if (!this.data.maps[id]) this.data.maps[id] = { stars: 0, hardStars: 0, best: 0, cleared: false };
    return this.data.maps[id];
  },

  reset() {
    const settings = this.data.settings;
    this.data = DEFAULTS();
    this.data.settings = settings;
    this.write();
  },
};
