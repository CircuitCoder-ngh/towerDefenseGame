#!/usr/bin/env python3
"""
ZERO//DAY - procedural pixel-art spritesheet generator.

Draws every sprite in the game (tiles, towers, malware, projectiles, FX,
UI icons, matrix glyphs, app icons) pixel-by-pixel and packs them into
assets/sprites.png + assets/sprites.json (a texture atlas).

Run:  python3 tools/generate_sprites.py
Requires: Pillow (only used to write PNG files).

Atlas format (sprites.json):
  frames: { name: [x, y, w, h] }
  anims:  { name: [frameName0, frameName1, ...] }
Replace sprites.png with hand-drawn art using the same layout/names to reskin.
"""
import json
import math
import os
import random

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ASSETS = os.path.join(ROOT, 'assets')
ICONS = os.path.join(ASSETS, 'icons')


# ----------------------------------------------------------------- colours
def hx(s, a=255):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(4))


def alpha(c, a):
    return (c[0], c[1], c[2], int(max(0, min(255, a))))


K = hx('05070a')
OUT = hx('020403')
W = hx('f0fff4')
GR = [hx('003b00'), hx('008f11'), hx('00c92e'), hx('00ff41'), hx('b6ffb0')]
CY = [hx('00303a'), hx('006b80'), hx('00b8d4'), hx('00f0ff'), hx('c8ffff')]
MG = [hx('3a0833'), hx('6b0f5c'), hx('c2189e'), hx('ff2bd6'), hx('ffb3f2')]
PU = [hx('1a0a3a'), hx('2a0f5c'), hx('5b2bd6'), hx('9d6bff'), hx('d9c8ff')]
YE = [hx('3a2e00'), hx('806600'), hx('e0b000'), hx('ffe600'), hx('fff6b0')]
RD = [hx('2e050a'), hx('5c0a14'), hx('b3162b'), hx('ff3355'), hx('ffb0bd')]
OR = [hx('3a1600'), hx('7a2e00'), hx('e05a00'), hx('ff8a1f'), hx('ffd0a0')]
IC = [hx('0a2a3a'), hx('2a6a8a'), hx('5ab8e0'), hx('a8ecff'), hx('f0ffff')]
BL = [hx('0a1440'), hx('1a3a9a'), hx('2a6aff'), hx('7aa8ff'), hx('d0e0ff')]
PK = [hx('4a1030'), hx('9a3a70'), hx('ff7ab8'), hx('ffd0e8')]
MT = [hx('0a0f12'), hx('151d22'), hx('232f36'), hx('3a4a52'), hx('5e7480'), hx('93aab5')]
MINT = hx('7dffb0')

G_BASE = hx('08110e')
G_DOT = hx('0d1a15')
G_EDGE = hx('0c1813')
G_TRACE = hx('0d2c1b')
G_TRACE_HI = hx('134a2a')
G_VIA = hx('1d6b3a')

P_BASE = hx('03070a')
P_PAT = hx('08141a')
P_LANE = hx('0b2620')
P_EDGE = GR[2]
P_EDGE2 = hx('0a3a1b')


