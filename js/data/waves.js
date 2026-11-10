/**
 * Wave generation. Waves 1-5 are hand-tuned onboarding; later waves are
 * generated deterministically per sector from a threat budget, with bosses
 * on each sector's boss waves (and every 10th wave in Endless).
 */
import { mulberry32, hashStr } from '../engine/util.js';

const COST = { crawler: 1, worm: 1.1, spam: 0.4, trojan: 5, glitch: 2, phantom: 2.2, patcher: 3.2, shield: 3.5 };
const GAP = { crawler: 0.75, worm: 0.45, spam: 0.16, trojan: 1.8, glitch: 0.9, phantom: 0.9, patcher: 1.6, shield: 1.7 };
/** Difficulty / economy knobs (tuned with a headless bot playthrough). */
export const TUNE = {
  hpLin: 0.14, hpQuad: 0.012, budgetBase: 8, budgetPer: 1.7,
  clearBase: 15, clearPer: 3, rewardGrowth: 0.012, hardHp: 1.35,
};

export const UNLOCK = { crawler: 1, worm: 3, spam: 5, trojan: 7, glitch: 9, phantom: 12, patcher: 14, shield: 16 };

const EARLY = {
  1: [['crawler', 8, 1.2]],
  2: [['crawler', 12, 0.95]],
  3: [['crawler', 8, 0.9], ['worm', 5, 0.7]],
  4: [['crawler', 12, 0.8], ['worm', 8, 0.55]],
  5: [['spam', 18, 0.22], ['crawler', 8, 0.8]],
};

export function hpScale(n, diff) {
  let m = 1 + TUNE.hpLin * (n - 1) + TUNE.hpQuad * (n - 1) * (n - 1);
  if (n > 30) m *= Math.pow(1.045, n - 30);
  return m * (diff === 'hard' ? TUNE.hardHp : 1);
}

export function bossScale(n, diff) {
  return Math.pow(hpScale(n, diff), 0.75);
}

export function bossFor(map, n, endless) {
  if (n <= map.waves) {
    if (!map.bossWaves.includes(n)) return null;
    return n === map.waves && map.finalBoss ? map.finalBoss : 'rootkit';
  }
  if (!endless || n % 10 !== 0) return null;
  return n % 20 === 0 && n >= 40 ? 'kernel' : 'rootkit';
}

function weightedPick(types, rng, n) {
  const w = types.map((t) => {
    if (t === 'crawler') return Math.max(0.35, 1.4 - n / 20);
    if (t === 'spam') return 0.8;
    if (t === 'trojan' || t === 'shield' || t === 'patcher') return 0.6 + Math.min(1.4, (n - 10) / 12);
    return 1;
  });
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < types.length; i++) {
    r -= w[i];
    if (r <= 0) return types[i];
  }
  return types[types.length - 1];
}

export function buildWave(map, n, spawnCount, endless) {
  const rng = mulberry32(hashStr(map.id) + n * 7919);
  const groups = [];
  const add = (type, count, gap, delay, spawn = 0) => groups.push({ type, count, gap, delay, spawn });

  if (EARLY[n]) {
    let delay = 0;
    for (const [t, c, g] of EARLY[n]) {
      if (spawnCount > 1) {
        add(t, Math.ceil(c / 2), g * 1.5, delay, 0);
        add(t, Math.floor(c / 2), g * 1.5, delay + g * 0.75, 1);
        delay += Math.ceil(c / 2) * g * 1.5 * 0.6 + 1;
      } else {
        add(t, c, g, delay, 0);
        delay += c * g * 0.6 + 1;
      }
    }
    return { n, groups };
  }

  const types = Object.keys(UNLOCK).filter((t) => UNLOCK[t] <= n);
  let budget = TUNE.budgetBase + n * TUNE.budgetPer;
  let delay = 0;
  const boss = bossFor(map, n, endless);
  if (boss) {
    add(boss, 1, 1, 2, 0);
    if (boss === 'rootkit' && n >= 20) {
      add('rootkit', 1, 1, 12, spawnCount > 1 ? 1 : 0);
    }
    budget *= 0.55;
    delay = 4;
  }

  const intro = types.find((t) => UNLOCK[t] === n);
  const nGroups = Math.min(5, 2 + Math.floor(n / 8));
  for (let i = 0; i < nGroups; i++) {
    const t = i === 0 && intro ? intro : weightedPick(types, rng, n);
    const share = (budget / nGroups) * (0.75 + rng() * 0.5);
    const count = Math.max(1, Math.round(share / COST[t]));
    const gap = GAP[t] * Math.max(0.55, 1 - n * 0.012);
    const spawn = spawnCount > 1 ? i % 2 : 0;
    add(t, count, gap, delay, spawn);
    delay += count * gap * (spawnCount > 1 ? 0.35 : 0.55) + 0.8 + rng() * 1.2;
  }
  return { n, groups };
}

export function waveTypes(wave) {
  return [...new Set(wave.groups.map((g) => g.type))];
}
