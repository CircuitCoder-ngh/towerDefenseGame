/**
 * Tower definitions. `levels[i]` lists stats that change at that level; stats
 * inherit from the previous level. Ranges are in tiles, rates in shots/sec.
 */
export const TOWER_ORDER = ['pulse', 'beam', 'ice', 'bomb', 'arc', 'sniper', 'hub', 'miner'];

export const TARGET_MODES = ['first', 'last', 'strong', 'close'];
export const TARGET_LABEL = { first: 'FIRST', last: 'LAST', strong: 'STRONG', close: 'CLOSE' };

export const TOWERS = {
  pulse: {
    name: 'Pulse Cannon', short: 'PULSE', cost: 50, color: '#00ff41', glow: 'g',
    rotates: true, targets: true, turn: 11,
    desc: 'Rapid-fire packet cannon. Cheap, reliable single-target damage.',
    levels: [
      { dmg: 9, rate: 2.2, range: 2.4 },
      { cost: 65, dmg: 15, rate: 2.8, range: 2.6 },
      { cost: 140, dmg: 24, rate: 3.5, range: 2.8, twin: true },
    ],
  },
  beam: {
    name: 'Trace Laser', short: 'LASER', cost: 90, color: '#00f0ff', glow: 'c',
    rotates: true, targets: true, turn: 12,
    desc: 'Continuous beam that ramps up while locked on. Pierces armor.',
    levels: [
      { dps: 16, range: 2.0, ramp: 3, rampTime: 2.5, pierce: true },
      { cost: 100, dps: 28, range: 2.2 },
      { cost: 210, dps: 46, range: 2.4, ramp: 4 },
    ],
  },
  ice: {
    name: 'ICE Node', short: 'ICE', cost: 70, color: '#a8ecff', glow: 'i',
    rotates: false, targets: false,
    desc: 'Intrusion Countermeasure pulse. Slows and chills all malware in range.',
    levels: [
      { dmg: 3, rate: 0.9, range: 1.6, slow: 0.35, slowDur: 1.6 },
      { cost: 80, dmg: 6, range: 1.8, slow: 0.45 },
      { cost: 160, dmg: 12, range: 2.0, slow: 0.55, freeze: 0.12 },
    ],
  },
  bomb: {
    name: 'Logic Bomb', short: 'BOMB', cost: 110, color: '#ff8a1f', glow: 'o',
    rotates: true, targets: true, turn: 6,
    desc: 'Lobs payloads that detonate in an area. Shreds swarms.',
    levels: [
      { dmg: 28, rate: 0.65, range: 3.0, splash: 0.85 },
      { cost: 120, dmg: 48, rate: 0.7, splash: 0.95 },
      { cost: 240, dmg: 85, rate: 0.75, splash: 1.15, burn: { dps: 20, dur: 2.5 } },
    ],
  },
  arc: {
    name: 'Arc Relay', short: 'ARC', cost: 130, color: '#ff2bd6', glow: 'm',
    rotates: false, targets: true,
    desc: 'Chain lightning that jumps between nearby malware.',
    levels: [
      { dmg: 20, rate: 0.9, range: 2.2, chains: 3, chainRange: 1.5 },
      { cost: 140, dmg: 32, rate: 1.0, chains: 4 },
      { cost: 260, dmg: 50, rate: 1.15, chains: 6, detect: true },
    ],
  },
  sniper: {
    name: 'Daemon Sniper', short: 'SNIPER', cost: 150, color: '#ff3355', glow: 'r',
    rotates: true, targets: true, turn: 5, defaultTarget: 'strong',
    desc: 'Extreme range, massive hits. Detects cloaked malware.',
    levels: [
      { dmg: 75, rate: 0.42, range: 4.5, detect: true },
      { cost: 150, dmg: 150, rate: 0.48, range: 5.5 },
      { cost: 300, dmg: 280, rate: 0.55, range: 7, pierce: true, crit: 0.25 },
    ],
  },
  hub: {
    name: 'Overclock Hub', short: 'HUB', cost: 120, color: '#ffe600', glow: 'y',
    rotates: false, targets: false,
    desc: 'Boosts fire rate of nearby towers. Lv2+ reveals cloaked malware.',
    levels: [
      { range: 1.6, buffRate: 0.2 },
      { cost: 130, buffRate: 0.3, detect: true },
      { cost: 250, buffRate: 0.4, buffDmg: 0.2, range: 1.8 },
    ],
  },
  miner: {
    name: 'Crypto Miner', short: 'MINER', cost: 100, color: '#ffe600', glow: 'y',
    rotates: false, targets: false,
    desc: 'Mines bits. Pays out every time a wave is cleared.',
    levels: [
      { income: 20 },
      { cost: 120, income: 40 },
      { cost: 200, income: 70 },
    ],
  },
};

export function towerStats(type, level) {
  const def = TOWERS[type];
  const s = {};
  for (let i = 0; i <= level; i++) Object.assign(s, def.levels[i]);
  delete s.cost;
  return s;
}

/** Short human-readable stat list for UI: [[label, value], ...] */
export function statList(type, level) {
  const s = towerStats(type, level);
  const out = [];
  if (s.dmg) out.push(['DMG', s.dmg]);
  if (s.dps) out.push(['DPS', `${s.dps}×${s.ramp}`]);
  if (s.rate && type !== 'ice') out.push(['RATE', s.rate.toFixed(2).replace(/0$/, '')]);
  if (type === 'ice') out.push(['SLOW', Math.round(s.slow * 100) + '%']);
  if (s.range) out.push(['RNG', s.range]);
  if (s.splash) out.push(['AOE', s.splash]);
  if (s.chains) out.push(['JUMP', s.chains]);
  if (s.buffRate) out.push(['BOOST', '+' + Math.round(s.buffRate * 100) + '%']);
  if (s.buffDmg) out.push(['DMG', '+' + Math.round(s.buffDmg * 100) + '%']);
  if (s.income) out.push(['MINE', '+' + s.income]);
  return out;
}

export function traitList(type, level) {
  const s = towerStats(type, level);
  const t = [];
  if (s.pierce) t.push('ARMOR-PIERCE');
  if (s.detect) t.push('DETECTION');
  if (s.twin) t.push('TWIN BARREL');
  if (s.burn) t.push('CORRUPTION BURN');
  if (s.freeze) t.push(Math.round(s.freeze * 100) + '% FREEZE');
  if (s.crit) t.push(Math.round(s.crit * 100) + '% CRIT');
  return t;
}