# ------------------------------------------------------------------ canvas
class Spr:
    def __init__(self, w, h=None):
        self.w = w
        self.h = h if h is not None else w
        self.p = [[None] * self.w for _ in range(self.h)]

    def set(self, x, y, c):
        if c is None:
            return
        x = int(math.floor(x))
        y = int(math.floor(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.p[y][x] = c

    def blend(self, x, y, c):
        x = int(math.floor(x))
        y = int(math.floor(y))
        if not (0 <= x < self.w and 0 <= y < self.h):
            return
        d = self.p[y][x]
        if d is None or c[3] == 255:
            self.p[y][x] = c
            return
        a = c[3] / 255
        da = d[3] / 255
        oa = a + da * (1 - a)
        if oa <= 0:
            return
        rgb = [int((c[i] * a + d[i] * da * (1 - a)) / oa) for i in range(3)]
        self.p[y][x] = (rgb[0], rgb[1], rgb[2], int(oa * 255))

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.p[y][x]
        return None

    def erase(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.p[y][x] = None

    def rect(self, x, y, w, h, c):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.set(i, j, c)

    def box(self, x, y, w, h, c):
        for i in range(x, x + w):
            self.set(i, y, c)
            self.set(i, y + h - 1, c)
        for j in range(y, y + h):
            self.set(x, j, c)
            self.set(x + w - 1, j, c)

    def hline(self, x0, x1, y, c):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            self.set(x, y, c)

    def vline(self, x, y0, y1, c):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            self.set(x, y, c)

    def line(self, x0, y0, x1, y1, c):
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.set(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def disc(self, cx, cy, r, c):
        for y in range(self.h):
            for x in range(self.w):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                    self.set(x, y, c)

    def ring(self, cx, cy, r0, r1, c):
        for y in range(self.h):
            for x in range(self.w):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if r0 <= d <= r1:
                    self.set(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(self.h):
            for x in range(self.w):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.set(x, y, c)

    def sdisc(self, cx, cy, r, ramp, lx=-0.6, ly=-0.75):
        self.sellipse(cx, cy, r, r, ramp, lx, ly)

    def sellipse(self, cx, cy, rx, ry, ramp, lx=-0.6, ly=-0.75):
        """Shaded ellipse lit from the top-left; ramp is dark -> light."""
        n = len(ramp)
        for y in range(self.h):
            for x in range(self.w):
                dx = (x + 0.5 - cx) / rx
                dy = (y + 0.5 - cy) / ry
                d2 = dx * dx + dy * dy
                if d2 <= 1.0:
                    dz = math.sqrt(1 - d2)
                    l = dx * lx + dy * ly + dz * 0.6
                    t = max(0.0, min(0.999, (l + 0.55) / 1.55))
                    self.set(x, y, ramp[int(t * n)])

    def poly(self, pts, c):
        n = len(pts)
        minx = max(0, int(min(p[0] for p in pts)) - 1)
        maxx = min(self.w - 1, int(max(p[0] for p in pts)) + 1)
        miny = max(0, int(min(p[1] for p in pts)) - 1)
        maxy = min(self.h - 1, int(max(p[1] for p in pts)) + 1)
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                px, py = x + 0.5, y + 0.5
                inside = False
                j = n - 1
                for i in range(n):
                    xi, yi = pts[i]
                    xj, yj = pts[j]
                    if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                        inside = not inside
                    j = i
                if inside:
                    self.set(x, y, c)

    def bevel(self, hi, lo):
        snap = [row[:] for row in self.p]

        def empty(x, y):
            return not (0 <= x < self.w and 0 <= y < self.h) or snap[y][x] is None

        for y in range(self.h):
            for x in range(self.w):
                if snap[y][x] is None:
                    continue
                if empty(x, y - 1) or empty(x - 1, y):
                    self.p[y][x] = hi
                elif empty(x, y + 1) or empty(x + 1, y):
                    self.p[y][x] = lo
        return self

    def outline(self, c=OUT, diag=False):
        snap = [row[:] for row in self.p]
        nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diag:
            nb += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
        for y in range(self.h):
            for x in range(self.w):
                if snap[y][x] is not None:
                    continue
                for dx, dy in nb:
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < self.w and 0 <= yy < self.h and snap[yy][xx] is not None:
                        self.p[y][x] = c
                        break
        return self

    def blit(self, o, ox=0, oy=0):
        for y in range(o.h):
            for x in range(o.w):
                c = o.p[y][x]
                if c is not None:
                    self.blend(ox + x, oy + y, c)
        return self

    def copy(self):
        s = Spr(self.w, self.h)
        s.p = [row[:] for row in self.p]
        return s

    def scaled(self, k):
        s = Spr(self.w * k, self.h * k)
        for y in range(self.h):
            for x in range(self.w):
                c = self.p[y][x]
                if c is not None:
                    s.rect(x * k, y * k, k, k, c)
        return s

    def ascii(self, rows, pal, ox=0, oy=0):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in pal and pal[ch] is not None:
                    self.set(ox + i, oy + j, pal[ch])
        return self

    def img(self):
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                c = self.p[y][x]
                if c is not None:
                    px[x, y] = c
        return im


# ================================================================== TILES
def via(s, x, y):
    s.set(x, y, G_VIA)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        s.set(x + dx, y + dy, G_TRACE_HI)


def ground(v):
    rng = random.Random(100 + v)
    s = Spr(16)
    s.rect(0, 0, 16, 16, G_BASE)
    for _ in range(9):
        s.set(rng.randrange(16), rng.randrange(16), G_DOT)
    for i in range(0, 16, 2):
        s.set(i, 0, G_EDGE)
        s.set(0, i, G_EDGE)
    s.set(0, 0, hx('14291f'))
    if v == 1:
        y = rng.choice([5, 10])
        s.hline(0, 15, y, G_TRACE)
        via(s, rng.randrange(4, 12), y)
    elif v == 2:
        x0 = rng.choice([4, 11])
        y0 = rng.choice([5, 10])
        s.vline(x0, 0, y0, G_TRACE)
        s.hline(x0, 15, y0, G_TRACE)
        via(s, x0, y0)
    elif v == 3:
        s.line(0, 12, 6, 6, G_TRACE)
        s.hline(6, 15, 6, G_TRACE)
        s.line(3, 15, 8, 10, G_TRACE)
        s.hline(8, 12, 10, G_TRACE)
        via(s, 12, 10)
    elif v == 4:
        s.rect(5, 5, 6, 5, hx('0a1311'))
        s.box(5, 5, 6, 5, hx('18282a'))
        for x in (6, 8, 10):
            s.set(x, 4, hx('2a3e38'))
            s.set(x, 10, hx('2a3e38'))
        s.set(6, 6, G_TRACE_HI)
    elif v == 5:
        for (x, y) in ((3, 3), (11, 4), (6, 11), (12, 12)):
            s.rect(x, y, 2, 2, G_TRACE)
            s.set(x, y, G_TRACE_HI)
    return s


def path_tile(mask):
    s = Spr(16)
    s.rect(0, 0, 16, 16, P_BASE)
    for y in range(2, 16, 4):
        for x in range(2, 16, 4):
            s.set(x, y, P_PAT)
    N, E, S, Wd = mask & 1, mask & 2, mask & 4, mask & 8
    for i in range(0, 8):
        if i % 4 == 3:
            continue
        if N:
            s.set(7, i, P_LANE); s.set(8, i, P_LANE)
        if S:
            s.set(7, 15 - i, P_LANE); s.set(8, 15 - i, P_LANE)
        if Wd:
            s.set(i, 7, P_LANE); s.set(i, 8, P_LANE)
        if E:
            s.set(15 - i, 7, P_LANE); s.set(15 - i, 8, P_LANE)
    s.rect(6, 6, 4, 4, P_LANE)
    s.rect(7, 7, 2, 2, hx('103a2c'))
    if not N:
        s.hline(0, 15, 0, P_EDGE); s.hline(1, 14, 1, P_EDGE2)
    if not S:
        s.hline(0, 15, 15, P_EDGE); s.hline(1, 14, 14, P_EDGE2)
    if not Wd:
        s.vline(0, 0, 15, P_EDGE); s.vline(1, 1, 14, P_EDGE2)
    if not E:
        s.vline(15, 0, 15, P_EDGE); s.vline(14, 1, 14, P_EDGE2)
    if N and E:
        s.set(15, 0, P_EDGE); s.set(14, 0, P_EDGE2); s.set(15, 1, P_EDGE2)
    if E and S:
        s.set(15, 15, P_EDGE); s.set(14, 15, P_EDGE2); s.set(15, 14, P_EDGE2)
    if S and Wd:
        s.set(0, 15, P_EDGE); s.set(1, 15, P_EDGE2); s.set(0, 14, P_EDGE2)
    if Wd and N:
        s.set(0, 0, P_EDGE); s.set(1, 0, P_EDGE2); s.set(0, 1, P_EDGE2)
    return s


def decor_server(f):
    s = Spr(16)
    s.rect(3, 1, 10, 14, MT[1])
    s.hline(3, 12, 1, MT[4])
    s.vline(3, 1, 14, MT[3])
    s.vline(12, 2, 14, MT[0])
    s.hline(4, 12, 14, MT[0])
    for i, y in enumerate(range(3, 13, 3)):
        s.rect(4, y, 8, 2, MT[0])
        s.set(5, y, GR[3] if (i + f) % 2 == 0 else GR[1])
        s.set(6, y, RD[3] if (i * 3 + f) % 4 == 0 else MT[2])
        s.set(7, y, CY[2] if (i + f) % 3 == 0 else MT[2])
        for x in range(8, 12, 1):
            if x % 2 == 0:
                s.set(x, y + 1, MT[2])
    s.outline(OUT)
    return s


def decor_chip(f):
    s = Spr(16)
    for x in (5, 7, 9, 11):
        s.vline(x - 1, 0, 3, G_TRACE)
    s.rect(3, 3, 10, 10, hx('0a0e11'))
    s.box(3, 3, 10, 10, MT[2])
    s.hline(4, 11, 3, MT[3])
    for i in (5, 7, 9, 11):
        s.set(i - 1, 2, MT[4]); s.set(i - 1, 13, MT[4])
        s.set(2, i - 1, MT[4]); s.set(13, i - 1, MT[4])
    s.set(5, 5, GR[2] if f == 0 else GR[3])
    s.hline(6, 10, 8, hx('1a2a2a'))
    s.hline(6, 9, 10, hx('1a2a2a'))
    s.outline(OUT)
    return s


def decor_fan(f):
    s = Spr(16)
    s.rect(1, 1, 14, 14, MT[2])
    s.bevel(MT[4], MT[0])
    s.disc(8, 8, 6, MT[0])
    for (x, y) in ((2, 2), (13, 2), (2, 13), (13, 13)):
        s.set(x, y, MT[5])
    c = MT[4]
    if f == 0:
        s.line(8, 3, 8, 13, c); s.line(3, 8, 13, 8, c)
        s.line(7, 3, 7, 6, MT[3]); s.line(9, 10, 9, 13, MT[3])
    else:
        s.line(4, 4, 12, 12, c); s.line(12, 4, 4, 12, c)
        s.line(5, 4, 7, 6, MT[3]); s.line(9, 10, 11, 12, MT[3])
    s.disc(8, 8, 1.6, GR[2])
    s.outline(OUT)
    return s


def decor_crystal(f):
    s = Spr(16)
    shards = [((5, 14), (3, 9), (5, 3), (7, 9)), ((9, 14), (7, 7), (10, 1), (12, 7)), ((12, 14), (11, 11), (13, 8), (15, 11))]
    for i, pts in enumerate(shards):
        t = Spr(16)
        t.poly(list(pts), CY[2] if i != 1 else GR[2])
        t.bevel(CY[4] if i != 1 else GR[4], CY[1] if i != 1 else GR[1])
        s.blit(t)
    if f == 1:
        s.set(10, 4, W)
        s.set(5, 6, W)
    s.hline(2, 15, 14, MT[1])
    s.outline(OUT)
    return s


def decor_cap(f):
    s = Spr(16)
    for (cx, cy, ramp) in ((5.5, 5.5, BL), (10.5, 10.5, [MT[1], MT[2], MT[3], MT[4]])):
        s.sdisc(cx, cy, 4, ramp[:4] if len(ramp) >= 4 else ramp)
        s.ring(cx, cy, 2.2, 3.0, MT[0])
        s.line(cx - 1, cy - 3, cx - 1, cy + 3, MT[5] if ramp is BL else YE[2])
    if f == 1:
        s.set(4, 4, W)
    s.outline(OUT)
    return s


def decor_terminal(f):
    s = Spr(16)
    s.rect(1, 2, 14, 10, MT[3])
    s.bevel(MT[5], MT[1])
    s.rect(2, 3, 12, 8, hx('020806'))
    s.hline(3, 9, 4, GR[1])
    s.hline(3, 11, 6, GR[1])
    s.hline(3, 7, 8, GR[2])
    if f == 0:
        s.rect(9, 8, 2, 1, GR[3])
    s.rect(6, 12, 4, 2, MT[2])
    s.rect(4, 14, 8, 1, MT[3])
    s.outline(OUT)
    return s


def spawn_portal(f):
    s = Spr(16)
    c = 7.5
    for y in range(16):
        for x in range(16):
            dx, dy = x + 0.5 - 8, y + 0.5 - 8
            d = math.hypot(dx, dy)
            a = math.atan2(dy, dx)
            if 5.2 <= d <= 7.2:
                seg = int(math.floor((a + math.pi + f * math.pi / 8) / (math.pi / 4)))
                s.set(x, y, MG[3] if seg % 2 == 0 else MG[1])
            elif 3.0 <= d < 5.2:
                spiral = (a * 2 + d * 1.1 - f * math.pi / 2) % (2 * math.pi)
                s.set(x, y, PU[2] if spiral < math.pi else PU[0])
            elif d < 3.0:
                s.set(x, y, RD[3] if (f % 2 == 0) else MG[3])
                if d < 1.5:
                    s.set(x, y, W if f % 2 == 0 else MG[4])
    return s


def core_sprite(f):
    s = Spr(16)
    for i in range(3, 13, 2):
        for (x, y) in ((i, 1), (i, 14), (1, i), (14, i)):
            s.set(x, y, CY[2])
        s.set(i, 0, CY[1]); s.set(i, 15, CY[1]); s.set(0, i, CY[1]); s.set(15, i, CY[1])
    s.rect(2, 2, 12, 12, MT[1])
    s.box(2, 2, 12, 12, MT[3])
    s.hline(2, 13, 2, MT[4])
    s.box(4, 4, 8, 8, CY[1])
    glow = [CY[2], CY[3], CY[4], CY[3]][f]
    s.poly([(8, 4.5), (11.5, 8), (8, 11.5), (4.5, 8)], glow)
    s.poly([(8, 6), (10, 8), (8, 10), (6, 8)], W if f == 2 else CY[4])
    for (x, y) in ((3, 3), (12, 3), (3, 12), (12, 12)):
        s.set(x, y, GR[3] if (f % 2 == 0) else GR[1])
    return s


def build_marker(ok):
    s = Spr(16)
    c = GR[3] if ok else RD[3]
    for (x, y, dx, dy) in ((0, 0, 1, 1), (15, 0, -1, 1), (0, 15, 1, -1), (15, 15, -1, -1)):
        for i in range(4):
            s.set(x + dx * i, y, c)
            s.set(x, y + dy * i, c)
    if not ok:
        s.line(5, 5, 10, 10, alpha(c, 200))
        s.line(10, 5, 5, 10, alpha(c, 200))
    return s


# ================================================================== TOWERS
TOWER_ACC = {
    'pulse': GR, 'beam': CY, 'bomb': OR, 'ice': IC,
    'arc': MG, 'sniper': RD, 'hub': YE, 'miner': YE,
}


def tower_base(acc, lvl):
    s = Spr(16)

    def inside(x, y):
        if x < 1 or x > 14 or y < 1 or y > 14:
            return False
        a, b = x - 1, y - 1
        c, d = 14 - x, 14 - y
        return a + b >= 3 and c + b >= 3 and a + d >= 3 and c + d >= 3

    for y in range(16):
        for x in range(16):
            if inside(x, y):
                s.set(x, y, MT[2])
    s.bevel(MT[4], MT[0])
    s.ring(8, 8, 4.6, 5.6, MT[1])
    for (x, y) in ((3, 3), (12, 3), (3, 12), (12, 12)):
        s.set(x, y, MT[3])
    light = acc[3] if lvl >= 2 else acc[2]
    for (x, y) in ((7, 2), (8, 2), (2, 7), (2, 8), (13, 7), (13, 8)):
        s.set(x, y, light)
    if lvl >= 2:
        for (x, y) in ((4, 4), (11, 4), (4, 11), (11, 11)):
            s.set(x, y, acc[1] if lvl == 2 else acc[3])
    if lvl >= 3:
        s.hline(5, 10, 1, acc[1])
        s.vline(1, 5, 10, acc[1])
        s.vline(14, 5, 10, acc[1])
    pip = {1: [7], 2: [5, 9], 3: [4, 7, 10]}[lvl]
    for px in pip:
        s.rect(px, 13, 2, 1, YE[3] if lvl == 3 else acc[3])
    s.outline(OUT, diag=False)
    return s


def head_pulse(l):
    s = Spr(16)
    if l == 1:
        s.rect(8, 7, 6, 2, MT[3]); s.hline(8, 13, 7, MT[5]); s.rect(13, 7, 1, 2, GR[3])
    elif l == 2:
        s.rect(8, 6, 7, 3, MT[3]); s.hline(8, 14, 6, MT[5]); s.rect(14, 6, 1, 3, GR[3])
        s.rect(10, 5, 2, 1, MT[4]); s.rect(10, 9, 2, 1, MT[2])
    else:
        for y in (5, 9):
            s.rect(8, y, 7, 2, MT[3]); s.hline(8, 14, y, MT[5]); s.rect(14, y, 1, 2, GR[3])
        s.rect(8, 7, 4, 2, MT[2])
    r = 3.6 + 0.45 * (l - 1)
    s.sdisc(7.5, 8, r, [MT[1], MT[2], MT[3], MT[4]])
    s.sdisc(7.5, 8, r - 1.5, [GR[0], GR[1], GR[2], GR[3]])
    s.set(6, 6 if l < 3 else 5, GR[4])
    s.outline(OUT)
    return s


def head_beam(l):
    s = Spr(16)
    s.rect(9, 7, 5, 2, MT[3]); s.hline(9, 13, 7, MT[5])
    if l >= 2:
        s.rect(9, 5, 4, 1, MT[4]); s.rect(9, 10, 4, 1, MT[4])
        s.set(12, 5, CY[3]); s.set(12, 10, CY[3])
    if l >= 3:
        s.rect(10, 4, 3, 1, CY[2]); s.rect(10, 11, 3, 1, CY[2])
    s.rect(13, 6, 2, 4, CY[2]); s.set(14, 7, CY[4]); s.set(14, 8, CY[3]); s.set(13, 6, CY[3])
    rad = 4.2 + (0.8 if l >= 2 else 0)
    body = Spr(16)
    for y in range(16):
        for x in range(16):
            if abs(x + 0.5 - 7) + abs(y + 0.5 - 8) <= rad:
                body.set(x, y, MT[2])
    body.bevel(MT[4], MT[1])
    s.blit(body)
    cr = 2.0 + 0.5 * (l - 1)
    for y in range(16):
        for x in range(16):
            v = abs(x + 0.5 - 7) + abs(y + 0.5 - 8)
            if v <= cr:
                s.set(x, y, CY[3] if (x + 0.5 - 7) + (y + 0.5 - 8) < 0 else CY[2])
    s.set(6, 7, CY[4])
    s.outline(OUT)
    return s


def head_bomb(l):
    s = Spr(16)
    tubes = [(5, 6)] if l == 1 else ([(4, 8)] if l == 2 else [(3, 5), (9, 5)])
    for (y, h) in tubes:
        t = Spr(16)
        t.rect(7, y, 7, h, MT[3])
        t.bevel(MT[5], MT[1])
        s.blit(t)
        s.vline(9, y + 1, y + h - 2, OR[2])
        s.vline(11, y + 1, y + h - 2, OR[2])
        s.rect(13, y + 1, 1, h - 2, K)
        s.vline(14, y, y + h - 1, OR[3])
    s.sdisc(6, 8, 3.8 + 0.3 * l, [MT[1], MT[2], MT[3], MT[4]])
    s.rect(4, 7, 3, 2, OR[2])
    s.set(4, 7, OR[4])
    s.outline(OUT)
    return s


def head_ice(l):
    s = Spr(16)
    c = (7.5, 7.5)
    R = 4.2 + l * 1.0
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6
        ex = c[0] + math.cos(a) * R
        ey = c[1] + math.sin(a) * R
        s.line(c[0], c[1], ex, ey, IC[2])
        s.set(ex, ey, IC[4])
        if l >= 2:
            mx = c[0] + math.cos(a) * R * 0.6
            my = c[1] + math.sin(a) * R * 0.6
            for da in (-0.9, 0.9):
                s.line(mx, my, mx + math.cos(a + da) * 1.8, my + math.sin(a + da) * 1.8, IC[3])
    if l >= 3:
        for k in range(12):
            a = k * math.pi / 6
            s.set(c[0] + math.cos(a) * 7.0, c[1] + math.sin(a) * 7.0, IC[1])
    s.sdisc(7.5, 7.5, 2.4 + 0.3 * l, [IC[1], IC[2], IC[3], IC[4]])
    s.set(6, 6, W)
    s.outline(hx('04121a'))
    return s


def head_arc(l):
    s = Spr(16)
    if l >= 3:
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 4
            x0, y0 = 7.5 + math.cos(a) * 4.0, 7.5 + math.sin(a) * 4.0
            x1, y1 = 7.5 + math.cos(a) * 6.6, 7.5 + math.sin(a) * 6.6
            s.line(x0, y0, x1, y1, MT[4])
            s.set(x1, y1, MG[3])
    if l >= 2:
        s.ring(7.5, 7.5, 4.6, 5.5, MT[3])
    s.sdisc(7.5, 7.5, 4.2, [MT[1], MT[2], MT[3], MT[4]])
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 7.5, y + 0.5 - 7.5)
            if 2.6 <= d <= 3.6:
                a = math.atan2(y + 0.5 - 7.5, x + 0.5 - 7.5)
                s.set(x, y, PU[3] if int((a + math.pi) / (math.pi / 4)) % 2 == 0 else PU[1])
    s.sdisc(7.5, 7.5, 2.1, [MG[1], MG[2], MG[3], MG[4]])
    s.set(7, 7, W)
    s.outline(OUT)
    return s


def head_sniper(l):
    s = Spr(16)
    end = 14 if l == 1 else 15
    s.hline(8, end, 7, MT[4])
    s.hline(8, end, 8, MT[2])
    if l >= 3:
        s.hline(8, end, 6, MT[3])
    if l >= 2:
        s.rect(13, 6, 2, 4, MT[3]); s.set(13, 6, MT[5])
    s.set(end, 7, RD[3] if l >= 2 else MT[5])
    if l >= 3:
        s.set(end, 6, RD[4]); s.set(end, 8, RD[2])
    body = Spr(16)
    body.rect(3, 5, 7, 6, MT[2])
    body.rect(1, 6, 2, 4, MT[1])
    body.bevel(MT[4], MT[0])
    s.blit(body)
    s.rect(4, 3, 5, 2, MT[1]); s.hline(4, 8, 3, MT[3])
    s.set(9, 3, RD[3]); s.set(9, 4, RD[2])
    s.rect(5, 7, 3, 2, RD[1] if l < 3 else RD[2])
    s.outline(OUT)
    return s


def head_hub(l):
    s = Spr(16)
    for y in range(16):
        for x in range(16):
            dx, dy = x + 0.5 - 5.0, y + 0.5 - 8.0
            d = math.hypot(dx, dy)
            if 5.0 <= d <= 6.6 and dx > 1.2:
                s.set(x, y, YE[3] if dy < 0 else YE[2])
            elif 4.0 <= d < 5.0 and dx > 1.8:
                s.set(x, y, YE[1])
    s.line(6, 8, 12, 8, MT[4])
    s.set(12, 8, YE[4]); s.set(12, 7, YE[3])
    s.sdisc(6, 8, 2.8, [MT[1], MT[2], MT[3], MT[4]])
    if l >= 2:
        s.set(3, 6, GR[3]); s.set(3, 10, GR[3])
    if l >= 3:
        s.ring(6, 8, 2.8, 3.4, YE[2])
    s.set(6, 8, YE[3])
    s.outline(OUT)
    return s


def head_miner(l, f):
    s = Spr(16)
    body = Spr(16)
    if l == 1:
        body.rect(3, 3, 10, 10, MT[2])
    else:
        body.rect(2, 3, 12, 10, MT[2])
    body.bevel(MT[4], MT[0])
    s.blit(body)
    if l >= 3:
        s.box(2, 3, 12, 10, YE[2])
        s.hline(2, 13, 3, YE[3])
    fans = [(8, 8)] if l == 1 else [(5.5, 8), (10.5, 8)]
    fr = 3.0 if l == 1 else 2.4
    for (cx, cy) in fans:
        s.disc(cx, cy, fr, MT[0])
        c = MT[4]
        if f == 0:
            s.line(cx - fr + 1, cy, cx + fr - 1, cy, c); s.line(cx, cy - fr + 1, cx, cy + fr - 1, c)
        else:
            k = (fr - 1) * 0.7
            s.line(cx - k, cy - k, cx + k, cy + k, c); s.line(cx + k, cy - k, cx - k, cy + k, c)
        s.set(cx, cy, YE[3])
    s.set(4 if l == 1 else 3, 11, GR[3] if f == 0 else GR[1])
    s.set(11 if l == 1 else 12, 11, YE[3] if f == 1 else YE[1])
    s.outline(OUT)
    return s


# ================================================================= ENEMIES
def en_crawler(f):
    s = Spr(16)
    off = [0, 1, 0, -1][f]
    for i, lx in enumerate([5, 8, 11]):
        o = off if i % 2 == 0 else -off
        s.line(lx, 6, lx - 1 + o, 2, RD[1])
        s.line(lx, 9, lx - 1 - o, 13, RD[1])
        s.set(lx - 1 + o, 2, RD[2])
        s.set(lx - 1 - o, 13, RD[2])
    s.sellipse(7.0, 8, 4.6, 3.3, [RD[1], RD[2], RD[3], RD[4]])
    s.sdisc(12, 8, 2.4, [RD[1], RD[2], RD[3], RD[4]])
    s.vline(6, 6, 9, RD[1])
    s.vline(8, 6, 9, RD[1])
    s.set(13, 6, YE[3]); s.set(13, 9, YE[3])
    s.set(14, 7, RD[4]); s.set(14, 8, RD[4])
    s.outline(OUT)
    return s


def en_worm(f):
    s = Spr(16)
    ph = f * math.pi / 2
    segs = [(2.8, 1.7), (5.6, 2.0), (8.5, 2.3), (11.6, 2.8)]
    hy = 8
    for i, (x, r) in enumerate(segs):
        amp = 1.6 if i < 3 else 0.7
        y = 8 + math.sin(ph + i * 1.4) * amp
        s.sdisc(x, y, r, [MG[1], MG[2], MG[3], MG[4]])
        if i < 3:
            s.set(x + r - 0.5, y, MG[1])
        else:
            hy = y
    s.set(13, hy - 1.5, YE[3]); s.set(13, hy + 1.0, YE[3])
    s.set(14.6, hy - 1.6, MG[4]); s.set(14.6, hy + 1.2, MG[4])
    s.outline(OUT)
    return s


def en_spam(f):
    s = Spr(16)
    bob = [0, -1, 0, 1][f]
    up = f % 2 == 0
    if up:
        s.line(5, 7 + bob, 2, 4 + bob, W); s.line(4, 7 + bob, 2, 5 + bob, IC[3])
        s.line(11, 7 + bob, 14, 4 + bob, W); s.line(12, 7 + bob, 14, 5 + bob, IC[3])
    else:
        s.line(5, 8 + bob, 2, 10 + bob, W); s.line(11, 8 + bob, 14, 10 + bob, W)
    s.rect(5, 6 + bob, 7, 5, YE[2])
    s.hline(5, 11, 6 + bob, YE[3])
    s.line(5, 6 + bob, 8, 9 + bob, YE[1]); s.line(11, 6 + bob, 8, 9 + bob, YE[1])
    s.set(7, 10 + bob, RD[2]); s.set(9, 10 + bob, RD[2])
    s.outline(OUT)
    return s


def en_trojan(f):
    s = Spr(16)
    for (y0, y1) in ((2, 4), (11, 13)):
        s.rect(2, y0, 12, y1 - y0 + 1, MT[1])
        for x in range(2, 14):
            if (x + f) % 3 == 0:
                s.vline(x, y0, y1, MT[3])
    hull = Spr(16)
    hull.rect(3, 4, 10, 8, MT[3])
    hull.poly([(13, 4.5), (15, 6), (15, 10), (13, 11.5)], MT[3])
    hull.bevel(MT[5], MT[1])
    s.blit(hull)
    s.rect(4, 5, 4, 6, OR[1]); s.hline(4, 7, 5, OR[2])
    s.rect(9, 5, 3, 6, OR[1]); s.hline(9, 11, 5, OR[2])
    s.vline(14, 6, 9, RD[3] if f % 2 == 0 else RD[4])
    s.sdisc(7.5, 8, 2.2, [MT[1], MT[2], MT[3], MT[4]])
    s.set(7, 7, OR[3])
    s.outline(OUT)
    return s


def en_phantom(f):
    s = Spr(16)
    ramp = [PU[1], PU[2], PU[3], PU[4]]
    s.sdisc(8, 7, 4.8, ramp)
    for y in range(7, 12):
        for x in range(3, 13):
            s.set(x, y, PU[3] if x < 6 else (PU[2] if x < 11 else PU[1]))
    for x in range(3, 13):
        if ((x + f) // 2) % 2 == 0:
            s.set(x, 12, PU[2]); s.set(x, 13, PU[1])
        else:
            s.set(x, 12, PU[1])
    s.rect(5, 6, 2, 3, K); s.rect(9, 6, 2, 3, K)
    s.set(5, 7, MG[3]); s.set(9, 7, MG[3])
    s.outline(PU[0])
    return s


def en_glitch(f):
    rng = random.Random(77 + f * 13)
    s = Spr(16)
    shape = Spr(16)
    shape.rect(4, 4, 8, 8, MG[2])
    shape.rect(3, 6, 10, 4, MG[2])
    shape.rect(6, 3, 4, 10, MG[2])
    for _ in range(6):
        shape.set(rng.randrange(3, 13), rng.randrange(3, 13), None)
    red = Spr(16); cyan = Spr(16)
    for y in range(16):
        for x in range(16):
            if shape.p[y][x] is not None:
                red.set(x + 1, y, MG[3])
                cyan.set(x - 1, y, CY[3])
    s.blit(cyan); s.blit(red)
    for y in range(16):
        for x in range(16):
            if shape.p[y][x] is not None:
                s.set(x, y, PU[2] if (x + y + f) % 3 else PU[3])
    s.rect(6, 6, 4, 4, K)
    s.rect(7, 7, 2, 2, W if f % 2 == 0 else CY[4])
    for _ in range(2):
        y0 = rng.randrange(3, 12)
        dx = rng.choice([-2, -1, 1, 2])
        row = [s.p[y0][x] for x in range(16)]
        for x in range(16):
            s.p[y0][x] = row[(x - dx) % 16]
    for _ in range(5):
        s.set(rng.randrange(1, 15), rng.randrange(1, 15), rng.choice([W, CY[3], MG[3], GR[3]]))
    return s


def en_shield(f):
    s = Spr(16)
    rot = [(3.5, 3.5), (12.5, 3.5), (3.5, 12.5), (12.5, 12.5)]
    for (x, y) in rot:
        s.line(8, 8, x, y, MT[3])
    for (x, y) in rot:
        s.disc(x, y, 2.3, MT[1])
        if f % 2 == 0:
            s.hline(int(x) - 2, int(x) + 2, int(y), BL[3])
        else:
            s.vline(int(x), int(y) - 2, int(y) + 2, BL[3])
    hexs = Spr(16)
    pts = [(8 + math.cos(k * math.pi / 3) * 4.6, 8 + math.sin(k * math.pi / 3) * 4.6) for k in range(6)]
    hexs.poly(pts, BL[2])
    hexs.bevel(BL[3], BL[1])
    s.blit(hexs)
    s.disc(8, 8, 1.8, BL[4] if f in (0, 1) else W)
    s.outline(OUT)
    return s


def en_patcher(f):
    s = Spr(16)
    s.line(8, 3, 8, 1, MT[4]); s.set(8, 1, MINT if f % 2 == 0 else W)
    s.sdisc(8, 8.5, 5.2, PK)
    cross = [W, MINT, W, hx('c8ffe0')][f]
    s.rect(7, 5, 2, 7, cross)
    s.rect(5, 7, 6, 2, cross)
    s.outline(OUT)
    return s


def en_rootkit(f):
    s = Spr(24)
    BR = [hx('1a0306'), hx('3d0810'), hx('6e0f1e'), hx('a3172d')]
    for i, lx in enumerate([8, 11, 14, 17]):
        o = [0, 1, 0, -1][(f + i) % 4]
        s.line(lx, 10, lx - 2 + o, 5, RD[1]); s.line(lx - 2 + o, 5, lx - 4 + o, 1, RD[2])
        s.line(lx, 13, lx - 2 - o, 18, RD[1]); s.line(lx - 2 - o, 18, lx - 4 - o, 22, RD[2])
    s.sellipse(8, 12, 6.5, 5.2, BR)
    s.sdisc(16.5, 12, 4.8, [MT[0], MT[1], MT[2], MT[3]])
    for (x, y) in ((4, 8), (7, 7), (10, 8), (5, 16), (9, 16)):
        s.set(x, y, MT[4])
    s.line(3, 12, 13, 12, RD[2])
    s.line(8, 8, 8, 16, RD[2])
    s.disc(8, 12, 1.8, [RD[2], RD[3], RD[4], RD[3]][f])
    for (x, y) in ((19, 9), (20, 11), (20, 12), (19, 14)):
        s.set(x, y, RD[3] if (f % 2 == 0) else YE[3])
    s.set(21, 11, RD[4]); s.set(21, 12, RD[4])
    s.outline(OUT)
    return s


def en_kernel(f):
    s = Spr(32)
    c = 16
    for k in range(8):
        a = k * math.pi / 4 + f * math.pi / 16
        for t in range(9, 16):
            wdt = max(0, (15 - t) * 0.35)
            px = c + math.cos(a) * t
            py = c + math.sin(a) * t
            col = MT[3] if t < 14 else RD[3]
            s.set(px, py, col)
            if wdt > 0.6:
                s.set(px + math.cos(a + math.pi / 2) * 0.8, py + math.sin(a + math.pi / 2) * 0.8, MT[2])
    s.sdisc(c, c, 11, [hx('14060a'), hx('2e0a12'), hx('4d0f1c'), hx('6e1626')])
    for k in range(12):
        a = k * math.pi / 6
        lit = (k + f) % 3 == 0
        s.set(c + math.cos(a) * 9.4, c + math.sin(a) * 9.4, RD[3] if lit else RD[1])
    s.disc(c, c, 7.2, hx('120406'))
    s.sdisc(c, c, 6.4, [RD[1], RD[2], RD[3], RD[4]])
    ph = [3, 4, 5, 4][f]
    s.rect(15, c - ph, 2, ph * 2, K)
    s.set(15, c - ph - 1, RD[1]); s.set(16, c + ph, RD[1])
    s.rect(12, 12, 2, 2, W)
    s.outline(OUT)
    return s


# ======================================================= PROJECTILES / FX
def glow(col):
    s = Spr(16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 8)
            a = 0
            if d < 2.2:
                a = 210
            elif d < 4.2:
                a = 120
            elif d < 6.2:
                a = 60
            elif d < 8:
                a = 22
            if a:
                s.set(x, y, alpha(col, a))
    return s


def proj_pulse(l):
    s = Spr(8)
    if l < 3:
        s.hline(1, 3, 3, GR[1]); s.hline(1, 3, 4, GR[1])
        s.rect(4, 3, 3, 2, GR[3]); s.set(6, 3, W); s.set(6, 4, GR[4])
    else:
        s.hline(0, 2, 3, GR[1]); s.hline(0, 2, 4, GR[1])
        s.rect(3, 2, 4, 4, GR[3]); s.rect(5, 3, 2, 2, W)
    return s


def proj_bomb(l):
    s = Spr(8)
    s.sdisc(4, 4, 2.8, [OR[1], OR[2], OR[3], OR[4]])
    s.set(3, 3, W)
    if l >= 3:
        s.set(5, 5, RD[3])
    s.outline(OUT)
    return s


def proj_dart():
    s = Spr(8)
    s.hline(0, 6, 3, RD[2]); s.hline(2, 7, 4, RD[3]); s.set(7, 3, W)
    return s


def fx_explode(f):
    rng = random.Random(500 + f)
    s = Spr(24)
    c = 12
    R = 3 + f * 1.45
    for y in range(24):
        for x in range(24):
            d = math.hypot(x + 0.5 - c, y + 0.5 - c) + rng.random() * 1.3
            col = None
            if f <= 2:
                if d < R * 0.45:
                    col = W
                elif d < R * 0.75:
                    col = YE[3]
                elif d < R:
                    col = OR[3]
            elif f <= 4:
                if d < R * 0.3:
                    col = YE[3] if f == 3 else OR[3]
                elif d < R * 0.55 and rng.random() < 0.55:
                    col = OR[2]
                elif R - 2.6 < d < R:
                    col = OR[3] if f == 3 else RD[3]
            else:
                if R - 1.8 < d < R and (x + y + f) % 2 == 0:
                    col = hx('5a4a4a') if f == 5 else hx('2e3a34')
                elif d < R * 0.4 and rng.random() < 0.15:
                    col = OR[1]
            if col:
                s.set(x, y, col)
    for _ in range(4 + f):
        a = rng.random() * math.tau
        r = R + rng.random() * 2
        s.set(c + math.cos(a) * r, c + math.sin(a) * r, YE[3] if f < 4 else OR[2])
    return s


def fx_spark(f, ramp):
    s = Spr(8)
    L = f + 1
    col = [W, ramp[4] if len(ramp) > 4 else ramp[-1], ramp[3], ramp[2]][f]
    for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        diag = dx != 0 and dy != 0
        n = L - (1 if diag else 0)
        for i in range(max(0, f - 1), n + 1):
            if i == 0:
                continue
            s.set(4 + dx * i, 4 + dy * i, col)
    if f < 2:
        s.set(4, 4, W)
    return s


def fx_bits(f):
    s = Spr(8)
    w = [3.0, 2.0, 0.9, 2.0][f]
    s.ellipse(4, 4, w, 3.2, GR[2])
    if w > 1:
        s.ellipse(4, 4, max(0.6, w - 1), 2.2, GR[3])
        s.vline(4, 3, 5, W)
    else:
        s.vline(4, 1, 6, GR[4])
    s.outline(OUT)
    return s


def fx_upgrade(f):
    s = Spr(16)
    a = [255, 230, 170, 90][f]
    for k, base in enumerate((10, 5)):
        y = base - f * 2
        col = alpha(GR[3] if k == 0 else GR[4], a)
        for i in range(4):
            s.set(8 - i, y + i, col); s.set(7 + i, y + i, col)
    return s


def fx_stun(f):
    s = Spr(12, 6)
    for k in range(3):
        a = f * math.pi / 6 + k * math.tau / 3
        x = 6 + math.cos(a) * 4.2
        y = 3 + math.sin(a) * 1.6
        s.set(x, y, YE[3] if k != 1 else CY[3])
        s.set(x, y - 1, alpha(W, 150))
    return s


def fx_shield():
    s = Spr(16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 8)
            if 6.8 <= d <= 7.9:
                s.set(x, y, alpha(BL[3], 210))
            elif d < 6.8:
                s.set(x, y, alpha(BL[2], 40))
    s.set(4, 4, alpha(W, 220)); s.set(5, 3, alpha(W, 220)); s.set(3, 5, alpha(W, 180))
    return s


def fx_heal():
    s = Spr(8)
    s.rect(3, 1, 2, 6, MINT); s.rect(1, 3, 6, 2, MINT)
    s.set(3, 1, W)
    s.outline(alpha(OUT, 160))
    return s


def fx_burn(f):
    rng = random.Random(900 + f)
    s = Spr(16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 8)
            if d < 7.5 and rng.random() < 0.32 * (1 - d / 9):
                s.set(x, y, alpha(rng.choice([MG[3], OR[3], PU[3], MG[2], OR[2]]), 200))
    for _ in range(4):
        x = rng.randrange(3, 13)
        y = rng.randrange(4, 12)
        s.set(x, y, alpha(YE[3], 230)); s.set(x, y - 1, alpha(OR[3], 180)); s.set(x, y - 2, alpha(MG[3], 120))
    return s


# ================================================================== ICONS
def ico(fn):
    s = Spr(16)
    fn(s)
    return s


def i_bits(s):
    pts = [(8 + math.cos(k * math.pi / 3) * 6.8, 8 + math.sin(k * math.pi / 3) * 6.8) for k in range(6)]
    t = Spr(16)
    t.poly(pts, GR[2])
    t.bevel(GR[4], GR[1])
    s.blit(t)
    inner = [(8 + math.cos(k * math.pi / 3) * 3.6, 8 + math.sin(k * math.pi / 3) * 3.6) for k in range(6)]
    s.poly(inner, GR[1])
    s.vline(8, 6, 9, GR[4]); s.set(7, 6, GR[4])
    s.outline(OUT)


def i_heart(s):
    s.ascii([
        "................",
        "................",
        "...KKK....KKK...",
        "..KRRRK..KRRRK..",
        ".KRHHRRKKRRRRRK.",
        ".KRHRRRRRRRRRRK.",
        ".KRRRRRRRRRRRRK.",
        ".KRRRRRRRRRRRDK.",
        "..KRRRRRRRRRDK..",
        "...KRRRRRRRDK...",
        "....KRRRRRDK....",
        ".....KRRRDK.....",
        "......KRDK......",
        ".......KK.......",
        "................",
        "................",
    ], {'K': OUT, 'R': RD[3], 'H': RD[4], 'D': RD[2]})


def i_skull(s):
    s.ascii([
        "................",
        ".....KKKKKK.....",
        "...KKWWWWWWKK...",
        "..KWWWWWWWWWWK..",
        "..KWWWWWWWWWGK..",
        "..KWKKKWWKKKGK..",
        "..KWKRKWWKRKGK..",
        "..KWKKKWWKKKGK..",
        "..KWWWWKKWWWGK..",
        "...KWWWKKWWGK...",
        "....KWWWWWGK....",
        "....KWKWWKWK....",
        "....KWKWWKWK....",
        ".....KKKKKK.....",
        "................",
        "................",
    ], {'K': OUT, 'W': hx('d8f0e0'), 'G': hx('8aa898'), 'R': RD[3]})


def i_bolt(col):
    def f(s):
        t = Spr(16)
        t.poly([(10, 0.5), (3.5, 9), (7.5, 9), (5.5, 15.5), (12.5, 6), (8.5, 6), (11, 0.5)], col[3])
        t.bevel(col[4], col[2])
        s.blit(t)
        s.outline(OUT)
    return f


def i_purge(s):
    s.ring(8, 8, 4.6, 5.8, RD[3])
    for i in range(0, 4):
        s.set(8, i, RD[3]); s.set(7, i, RD[2])
        s.set(8, 15 - i, RD[3]); s.set(7, 15 - i, RD[2])
        s.set(i, 8, RD[3]); s.set(i, 7, RD[2])
        s.set(15 - i, 8, RD[3]); s.set(15 - i, 7, RD[2])
    s.rect(7, 7, 2, 2, W)
    s.outline(OUT)


def i_overclock(s):
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 9)
            a = math.degrees(math.atan2(y + 0.5 - 9, x + 0.5 - 8))
            if 5.0 <= d <= 6.6 and not (40 < a < 140):
                col = YE[3] if a < -60 or a > 140 else (OR[3] if a < 40 and a > -60 else YE[2])
                if a > -60 and a < 40:
                    col = RD[3] if a > -10 else OR[3]
                s.set(x, y, col)
    s.line(8, 9, 12, 5, W)
    s.disc(8, 9, 1.6, MT[4])
    s.outline(OUT)


def i_up(s):
    t = Spr(16)
    t.poly([(8, 1.5), (14.5, 8.5), (10.5, 8.5), (10.5, 14.5), (5.5, 14.5), (5.5, 8.5), (1.5, 8.5)], GR[3])
    t.bevel(GR[4], GR[2])
    s.blit(t)
    s.outline(OUT)


def i_sell(s):
    t = Spr(16)
    t.rect(3, 5, 10, 10, MT[3])
    t.bevel(MT[5], MT[1])
    s.blit(t)
    s.rect(2, 3, 12, 2, RD[3]); s.hline(2, 13, 3, RD[4])
    s.rect(6, 1, 4, 2, RD[2])
    for x in (5, 8, 11):
        s.vline(x - 0 if x != 11 else 10, 7, 12, MT[1])
    s.outline(OUT)


def i_target(s):
    s.ring(8, 8, 4.4, 5.6, W)
    s.hline(1, 4, 8, W); s.hline(11, 14, 8, W)
    s.vline(8, 1, 4, W); s.vline(8, 11, 14, W)
    s.rect(7, 7, 2, 2, RD[3])
    s.outline(OUT)


def star_pts(cx, cy, r0, r1):
    pts = []
    for k in range(10):
        a = -math.pi / 2 + k * math.pi / 5
        r = r0 if k % 2 == 0 else r1
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def i_star(on):
    def f(s):
        t = Spr(16)
        t.poly(star_pts(8, 8.6, 7.6, 3.2), YE[3] if on else MT[2])
        t.bevel(YE[4] if on else MT[3], YE[2] if on else MT[1])
        s.blit(t)
        s.outline(OUT)
    return f


def i_lock(s):
    s.ring(8, 6, 2.6, 4.0, MT[4])
    s.rect(3, 7, 10, 8, YE[2])
    s.bevel(YE[3], YE[1])
    s.rect(7, 9, 2, 3, K)
    s.outline(OUT)


def i_pause(s):
    s.rect(4, 3, 3, 10, W); s.rect(9, 3, 3, 10, W)
    s.outline(OUT)


def i_play(s):
    s.poly([(4, 2.5), (13, 8), (4, 13.5)], W)
    s.outline(OUT)


def i_ff(s):
    s.poly([(1.5, 3), (8, 8), (1.5, 13)], W)
    s.poly([(8, 3), (14.5, 8), (8, 13)], W)
    s.outline(OUT)


def i_gear(s):
    for y in range(16):
        for x in range(16):
            dx, dy = x + 0.5 - 8, y + 0.5 - 8
            d = math.hypot(dx, dy)
            a = math.atan2(dy, dx)
            tooth = (math.cos(a * 8) > 0.2)
            if d <= 5.0 or (d <= 7.0 and tooth):
                s.set(x, y, MT[4] if dy < 0 else MT[3])
    s.disc(8, 8, 2.2, None)
    for y in range(16):
        for x in range(16):
            if math.hypot(x + 0.5 - 8, y + 0.5 - 8) <= 2.2:
                s.erase(x, y)
    s.outline(OUT)


def i_close(s):
    for d in range(-1, 1):
        s.line(3 + d, 3, 12 + d, 12, RD[3])
        s.line(12 + d, 3, 3 + d, 12, RD[3])
    s.outline(OUT)


def i_db(s):
    for (y, c) in ((11, GR[1]), (7.5, GR[2]), (4, GR[3])):
        s.rect(3, int(y), 10, 4, c)
        s.ellipse(8, y + 4, 5, 1.6, c)
        s.ellipse(8, y, 5, 1.6, GR[4] if y == 4 else c)
    s.outline(OUT)


def i_info(s):
    s.disc(8, 8, 7, CY[2])
    s.rect(7, 7, 2, 5, W)
    s.rect(7, 4, 2, 2, W)
    s.outline(OUT)


def i_sound(s):
    s.rect(2, 6, 3, 4, W)
    s.poly([(5, 6), (9, 2.5), (9, 13.5), (5, 10)], W)
    s.line(11, 5, 12, 6, W); s.line(12, 7, 12, 9, W); s.line(12, 10, 11, 11, W)
    s.outline(OUT)


def i_music(s):
    s.vline(6, 2, 11, W); s.vline(13, 1, 10, W)
    s.hline(6, 13, 2, W); s.hline(6, 13, 1, W)
    s.ellipse(4.5, 12, 2.4, 1.8, W); s.ellipse(11.5, 11, 2.4, 1.8, W)
    s.outline(OUT)


# ================================================================== GLYPHS
DIGITS = [
    [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
    ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
]


def glyph(i, col):
    """Matrix-rain glyphs: mirrored digits + procedurally stroked pseudo-katakana."""
    g = Spr(6, 8)
    if i < len(DIGITS):
        for y, row in enumerate(DIGITS[i]):
            for x, ch in enumerate(row):
                if ch == '#':
                    g.set(4 - x, y, col)
        return g
    rng = random.Random(9000 + i)
    count = 0
    tries = 0
    while count < 10 and tries < 60:
        tries += 1
        kind = rng.choice(['h', 'h', 'v', 'v', 'd1', 'd2', 'hook', 'box'])
        if kind == 'h':
            y = rng.randrange(7)
            x0 = rng.randrange(0, 3)
            x1 = rng.randrange(x0 + 2, 5)
            g.hline(x0, x1, y, col)
        elif kind == 'v':
            x = rng.randrange(5)
            y0 = rng.randrange(0, 4)
            y1 = rng.randrange(y0 + 2, 7)
            g.vline(x, y0, y1, col)
        elif kind == 'd1':
            x = rng.randrange(2, 5)
            y = rng.randrange(0, 4)
            g.line(x, y, x - 2, y + 3, col)
        elif kind == 'd2':
            x = rng.randrange(0, 3)
            y = rng.randrange(0, 4)
            g.line(x, y, x + 2, y + 3, col)
        elif kind == 'box':
            x = rng.randrange(0, 2)
            y = rng.randrange(0, 3)
            g.box(x, y, 3 + rng.randrange(2), 3 + rng.randrange(2), col)
        else:
            x = rng.randrange(1, 4)
            g.hline(x - 1, x + 1, 1, col)
            g.vline(x + 1, 1, 5, col)
            g.line(x + 1, 5, x - 1, 6, col)
        count = sum(1 for row in g.p for c in row if c is not None)
    return g


# ================================================================ APP ICON
def app_icon():
    s = Spr(64)
    s.rect(0, 0, 64, 64, hx('030806'))
    rng = random.Random(42)
    for col in range(0, 64, 4):
        head = rng.randrange(-10, 64)
        ln = rng.randrange(6, 24)
        for k in range(ln):
            y = head - k
            if 0 <= y < 64 and rng.random() < 0.7:
                a = 1 - k / ln
                c = mix(hx('030806'), GR[2], 0.15 + 0.5 * a)
                s.set(col + 1, y, W if k == 0 else c)
    for y in range(64):
        for x in range(64):
            d = math.hypot(x + 0.5 - 32, y + 0.5 - 32)
            if d < 26:
                s.blend(x, y, alpha(GR[1], 60 * (1 - d / 26)))
    s.ring(32, 32, 24.5, 26, GR[2])
    tower = tower_base(GR, 3)
    tower.blit(head_pulse(3))
    big = tower.scaled(3)
    s.blit(big, 8, 8)
    return s


# ================================================================== ATLAS
class Atlas:
    def __init__(self):
        self.items = []
        self.anims = {}

    def add(self, name, spr):
        self.items.append((name, spr))

    def anim(self, name, frames):
        names = []
        for i, f in enumerate(frames):
            n = f'{name}_{i}'
            self.add(n, f)
            names.append(n)
        self.anims[name] = names

    def pack(self, width=512, pad=1):
        order = sorted(range(len(self.items)), key=lambda i: (-self.items[i][1].h, -self.items[i][1].w, i))
        x = y = 0
        shelf_h = 0
        pos = {}
        for i in order:
            _, s = self.items[i]
            if x + s.w + pad > width:
                x = 0
                y += shelf_h + pad
                shelf_h = 0
            pos[i] = (x, y)
            x += s.w + pad
            shelf_h = max(shelf_h, s.h)
        height = y + shelf_h
        h2 = 1
        while h2 < height:
            h2 *= 2
        sheet = Image.new('RGBA', (width, h2), (0, 0, 0, 0))
        frames = {}
        for i, (name, s) in enumerate(self.items):
            px, py = pos[i]
            sheet.paste(s.img(), (px, py))
            frames[name] = [px, py, s.w, s.h]
        return sheet, frames


def build():
    A = Atlas()

    for v in range(6):
        A.add(f'ground_{v}', ground(v))
    for m in range(16):
        A.add(f'path_{m}', path_tile(m))
    A.anim('decor_server', [decor_server(f) for f in range(2)])
    A.anim('decor_chip', [decor_chip(f) for f in range(2)])
    A.anim('decor_fan', [decor_fan(f) for f in range(2)])
    A.anim('decor_crystal', [decor_crystal(f) for f in range(2)])
    A.anim('decor_cap', [decor_cap(f) for f in range(2)])
    A.anim('decor_terminal', [decor_terminal(f) for f in range(2)])
    A.anim('spawn', [spawn_portal(f) for f in range(4)])
    A.anim('core', [core_sprite(f) for f in range(4)])
    A.add('build_ok', build_marker(True))
    A.add('build_bad', build_marker(False))

    heads = {
        'pulse': head_pulse, 'beam': head_beam, 'bomb': head_bomb, 'ice': head_ice,
        'arc': head_arc, 'sniper': head_sniper, 'hub': head_hub,
    }
    for t, acc in TOWER_ACC.items():
        for l in (1, 2, 3):
            A.add(f'base_{t}_{l}', tower_base(acc, l))
            if t == 'miner':
                A.anim(f'head_{t}_{l}', [head_miner(l, f) for f in range(2)])
            else:
                A.anim(f'head_{t}_{l}', [heads[t](l)])

    A.anim('crawler', [en_crawler(f) for f in range(4)])
    A.anim('worm', [en_worm(f) for f in range(4)])
    A.anim('spam', [en_spam(f) for f in range(4)])
    A.anim('trojan', [en_trojan(f) for f in range(4)])
    A.anim('phantom', [en_phantom(f) for f in range(4)])
    A.anim('glitch', [en_glitch(f) for f in range(4)])
    A.anim('shield', [en_shield(f) for f in range(4)])
    A.anim('patcher', [en_patcher(f) for f in range(4)])
    A.anim('rootkit', [en_rootkit(f) for f in range(4)])
    A.anim('kernel', [en_kernel(f) for f in range(4)])

    for name, col in (('g', GR[3]), ('c', CY[3]), ('m', MG[3]), ('o', OR[3]), ('r', RD[3]),
                      ('y', YE[3]), ('w', W), ('p', PU[3]), ('i', IC[3]), ('b', BL[3])):
        A.add(f'glow_{name}', glow(col))
    A.add('proj_pulse_1', proj_pulse(1))
    A.add('proj_pulse_3', proj_pulse(3))
    A.add('proj_bomb_1', proj_bomb(1))
    A.add('proj_bomb_3', proj_bomb(3))
    A.add('proj_dart', proj_dart())
    A.anim('fx_explode', [fx_explode(f) for f in range(7)])
    A.anim('fx_spark', [fx_spark(f, YE + [W]) for f in range(4)])
    A.anim('fx_spark_g', [fx_spark(f, GR) for f in range(4)])
    A.anim('fx_spark_c', [fx_spark(f, CY) for f in range(4)])
    A.anim('fx_spark_m', [fx_spark(f, MG) for f in range(4)])
    A.anim('fx_spark_i', [fx_spark(f, IC) for f in range(4)])
    A.anim('fx_bits', [fx_bits(f) for f in range(4)])
    A.anim('fx_upgrade', [fx_upgrade(f) for f in range(4)])
    A.anim('fx_stun', [fx_stun(f) for f in range(4)])
    A.anim('fx_burn', [fx_burn(f) for f in range(4)])
    A.add('fx_shield', fx_shield())
    A.add('fx_heal', fx_heal())

    icons = {
        'bits': i_bits, 'heart': i_heart, 'skull': i_skull, 'emp': i_bolt(CY), 'purge': i_purge,
        'overclock': i_overclock, 'up': i_up, 'sell': i_sell, 'target': i_target,
        'star': i_star(True), 'star_off': i_star(False), 'lock': i_lock, 'pause': i_pause,
        'play': i_play, 'ff': i_ff, 'gear': i_gear, 'close': i_close, 'db': i_db, 'info': i_info,
        'sound': i_sound, 'music': i_music, 'bolt_y': i_bolt(YE),
    }
    for n, fn in icons.items():
        A.add(f'ico_{n}', ico(fn))

    for i in range(40):
        A.add(f'glyph_g_{i}', glyph(i, GR[3]))
        A.add(f'glyph_w_{i}', glyph(i, hx('d8ffe0')))

    sheet, frames = A.pack()
    os.makedirs(ASSETS, exist_ok=True)
    sheet.save(os.path.join(ASSETS, 'sprites.png'))
    with open(os.path.join(ASSETS, 'sprites.json'), 'w') as fh:
        json.dump({'image': 'sprites.png', 'w': sheet.width, 'h': sheet.height,
                   'frames': frames, 'anims': A.anims}, fh, separators=(',', ':'))

    os.makedirs(ICONS, exist_ok=True)
    ic = app_icon().img()
    ic.resize((192, 192), Image.NEAREST).save(os.path.join(ICONS, 'icon-192.png'))
    ic.resize((512, 512), Image.NEAREST).save(os.path.join(ICONS, 'icon-512.png'))
    ic.resize((128, 128), Image.NEAREST).save(os.path.join(ICONS, 'favicon.png'))

    print(f'sprites.png {sheet.width}x{sheet.height}, {len(frames)} frames, {len(A.anims)} anims')
    return sheet


if __name__ == '__main__':
    sheet = build()
    import sys
    if len(sys.argv) > 1:
        sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(sys.argv[1])
