import { TILE, hash2, hashStr } from '../engine/util.js';

const PATH = new Set(['#', 'S', 'T', 'C']);
const DECOR = ['server', 'chip', 'fan', 'crystal', 'cap', 'terminal'];
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export class GameMap {
  constructor(def) {
    this.def = def;
    this.grid = def.grid;
    this.rows = def.grid.length;
    this.cols = def.grid[0].length;
    this.w = this.cols * TILE;
    this.h = this.rows * TILE;
    const spawns = [];
    this.core = null;
    this.decor = [];
    const seed = hashStr(def.id);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        if (ch === 'S') spawns[0] = { c, r };
        else if (ch === 'T') spawns[1] = { c, r };
        else if (ch === 'C') this.core = { c, r, x: c * TILE + 8, y: r * TILE + 8 };
        else if (ch === 'x') this.decor.push({ c, r, kind: DECOR[hash2(c + seed, r) % DECOR.length], phase: Math.random() * 3 });
      }
    }
    this.spawns = spawns.filter(Boolean).map((s) => ({ ...s, x: s.c * TILE + 8, y: s.r * TILE + 8 }));
    this.routes = this.spawns.map((s) => this.buildRoute(s));
  }

  ch(c, r) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.grid[r][c];
  }

  isPath(c, r) {
    return PATH.has(this.ch(c, r));
  }

  isBuildable(c, r) {
    return this.ch(c, r) === '.';
  }

  isGroundAt(x, y) {
    return this.ch(Math.floor(x / TILE), Math.floor(y / TILE)) === '.';
  }

  buildRoute(s) {
    const key = (c, r) => r * this.cols + c;
    const prev = new Map();
    const seen = new Set([key(s.c, s.r)]);
    const q = [{ c: s.c, r: s.r }];
    let end = null;
    while (q.length) {
      const cur = q.shift();
      if (this.grid[cur.r][cur.c] === 'C') {
        end = cur;
        break;
      }
      for (const [dx, dy] of DIRS) {
        const nc = cur.c + dx, nr = cur.r + dy;
        const k = key(nc, nr);
        if (!seen.has(k) && this.isPath(nc, nr)) {
          seen.add(k);
          prev.set(k, cur);
          q.push({ c: nc, r: nr });
        }
      }
    }
    if (!end) throw new Error(`Map ${this.def.id}: no route from spawn to core`);
    const cells = [];
    let cur = end;
    while (cur) {
      cells.push(cur);
      cur = prev.get(key(cur.c, cur.r));
    }
    cells.reverse();
    const pts = cells.map(({ c, r }) => ({ x: c * TILE + 8, y: r * TILE + 8 }));
    // Start slightly off-map so malware emerges from beyond the edge.
    const first = cells[0];
    const out = this.edgeDir(first.c, first.r);
    if (out) pts.unshift({ x: pts[0].x + out[0] * 10, y: pts[0].y + out[1] * 10 });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    return { pts, cum, len: cum[cum.length - 1], cells };
  }

  edgeDir(c, r) {
    if (r === 0) return [0, -1];
    if (r === this.rows - 1) return [0, 1];
    if (c === 0) return [-1, 0];
    if (c === this.cols - 1) return [1, 0];
    return null;
  }

  /** Position along a route at distance d. */
  posAt(route, d) {
    const { pts, cum } = route;
    if (d <= 0) return { x: pts[0].x, y: pts[0].y };
    if (d >= route.len) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * t, y: pts[lo].y + (pts[hi].y - pts[lo].y) * t };
  }

  pathMask(c, r) {
    let m = (this.isPath(c, r - 1) ? 1 : 0) | (this.isPath(c + 1, r) ? 2 : 0) |
      (this.isPath(c, r + 1) ? 4 : 0) | (this.isPath(c - 1, r) ? 8 : 0);
    const ch = this.ch(c, r);
    if (ch === 'S' || ch === 'T') {
      const out = this.edgeDir(c, r);
      if (out) m |= out[1] === -1 ? 1 : out[0] === 1 ? 2 : out[1] === 1 ? 4 : 8;
    }
    return m;
  }

  /** Render static ground + data-bus tiles to an offscreen canvas at 1x. */
  prerender(atlas) {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const h = hash2(c * 7 + 3, r * 13 + 1);
        const v = h % 10 < 5 ? 0 : 1 + ((h >>> 5) % 5);
        atlas.drawTL(ctx, `ground_${v}`, c * TILE, r * TILE);
        if (this.isPath(c, r)) atlas.drawTL(ctx, `path_${this.pathMask(c, r)}`, c * TILE, r * TILE);
      }
    }
    return cv;
  }

  /** Small schematic preview for menus. */
  preview(px = 6) {
    const cv = document.createElement('canvas');
    cv.width = this.cols * px;
    cv.height = this.rows * px;
    const ctx = cv.getContext('2d');
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        ctx.fillStyle =
          ch === '#' ? '#0a3a1b' : ch === 'S' || ch === 'T' ? '#ff2bd6' : ch === 'C' ? '#00f0ff' : ch === 'x' ? '#1c262b' : '#07120d';
        ctx.fillRect(c * px, r * px, px, px);
        if (ch === '#') {
          ctx.fillStyle = '#00c92e';
          ctx.fillRect(c * px + px / 2 - 1, r * px + px / 2 - 1, 2, 2);
        }
      }
    }
    return cv;
  }
}
