/**
 * Malware definitions. speed is in tiles/sec, hp is base (scaled per wave).
 */
export const ENEMY_ORDER = ['crawler', 'worm', 'spam', 'trojan', 'glitch', 'phantom', 'patcher', 'shield', 'rootkit', 'kernel'];

export const ENEMIES = {
  crawler: {
    name: 'Bit Crawler', hp: 32, speed: 1.0, reward: 4, dmg: 1, rotate: true, fps: 10,
    colors: ['#ff3355', '#b3162b', '#ffb0bd'],
    desc: 'Basic malware. Crawls the data bus in packs.',
  },
  worm: {
    name: 'Net Worm', hp: 24, speed: 1.85, reward: 5, dmg: 1, rotate: true, fps: 10,
    colors: ['#ff2bd6', '#c2189e', '#ffb3f2'],
    desc: 'Fast and self-propagating. Hard to pin down.',
  },
  spam: {
    name: 'Spambot', hp: 11, speed: 1.45, reward: 1, dmg: 1, rotate: false, fps: 12,
    colors: ['#ffe600', '#e0b000', '#ffffff'],
    desc: 'Fragile, but arrives in floods. Splash damage recommended.',
  },
  trojan: {
    name: 'Trojan', hp: 150, speed: 0.6, reward: 14, dmg: 2, armor: 4, rotate: true, fps: 8,
    colors: ['#ff8a1f', '#5e7480', '#ff3355'],
    onDeath: { type: 'crawler', count: 3 },
    desc: 'Armored hull (-4 dmg per hit). Releases 3 crawlers when breached.',
  },
  glitch: {
    name: 'Glitch', hp: 55, speed: 1.05, reward: 8, dmg: 1, rotate: false, fps: 12,
    colors: ['#ff2bd6', '#00f0ff', '#9d6bff'],
    blink: { every: 3.2, dist: 1.6 },
    desc: 'Unstable code. Periodically teleports forward along the bus.',
  },
  phantom: {
    name: 'Phantom', hp: 60, speed: 1.2, reward: 9, dmg: 1, stealth: true, rotate: false, fps: 8,
    colors: ['#9d6bff', '#5b2bd6', '#d9c8ff'],
    desc: 'Cloaked. Only targetable when revealed by a detector: Daemon Sniper, Overclock Hub Lv2+, or Arc Relay Lv3.',
  },
  patcher: {
    name: 'Patcher', hp: 70, speed: 0.9, reward: 11, dmg: 1, rotate: false, fps: 6,
    colors: ['#ff7ab8', '#ffffff', '#7dffb0'],
    aura: { heal: 0.08, radius: 1.4, every: 2.0 },
    desc: 'Repairs nearby malware by 8% every 2s. Prioritize it.',
  },
  shield: {
    name: 'Aegis Drone', hp: 80, speed: 0.9, reward: 11, dmg: 1, rotate: false, fps: 12,
    colors: ['#2a6aff', '#7aa8ff', '#d0e0ff'],
    aura: { shield: 0.35, radius: 1.4, every: 3.0 },
    desc: 'Projects damage-absorbing shields onto nearby malware.',
  },
  rootkit: {
    name: 'ROOTKIT', hp: 1000, speed: 0.42, reward: 150, dmg: 5, armor: 4, boss: true, size: 24,
    rotate: true, fps: 8, slowResist: 0.5,
    colors: ['#ff3355', '#6e0f1e', '#ffe600'],
    summon: { type: 'spam', every: 4.5, count: 3 },
    desc: 'BOSS. Armored spider-tank that deploys spambots. Resists slows. Leaking it costs 5 integrity.',
  },
  kernel: {
    name: 'KERNEL PANIC', hp: 3500, speed: 0.32, reward: 500, dmg: 15, armor: 8, boss: true, size: 32,
    rotate: false, fps: 6, slowResist: 0.6,
    colors: ['#ff3355', '#ffb0bd', '#ffffff'],
    phases: [0.66, 0.33],
    summon: { type: 'glitch', every: 7, count: 2 },
    desc: 'FINAL BOSS. At 66% and 33% integrity it emits a panic burst that disables nearby defenses.',
  },
};
