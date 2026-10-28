#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Renders the Memev tiers demo video (motion graphics drawn in code).

Output: memev-tiers.mp4 (1280x720, 30 fps, H.264) and memev-tiers.gif (a small inline preview, under 8 MB).

Needs: Python 3.9+, Pillow, ffmpeg on PATH. Nothing else.

    python3 make_memev_tiers.py                  # render the mp4 and the gif next to this script
    python3 make_memev_tiers.py --out /tmp/demo  # render somewhere else
    python3 make_memev_tiers.py --stills 3,20,60 --out /tmp/demo   # PNG stills at those seconds only
    python3 make_memev_tiers.py --no-gif         # mp4 only

Every word on screen is in this file (see SCENES). It shows no prices. Anything not built yet is labelled
coming or planned. Caption timing: 2 s plus 0.35 s per word, never under 4 s, then a short pause on each
scene's summary.
"""
import argparse
import math
import os
import subprocess
import sys
from multiprocessing import Pool

from PIL import Image, ImageDraw, ImageFont

W, H, S, FPS = 1280, 720, 2, 30          # logical size, supersampling factor, frames per second
GIF_W, GIF_FPS, GIF_COLORS = 720, 8, 32  # the inline preview: small enough for GitHub

# ---- palette: dark navy and slate, teal and amber as the two accents ----
BG1, BG2 = (9, 15, 28), (17, 27, 48)
PANEL, PANEL2 = (20, 31, 54), (27, 41, 70)
BORDER = (52, 72, 110)
TEXT, MUTED, DIM = (232, 238, 248), (144, 163, 194), (88, 104, 134)
TEAL, AMBER = (45, 212, 191), (245, 185, 66)
MINT = (160, 232, 255)                    # flow coming back from the vault

# ---- fonts: Inter if installed, otherwise DejaVu ----
FONT_DIRS = ["/usr/share/fonts/truetype/sand-box/google", "/usr/share/fonts/truetype", "/usr/share/fonts",
             os.path.expanduser("~/.fonts"), os.path.expanduser("~/Library/Fonts"), "/Library/Fonts",
             "/System/Library/Fonts/Supplemental"]


def find_font(names):
    for d in FONT_DIRS:
        for root, _dirs, files in os.walk(d):
            for n in names:
                if n in files:
                    return os.path.join(root, n)
    return None


SANS_PATH = find_font(["Inter-VariableFont_opsz,wght.ttf", "Inter.ttf", "DejaVuSans.ttf", "Arial.ttf"])
SANS_BOLD = find_font(["DejaVuSans-Bold.ttf", "Arial Bold.ttf"])
MONO_PATH = find_font(["JetBrainsMono-VariableFont_wght.ttf", "DejaVuSansMono.ttf", "Menlo.ttc", "Courier New.ttf"])
_fc = {}


def font(kind, size):
    key = (kind, size)
    if key in _fc:
        return _fc[key]
    px = int(round(size * S))
    if kind == "m":
        f = ImageFont.truetype(MONO_PATH, px)
        try:
            f.set_variation_by_axes([600])
        except Exception:
            pass
    else:
        wght = {"r": 450, "s": 600, "b": 750}[kind]
        path = SANS_PATH if (kind == "r" or SANS_BOLD is None or "Inter" in (SANS_PATH or "")) else SANS_BOLD
        f = ImageFont.truetype(path, px)
        try:
            f.set_variation_by_axes([20, wght])
        except Exception:
            pass
    _fc[key] = f
    return f


def rgba(c, a=1.0):
    return (c[0], c[1], c[2], int(max(0, min(1, a)) * 255))


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def ap(t, t0, d=0.6):
    return ease((t - t0) / d)


def lerp(a, b, k):
    return a + (b - a) * k


_bg = None


def background():
    global _bg
    if _bg is None:
        im = Image.new("RGB", (W * S, H * S))
        d = ImageDraw.Draw(im)
        for y in range(H * S):
            k = y / (H * S)
            d.line([(0, y), (W * S, y)], fill=tuple(int(lerp(BG1[i], BG2[i], k)) for i in range(3)))
        d = ImageDraw.Draw(im, "RGBA")
        for gx in range(0, W, 40):
            for gy in range(0, H, 40):
                d.ellipse([gx * S - 1, gy * S - 1, gx * S + 1, gy * S + 1], fill=(255, 255, 255, 14))
        _bg = im
    return _bg


class Cv:
    def __init__(self):
        self.im = background().copy()
        self.d = ImageDraw.Draw(self.im, "RGBA")

    def box(self, x, y, w, h, r=12, fill=None, outline=None, width=1.5, a=1.0, dash=False):
        if a <= 0.01:
            return
        s = S
        if fill is not None:
            self.d.rounded_rectangle([x * s, y * s, (x + w) * s, (y + h) * s], r * s, fill=rgba(fill, a))
        if outline is not None:
            if dash:
                self.dashed([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)], outline, width, a, 9, 6)
            else:
                self.d.rounded_rectangle([x * s, y * s, (x + w) * s, (y + h) * s], r * s, outline=rgba(outline, a),
                                         width=max(1, int(width * s)))

    def line(self, pts, color, width=2, a=1.0):
        if a <= 0.01:
            return
        self.d.line([(px * S, py * S) for px, py in pts], fill=rgba(color, a), width=max(1, int(width * S)), joint="curve")

    def dashed(self, pts, color, width=2, a=1.0, dash=8, gap=6):
        if a <= 0.01:
            return
        for seg in dash_segments(pts, dash, gap):
            self.line(seg, color, width, a)

    def circle(self, x, y, r, fill=None, outline=None, width=1.5, a=1.0):
        if a <= 0.01:
            return
        s = S
        self.d.ellipse([(x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s],
                       fill=rgba(fill, a) if fill else None, outline=rgba(outline, a) if outline else None,
                       width=max(1, int(width * s)))

    def text(self, x, y, s, kind="r", size=20, color=TEXT, a=1.0, anchor="la"):
        if a <= 0.01:
            return
        self.d.text((x * S, y * S), s, font=font(kind, size), fill=rgba(color, a), anchor=anchor)

    def tw(self, s, kind, size):
        return font(kind, size).getlength(s) / S

    def chip(self, cx, cy, s, color=TEAL, a=1.0, size=14, filled=False, kind="s", padx=10, mono=False):
        k = "m" if mono else kind
        if a <= 0.01:
            return 0
        w = self.tw(s, k, size) + 2 * padx
        h = size + 12
        self.box(cx - w / 2, cy - h / 2, w, h, r=h / 2, fill=(BG1 if not filled else color), outline=color, width=1.3, a=a)
        self.text(cx, cy + 0.5, s, k, size, BG1 if filled else color, a, "mm")
        return w


def dash_segments(pts, dash, gap):
    out, on, rem = [], True, dash
    cur = [pts[0]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if L == 0:
            continue
        pos = 0.0
        while pos < L:
            step = min(rem, L - pos)
            nx, ny = x0 + (x1 - x0) * (pos + step) / L, y0 + (y1 - y0) * (pos + step) / L
            cur.append((nx, ny))
            pos += step
            rem -= step
            if rem <= 1e-6:
                if on:
                    out.append(cur)
                on = not on
                rem = dash if on else gap
                cur = [(nx, ny)]
        # keep the running segment across corners
    if on and len(cur) > 1:
        out.append(cur)
    return out


def path_len(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def path_at(pts, dist):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if dist <= L:
            k = dist / L if L else 0
            return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k
        dist -= L
    return pts[-1]


def flow(cv, pts, t, color=TEAL, a=1.0, speed=105, rev=False, dashed=False, base=True, phase=0.0, spacing=62):
    """A connector with data particles running along it."""
    if a <= 0.01:
        return
    if base:
        if dashed:
            cv.dashed(pts, color, 1.6, 0.35 * a, 7, 6)
        else:
            cv.line(pts, color, 1.6, 0.28 * a)
    L = path_len(pts)
    n = max(2, int(L / spacing))
    for i in range(n):
        s = ((t * speed + phase + i * L / n) % L)
        d = L - s if rev else s
        edge = min(1.0, s / 22.0, (L - s) / 22.0)
        x, y = path_at(pts, d)
        al = a * edge
        for k in range(1, 5):                       # short tail
            td = d - (k * 7 if not rev else -k * 7)
            if 0 <= td <= L:
                tx, ty = path_at(pts, td)
                cv.circle(tx, ty, 3.2 - k * 0.45, fill=color, a=al * (0.42 - k * 0.08))
        cv.circle(x, y, 9, fill=color, a=al * 0.13)
        cv.circle(x, y, 6, fill=color, a=al * 0.28)
        cv.circle(x, y, 3.6, fill=color, a=al)
        cv.circle(x, y, 1.6, fill=(255, 255, 255), a=al * 0.9)


# ---------------- icons ----------------
def icon(cv, kind, cx, cy, color, a=1.0):
    lw = 1.8
    if kind == "apps":
        for i, (dx, dy) in enumerate([(-9, -8), (3, -8), (-9, 4)]):
            cv.box(cx + dx, cy + dy, 12, 10, r=2, outline=color, width=lw, a=a)
    elif kind == "vault":
        for i in range(3):
            cv.box(cx - 10 + i * 3, cy - 12 + i * 3, 17, 20, r=2, fill=PANEL, outline=color, width=lw, a=a)
        cv.line([(cx - 3, cy + 1), (cx + 3, cy + 1)], color, 1.4, a)
        cv.line([(cx - 3, cy + 5), (cx + 1, cy + 5)], color, 1.4, a)
    elif kind == "bus":
        cv.line([(cx - 13, cy), (cx + 13, cy)], color, 2.4, a)
        for dx in (-9, 0, 9):
            cv.circle(cx + dx, cy, 3.2, fill=BG1, outline=color, width=1.6, a=a)
            cv.line([(cx + dx, cy - 3), (cx + dx, cy - 9)], color, 1.4, a)
    elif kind == "repo":
        cv.box(cx - 11, cy - 10, 22, 7, r=3, outline=color, width=lw, a=a)
        cv.line([(cx - 11, cy - 6), (cx - 11, cy + 8)], color, lw, a)
        cv.line([(cx + 11, cy - 6), (cx + 11, cy + 8)], color, lw, a)
        cv.box(cx - 11, cy + 3, 22, 7, r=3, outline=color, width=lw, a=a)
    elif kind == "computer":
        cv.box(cx - 12, cy - 11, 24, 16, r=2, outline=color, width=lw, a=a)
        cv.line([(cx - 7, cy + 10), (cx + 7, cy + 10)], color, lw, a)
        cv.line([(cx, cy + 5), (cx, cy + 10)], color, lw, a)
    elif kind == "cloud":
        cv.circle(cx - 6, cy + 1, 6, outline=color, width=lw, a=a)
        cv.circle(cx + 3, cy - 3, 8, outline=color, width=lw, a=a)
        cv.circle(cx + 9, cy + 3, 5, outline=color, width=lw, a=a)
        cv.box(cx - 13, cy + 2, 26, 8, r=4, fill=PANEL, a=a)
        cv.line([(cx - 10, cy + 9), (cx + 12, cy + 9)], color, lw, a)
    elif kind == "person":
        cv.circle(cx, cy - 6, 6, outline=color, width=lw, a=a)
        cv.d.arc([(cx - 11) * S, (cy + 1) * S, (cx + 11) * S, (cy + 23) * S], 180, 360, fill=rgba(color, a), width=int(lw * S))
    elif kind == "link":
        cv.box(cx - 14, cy - 6, 15, 12, r=6, outline=color, width=lw, a=a)
        cv.box(cx - 1, cy - 6, 15, 12, r=6, outline=color, width=lw, a=a)
    elif kind == "folder":
        cv.box(cx - 12, cy - 7, 24, 17, r=3, outline=color, width=lw, a=a)
        cv.box(cx - 12, cy - 11, 11, 6, r=2, outline=color, width=lw, a=a)
    elif kind == "chip":
        cv.box(cx - 9, cy - 9, 18, 18, r=3, outline=color, width=lw, a=a)
        for k in (-5, 0, 5):
            cv.line([(cx + k, cy - 9), (cx + k, cy - 14)], color, 1.4, a)
            cv.line([(cx + k, cy + 9), (cx + k, cy + 14)], color, 1.4, a)
    elif kind == "hub":
        cv.box(cx - 10, cy - 11, 20, 22, r=2, outline=color, width=lw, a=a)
        for dx in (-4, 4):
            for dy in (-5, 1):
                cv.box(cx + dx - 1.5, cy + dy - 1.5, 3, 3, fill=color, a=a)
    elif kind == "server":
        for dy in (-8, 1):
            cv.box(cx - 12, cy + dy, 24, 8, r=2, outline=color, width=lw, a=a)
            cv.circle(cx + 7, cy + dy + 4, 1.4, fill=color, a=a)


def node(cv, x, y, w, h, title, sub=None, ic=None, color=TEAL, a=1.0, dash=False, glow=0.0, tsize=19, ssize=15,
         sub_color=MUTED, sub2=None, mono_sub=False):
    if a <= 0.01:
        return
    if glow > 0:
        for i in range(4):
            cv.box(x - i * 3, y - i * 3, w + i * 6, h + i * 6, r=14 + i * 3, outline=color, width=2, a=a * glow * (0.22 - i * 0.05))
    cv.box(x, y, w, h, r=12, fill=PANEL, outline=color if not dash else color, width=1.7, a=a, dash=dash)
    tx = x + 16
    if ic:
        icon(cv, ic, x + 30, y + 31, color, a)
        tx = x + 58
    cv.text(tx, y + 12, title, "b", tsize, TEXT, a)
    if sub:
        cv.text(tx, y + 12 + tsize + 6, sub, "m" if mono_sub else "r", ssize, sub_color, a)
    if sub2:
        cv.text(tx, y + 12 + tsize + 6 + ssize + 5, sub2, "m" if mono_sub else "r", ssize, sub_color, a)


def label(cv, x, y, s, a=1.0, color=MUTED):
    cv.text(x, y, s, "s", 13, color, a)


def wrap(cv, s, kind, size, maxw):
    words, lines, cur = s.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if cv.tw(trial, kind, size) <= maxw:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


# ---------------- shared chrome: header, tier tracker, caption bar ----------------
TRACK = [("Personal", TEAL, False), ("More computers", TEAL, False), ("Business", AMBER, True),
         ("Corporate", AMBER, True), ("Paid engine", AMBER, False)]


def header(cv, title, sub, active, a=1.0):
    cv.text(40, 26, title, "b", 34, TEXT, a)
    cv.text(40, 72, sub, "r", 18, MUTED, a)
    x = 1240
    for idx in range(len(TRACK) - 1, -1, -1):
        name, col, planned = TRACK[idx]
        w = cv.tw(name, "s", 14) + 24
        x -= w
        on = idx in active
        cv.box(x, 32, w, 28, r=14, fill=col if on else BG1, outline=col if on else DIM, width=1.3,
               a=a * (1.0 if on else 0.8), dash=planned and not on)
        cv.text(x + w / 2, 46.5, name, "s", 14, BG1 if on else MUTED, a, "mm")
        x -= 8


def caption(cv, caps, t):
    for (t0, t1, s) in caps:
        a = min(ap(t, t0, 0.35), 1 - ap(t, t1 - 0.35, 0.35))
        if a <= 0.01:
            continue
        cv.box(40, 618, 1200, 78, r=14, fill=PANEL, outline=BORDER, width=1.3, a=0.95 * a)
        cv.box(40, 618, 6, 78, r=3, fill=TEAL, a=a)
        lines = wrap(cv, s, "r", 25, 1130)
        lh = 31
        y0 = 618 + 39 - lh * len(lines) / 2 + 2
        for i, ln in enumerate(lines):
            cv.text(66, y0 + i * lh + lh / 2, ln, "r", 25, TEXT, a, "lm")


def schedule(texts, start=0.5, gap=0.2):
    """Caption timing: each caption is held for 2 s plus 0.35 s per word, and never under 4 s."""
    out, t = [], start
    for s in texts:
        d = max(4.0, 2.0 + 0.35 * len(s.split()))
        out.append((t, t + d, s))
        t += d + gap
    return out


def tick(cv, x, y, a, color=TEAL):
    cv.circle(x, y, 11, fill=color, a=a)
    cv.line([(x - 5, y), (x - 1.5, y + 4), (x + 5.5, y - 4)], BG1, 2.4, a)


def toggle(cv, x, y, on, a=1.0):
    """A small on/off switch; on is 0..1."""
    cv.box(x, y, 44, 22, r=11, fill=lerp_col(DIM, TEAL, on), a=a)
    cv.circle(x + 11 + 22 * on, y + 11, 8, fill=(255, 255, 255), a=a)


def lerp_col(c1, c2, k):
    return tuple(int(lerp(c1[i], c2[i], k)) for i in range(3))


# ---------------- scenes (cs = start time of each caption) ----------------
def scene_title(cv, t, cs):
    a = ap(t, 0.2, 0.8)
    cv.text(640, 150, "Memev", "b", 104, TEXT, a, "mm")
    cv.box(560, 212, 160 * ap(t, 0.6, 0.8), 4, r=2, fill=TEAL, a=a)
    cv.text(640, 258, "One memory and one team channel, both on computers you own.", "r", 27, MUTED, ap(t, 1.0, 0.8), "mm")
    cv.text(640, 300, "How each tier works, and how the tiers connect", "s", 22, TEAL, ap(t, 1.4, 0.8), "mm")
    tiers = [("Personal", "one computer, the free core", TEAL, False), ("Personal", "with more computers", TEAL, False),
             ("Business", "coming", AMBER, True), ("Corporate", "coming", AMBER, True)]
    x0, w, gap, y = 40, 270, 40, 390
    for i, (n, s, col, planned) in enumerate(tiers):
        al = ap(t, 2.0 + i * 0.55, 0.6)
        node(cv, x0 + i * (w + gap), y, w, 90, n, s, None, col, al, dash=planned, tsize=24, ssize=17)
    al = ap(t, 3.2, 0.6)
    flow(cv, [(x0 + w, y + 45), (x0 + w + gap, y + 45)], t, TEAL, al, speed=60, spacing=20)
    xw = x0 + 2 * w + 1.5 * gap                      # the wall between personal and work
    cv.box(xw - 5, y - 14, 10, 118, r=5, fill=PANEL2, outline=AMBER, width=1.6, a=ap(t, 3.6, 0.6))
    flow(cv, [(x0 + 3 * w + 2 * gap, y + 45), (x0 + 3 * (w + gap), y + 45)], t, AMBER, ap(t, 4.2, 0.6),
         speed=60, dashed=True, spacing=20)
    cv.text(640, 530, "Personal and work are separate worlds.", "s", 21, MUTED, ap(t, 5.0, 0.6), "mm")


def scene_personal(cv, t, cs):
    c0, c1, c2 = cs
    cv.box(30, 120, 770, 480, r=18, fill=(14, 23, 41), outline=BORDER, width=1.4, a=ap(t, c0))
    label(cv, 52, 134, "YOUR COMPUTER", ap(t, c0))
    apps = [("Cursor", 175), ("Codex", 255), ("Gemini CLI", 335)]
    va = ap(t, c0 + 0.3)
    notes_on = c1 + 4.2
    node(cv, 420, 175, 230, 230, "Memev vault", "plain Markdown notes", "vault", TEAL, va,
         glow=(0.5 + 0.5 * math.sin(t * 3)) * 0.9 if notes_on < t < notes_on + 3 else 0, sub2="in ~/memev, kept in git")
    cv.chip(535, 372, "Core: Apache-2.0", TEAL, va, 14)
    for i in range(3):
        ya = 250 + i * 28
        k = ap(t, notes_on + i * 0.5, 0.5)
        cv.box(444, ya, 190, 20, r=5, fill=PANEL2, outline=TEAL, width=1.1, a=k)
        cv.text(454, ya + 10.5, ["a decision, saved", "a fact, saved", "where you left off"][i], "r", 13, TEXT, k, "lm")
    for i, (n, y) in enumerate(apps):
        al = ap(t, c1 + i * 0.25)
        node(cv, 64, y, 190, 58, n, "hooks + MCP", None, TEAL, al, tsize=18, ssize=14)
        yc = y + 29
        if t > c1 + 0.7:
            f = ap(t, c1 + 0.7 + i * 0.2)
            flow(cv, [(254, yc - 6), (420, yc - 6)], t, TEAL, f)
            flow(cv, [(420, yc + 6), (254, yc + 6)], t, MINT, f, phase=20)
    cv.text(64, 405, "and other AI apps", "r", 15, MUTED, ap(t, c1 + 0.4))
    cv.chip(337, 362, "your prompt", TEAL, ap(t, c1 + 1.2), 13)
    cv.chip(337, 390, "matching notes", MINT, ap(t, c1 + 1.5), 13)
    b = ap(t, c1 + 5.5)
    if b > 0:
        cv.box(90, 478, 610, 46, r=12, fill=PANEL2, outline=TEAL, width=1.7, a=b)
        cv.text(110, 501, "Comms bus", "b", 18, TEXT, b, "lm")
        cv.text(230, 501, "every app has a seat", "r", 15, MUTED, b, "lm")
        for i, dx in enumerate((560, 595, 630)):
            cv.circle(dx, 501, 7, fill=TEAL, a=b * (0.55 + 0.45 * math.sin(t * 4 + i)))
        for _, y in apps:
            p = [(64, y + 29), (48, y + 29), (48, 500), (90, 500)]
            flow(cv, p, t, TEAL, b, speed=70, phase=y)
            flow(cv, p, t, TEAL, b, speed=70, rev=True, phase=y + 30, base=False)
        flow(cv, [(535, 478), (535, 405)], t, TEAL, b, speed=60)
        flow(cv, [(535, 405), (535, 478)], t, MINT, b, speed=60, base=False, phase=15)
    g = ap(t, c2)
    if g > 0:
        node(cv, 910, 215, 300, 150, "Your private", "GitHub repository", "repo", TEAL, g, tsize=20, sub2="backup and history")
        cv.chip(1060, 346, "you own it", TEAL, g, 13)
        flow(cv, [(650, 290), (910, 290)], t, TEAL, g)
        cv.chip(780, 262, "backup every few minutes", TEAL, g, 13)


def scene_more(cv, t, cs):
    c0, c1, c2 = cs
    A = ap(t, c0)
    cv.box(30, 122, 360, 320, r=18, fill=(14, 23, 41), outline=BORDER, width=1.4, a=A)
    label(cv, 50, 136, "COMPUTER 1", A)
    node(cv, 56, 168, 308, 100, "Personal vault", "the same vault, on every computer", "vault", TEAL, A, sub2="one memory, one comms bus", ssize=14)
    node(cv, 56, 332, 308, 80, "Local AI apps", "as in Personal", "apps", TEAL, A)
    flow(cv, [(210, 268), (210, 332)], t, TEAL, A, speed=60)
    flow(cv, [(210, 332), (210, 268)], t, MINT, A, speed=60, base=False, phase=15)
    sw_on = ap(t, c1 + 6.2, 0.5)                    # the person switches the secure link on
    lk = ap(t, c1 + 3.8)
    node(cv, 520, 190, 220, 80, "Secure link", "off until you switch it on" if sw_on < 0.5 else "switched on by you", "link", TEAL if sw_on > 0.5 else DIM,
         lk, dash=sw_on < 0.5, tsize=19, ssize=14)
    toggle(cv, 690, 200, sw_on, lk)
    for i, (x, nm) in enumerate([(816, "Computer 2"), (1030, "Computer 3")]):
        al = ap(t, c1 + i * 0.5)
        node(cv, x, 340, 200, 88, nm, "its own key", "computer", TEAL, al, sub2="signs each request")
        fa = min(al, sw_on)
        flow(cv, [(630, 270), (630, 312), (x + 100, 312), (x + 100, 340)], t, TEAL, fa, speed=80, phase=i * 30)
        flow(cv, [(x + 100, 340), (x + 100, 312), (630, 312), (630, 270)], t, MINT, fa, speed=80, base=False, phase=40 + i * 30)
        if sw_on < 1:
            cv.dashed([(630, 270), (630, 312), (x + 100, 312), (x + 100, 340)], DIM, 1.4, 0.7 * al * (1 - sw_on), 6, 6)
    cl = ap(t, c1 + 3.8)
    node(cv, 900, 180, 320, 100, "Cloud AI apps", "ChatGPT and other web AI apps", "cloud", TEAL, cl)
    flow(cv, [(364, 230), (520, 230)], t, TEAL, min(lk, sw_on))
    flow(cv, [(520, 240), (364, 240)], t, MINT, min(lk, sw_on), base=False, phase=10)
    flow(cv, [(740, 220), (900, 220)], t, TEAL, min(cl, sw_on))
    flow(cv, [(900, 240), (740, 240)], t, MINT, min(cl, sw_on), base=False, phase=30)
    if sw_on < 1:
        cv.dashed([(364, 235), (520, 235)], DIM, 1.4, 0.7 * lk * (1 - sw_on), 6, 6)
        cv.dashed([(740, 230), (900, 230)], DIM, 1.4, 0.7 * cl * (1 - sw_on), 6, 6)
    if t > c1 + 6.2:
        cv.chip(820, 200, "you can switch it off again", TEAL, ap(t, c1 + 6.6), 12)
    if t > c1 + 5.4:
        cv.chip(740, 312, "signed with that computer's key", AMBER, ap(t, c1 + 5.6) * (1 if t > c1 + 6.2 else 0.9), 13)
    r = ap(t, c2)
    node(cv, 440, 470, 430, 96, "Relay (optional)", "a stable address for the vault", "server", AMBER, r, dash=True,
         sub2="it only forwards bytes it cannot read")
    if r > 0:
        cv.dashed([(580, 270), (580, 470)], AMBER, 1.6, 0.5 * r, 7, 6)
        cv.chip(1040, 518, "hosted relay and sync: planned", AMBER, ap(t, c2 + 3.0), 14)


def scene_boundary(cv, t, cs):
    c0, c1 = cs
    z = ap(t, c0)
    cv.box(30, 130, 520, 440, r=18, fill=(14, 23, 41), outline=TEAL, width=1.4, a=z)
    label(cv, 52, 144, "PERSONAL OR HOME", z, TEAL)
    node(cv, 70, 200, 300, 100, "Personal vault", "yours, on your computers", "vault", TEAL, z)
    node(cv, 70, 360, 300, 80, "Your AI apps", "personal accounts", "apps", TEAL, z)
    flow(cv, [(220, 360), (220, 300)], t, TEAL, z, speed=60)
    cv.box(730, 130, 520, 440, r=18, fill=(14, 23, 41), outline=AMBER, width=1.4, a=z, dash=True)
    label(cv, 752, 144, "BUSINESS OR CORPORATE", z, AMBER)
    cv.chip(1130, 148, "COMING", AMBER, z, 13, filled=True)
    node(cv, 880, 200, 330, 100, "Work vault", "company-owned", "vault", AMBER, z, dash=True)
    node(cv, 880, 360, 330, 80, "Company vault", "company-owned", "hub", AMBER, z, dash=True)
    w = ap(t, c0 + 1.5, 0.8)
    cv.box(618, 130, 24, 440, r=10, fill=PANEL2, outline=AMBER, width=1.8, a=w)
    for yy in range(150, 560, 22):
        cv.line([(622, yy), (638, yy + 12)], AMBER, 1.2, 0.35 * w)
    cv.chip(630, 112, "hard boundary", AMBER, w, 14, filled=True)
    f = ap(t, c0 + 2.5)
    for yy in (250, 400):
        flow(cv, [(370, yy), (600, yy)], t, TEAL, f, speed=90)
        flow(cv, [(880, yy), (660, yy)], t, AMBER, f, speed=90, rev=False, phase=40)
    cv.chip(630, 590, "no grant, no release, no live query", AMBER, ap(t, c0 + 4.0), 14)
    k = ap(t, c1)
    for x, col in ((310, TEAL), (1040, AMBER)):
        cv.chip(x, 500, "own identity", col, k, 14)
        cv.chip(x + 0, 534, "own keys", col, k, 14)
    cv.chip(630, 555, "", AMBER, 0.0)


def scene_business(cv, t, cs):
    c0, c1, c2 = cs
    cv.chip(1150, 150, "COMING", AMBER, ap(t, c0), 15, filled=True)
    for i, (y, nm) in enumerate([(200, "Member A"), (360, "Member B")]):
        al = ap(t, c0 + i * 0.4)
        node(cv, 40, y, 230, 100, nm, "AI apps and a computer", "person", TEAL, al, sub2="their own work login", ssize=14)
        node(cv, 360, y, 250, 100, "Work vault", "company-owned", "vault", AMBER, ap(t, c0 + 0.8 + i * 0.4), dash=True, ssize=14, sub2="one per member")
        flow(cv, [(270, y + 40), (360, y + 40)], t, TEAL, ap(t, c0 + 1.4), speed=70, spacing=40)
        flow(cv, [(360, y + 60), (270, y + 60)], t, MINT, ap(t, c0 + 1.4), speed=70, spacing=40, base=False, phase=10)
    cvl = ap(t, c0 + 3.4)
    node(cv, 800, 240, 280, 180, "Company vault", "shared, company-owned", "hub", AMBER, cvl, dash=True,
         glow=(0.5 + 0.5 * math.sin(t * 3)) * 0.8 if c1 + 3 < t < c1 + 6 else 0)
    up = ap(t, c1)
    dn = ap(t, c1 + 3.2)
    flow(cv, [(610, 225), (740, 225), (740, 270), (800, 270)], t, TEAL, up, speed=90, spacing=40)
    flow(cv, [(800, 300), (680, 300), (680, 255), (610, 255)], t, MINT, dn, speed=90, spacing=40)
    flow(cv, [(610, 435), (740, 435), (740, 390), (800, 390)], t, TEAL, up, speed=90, spacing=40)
    flow(cv, [(800, 360), (680, 360), (680, 405), (610, 405)], t, MINT, dn, speed=90, spacing=40)
    cv.chip(675, 225, "promote or share", TEAL, up, 13)
    cv.chip(740, 300, "company knowledge", MINT, dn, 13)
    s = ap(t, c2)
    if s > 0:
        cv.text(640, 510, "AN INVITE GIVES", "s", 13, MUTED, s, "mm")
        for i, (txt, col, mono) in enumerate([("the team bus, by default", TEAL, False),
                                              ("an optional shared folder", MINT, False),
                                              ("--full: full vault access, only if asked", AMBER, True)]):
            a = ap(t, c2 + 0.5 + i * 1.2)
            x = [250, 640, 1030][i]
            cv.chip(x, 548, txt, col, a, 15, mono=mono and False)


def scene_corporate(cv, t, cs):
    c0, c1 = cs
    cv.chip(1150, 150, "COMING", AMBER, ap(t, c0), 15, filled=True)
    node(cv, 400, 130, 480, 90, "Company vault", "shared, company-owned", "hub", AMBER, ap(t, c0), dash=True)
    scopes = [(60, "Department A", "a scope: its members and their work vaults"), (470, "Department B", "a scope: its members and their work vaults"),
              (880, "Project X", "a scope: the people put on the project")]
    for i, (x, nm, sub) in enumerate(scopes):
        al = ap(t, c0 + 1.2 + i * 0.6)
        node(cv, x, 310, 340, 100, nm, sub, "folder", AMBER, al, dash=True, ssize=14)
        cx = x + 170
        pts = {0: [(520, 220), (520, 265), (cx, 265), (cx, 310)], 1: [(640, 220), (640, 310)],
               2: [(760, 220), (760, 265), (cx, 265), (cx, 310)]}[i]
        flow(cv, pts, t, MINT, al, speed=80, spacing=40)
        flow(cv, list(reversed(pts)), t, TEAL, al, speed=80, base=False, phase=30, spacing=40)
    cv.chip(640, 268, "scopes", AMBER, ap(t, c0 + 2.0), 13)
    p = ap(t, c1)
    node(cv, 40, 130, 320, 90, "Sign-in provisioning", "adds and removes members", "person", AMBER, p, dash=True, ssize=14)
    flow(cv, [(200, 220), (200, 310)], t, TEAL, p, speed=70, dashed=True)
    node(cv, 920, 130, 320, 90, "Audit and retention", "every step on record", "server", AMBER, ap(t, c1 + 1.6), dash=True, ssize=14)
    flow(cv, [(920, 175), (880, 175)], t, AMBER, ap(t, c1 + 1.8), speed=40, dashed=True, spacing=20)
    b = ap(t, c1 + 2.6)
    if b > 0:
        cv.box(60, 470, 1160, 48, r=12, fill=PANEL2, outline=AMBER, width=1.5, a=b, dash=True)
        cv.text(84, 494, "Audit log", "b", 18, TEXT, b, "lm")
        cv.text(190, 494, "who read, wrote, promoted and left, kept under the company's own retention", "r", 15, MUTED, b, "lm")
        flow(cv, [(60, 540), (1220, 540)], t, AMBER, b * 0.9, speed=60, spacing=90, base=False)


def scene_leavers(cv, t, cs):
    c0, c1 = cs
    cv.chip(1150, 150, "COMING", AMBER, ap(t, c0), 15, filled=True)
    m = ap(t, c0)
    node(cv, 50, 220, 270, 120, "Member leaves", "their work login ends", "person", TEAL, m, sub2="at the company's request")
    chips = [("Access ended", c0 + 1.6), ("Keys revoked", c0 + 3.4), ("Devices removed", c0 + 5.2), ("Local cache wiped", c0 + 7.0)]
    pa = ap(t, c0 + 0.6)
    cv.box(430, 150, 400, 340, r=16, fill=PANEL, outline=AMBER, width=1.6, a=pa)
    cv.text(456, 178, "Offboarding", "b", 22, TEXT, pa, "lm")
    for i, (txt, tt) in enumerate(chips):
        y = 232 + i * 64
        ia = ap(t, c0 + 0.9 + i * 0.2)
        cv.circle(472, y, 11, outline=DIM, width=1.6, a=ia)
        k = ap(t, tt, 0.4)
        tick(cv, 472, y, k, TEAL)
        cv.text(498, y - (6 if i == 3 else 0), txt, "s", 21, TEXT if k > 0.5 else MUTED, ia, "lm")
    cv.text(498, 232 + 3 * 64 + 17, "when that computer next starts or connects", "r", 14, MUTED, ap(t, c0 + 7.0), "lm")
    done = ap(t, c0 + 7.4, 0.6)
    flow(cv, [(320, 280), (430, 280)], t, TEAL, m * (1 - done), speed=70, spacing=40)
    if done > 0:
        cv.dashed([(320, 280), (430, 280)], DIM, 1.6, 0.8 * done, 6, 6)
        cv.chip(375, 252, "ended", AMBER, done, 14, filled=True)
    v = ap(t, c1)
    node(cv, 930, 220, 300, 120, "Work vault", "stays with the company", "vault", AMBER, v, dash=True,
         glow=(0.5 + 0.5 * math.sin(t * 3)) * 0.8 if v > 0.9 else 0, sub2="company-owned and kept")
    flow(cv, [(830, 280), (930, 280)], t, MINT, v, speed=50, spacing=30, dashed=True)
    cv.chip(1080, 372, "no vault access leaves", TEAL, ap(t, c1 + 1.8), 14)


def doc(cv, x, y, w, h, a, lines, color=TEAL, title="Shared note"):
    cv.box(x, y, w, h, r=12, fill=PANEL, outline=color, width=1.7, a=a)
    cv.text(x + 16, y + 18, title, "b", 17, TEXT, a, "lm")
    for i, (txt, col) in enumerate(lines):
        yy = y + 46 + i * 28
        cv.box(x + 14, yy, w - 28, 22, r=5, fill=PANEL2, outline=col, width=1.1, a=a)
        cv.text(x + 24, yy + 11.5, txt, "r", 13, TEXT, a, "lm")


def scene_engine(cv, t, cs):
    c0, c1, c2, c3 = cs
    a0 = ap(t, c0)
    merged = ap(t, c1 + 3.0, 0.6)
    mode_a = ap(t, c0)
    cv.chip(640, 140, "WITHOUT THE ENGINE" if t < c1 else "WITH THE PAID ENGINE", MUTED if t < c1 else TEAL, mode_a, 14,
            filled=t >= c1)
    node(cv, 60, 230, 250, 100, "Computer 1", "edits the note", "computer", TEAL, a0)
    node(cv, 970, 230, 250, 100, "Computer 2", "or a teammate, at once", "person", TEAL, a0)
    conflict = ap(t, c0 + 4.0) * (1 - ap(t, c1 - 0.2, 0.4))
    lines_c = [("A adds a line on the launch", TEAL), ("B adds a line on the budget", MINT)] if merged < 0.5 else [("A adds a line on the launch", TEAL), ("B adds a line on the budget", MINT), ("one note with both changes", TEAL)]
    doc(cv, 500, 190, 280, 150 if merged < 0.5 else 150, a0, lines_c, color=TEAL if merged > 0.5 else (AMBER if conflict > 0.3 else TEAL))
    ea = ap(t, c0 + 1.0) * (1 - ap(t, c1 + 3.0, 0.6) * 0)
    flow(cv, [(310, 270), (500, 270)], t, TEAL, ea, speed=95)
    flow(cv, [(970, 270), (780, 270)], t, MINT, ea, speed=95)
    if conflict > 0.01:
        cv.chip(640, 168, "conflict: fix by hand", AMBER, conflict, 14, filled=True)
    node(cv, 60, 450, 380, 100, "Free core: git backup", "one writer; a failed merge is left as it is", "repo", TEAL, ap(t, c0 + 2.5) * (0.45 if t >= c1 else 1.0),
         ssize=14, sub2="run memev doctor")
    # the engine
    e = ap(t, c1)
    node(cv, 500, 450, 380, 100, "Paid engine", "merges every change", "chip", AMBER, e, dash=True, glow=(0.5 + 0.5 * math.sin(t * 3)) * 0.7 if c1 < t < c1 + 6 else 0, sub2="nothing lost, no conflicts", ssize=15)
    if e > 0:
        fa = ap(t, c1 + 0.8)
        flow(cv, [(630, 340), (630, 450)], t, AMBER, fa, speed=70, spacing=40)
        flow(cv, [(650, 450), (650, 340)], t, MINT, ap(t, c1 + 2.5), speed=70, spacing=40, base=False, phase=20)
        cv.chip(540, 395, "Memev calls it", AMBER, fa, 13)
        cv.chip(740, 395, "merged note comes back", MINT, ap(t, c1 + 2.5), 13)
        back = ap(t, c1 + 4.0)
        flow(cv, [(500, 300), (310, 300)], t, MINT, back, speed=95)
        flow(cv, [(780, 300), (970, 300)], t, MINT, back, speed=95)
        cv.chip(640, 360 + 0, "", AMBER, 0.0)
        if back > 0.5:
            tick(cv, 640, 168, ap(t, c1 + 4.2))
            cv.text(662, 168, "nothing lost", "s", 15, TEAL, ap(t, c1 + 4.2), "lm")
    fit = ap(t, c2)
    if fit > 0:
        cv.text(1050, 428, "WHERE IT FITS", "s", 13, MUTED, fit, "mm")
        for i, (nm, col, dash) in enumerate([("Personal with more computers", TEAL, False), ("Business (coming)", AMBER, True), ("Corporate (coming)", AMBER, True)]):
            a = ap(t, c2 + 0.6 + i * 0.9)
            y = 450 + i * 46
            cv.box(920, y, 320, 38, r=10, fill=PANEL, outline=col, width=1.5, a=a, dash=dash)
            cv.text(938, y + 19.5, nm, "s", 16, TEXT, a, "lm")
            flow(cv, [(880, 500), (900, 500), (900, y + 19), (920, y + 19)], t, AMBER, a, speed=60, spacing=24, dashed=True)
    sep = ap(t, c3)
    if sep > 0:
        cv.box(488, 440, 404, 120, r=14, outline=AMBER, width=1.3, a=0.0)
        cv.dashed([(470, 425), (470, 575)], AMBER, 1.5, 0.7 * sep, 8, 7)
        cv.chip(240, 595, "separate component, its own licence, not in this repository", AMBER, sep, 14)


def scene_combined(cv, t, cs):
    c0, c1, c2 = cs
    # personal zone
    z = ap(t, c0)
    more = ap(t, c0 + 3.6)
    cv.box(20, 128, 672, 468, r=18, fill=(14, 23, 41), outline=BORDER, width=1.4, a=z)
    label(cv, 40, 142, "PERSONAL", z, TEAL)
    node(cv, 36, 170, 160, 90, "AI apps", "hooks + MCP", None, TEAL, z, tsize=18, ssize=14)
    node(cv, 270, 170, 190, 110, "Personal vault", "plain Markdown", None, TEAL, z, ssize=14, sub2="and the comms bus", tsize=18)
    node(cv, 524, 170, 150, 90, "GitHub", "your own backup", None, TEAL, z, tsize=18, ssize=14)
    flow(cv, [(196, 205), (270, 205)], t, TEAL, z, speed=70, spacing=40)
    flow(cv, [(270, 225), (196, 225)], t, MINT, z, speed=70, spacing=40, base=False, phase=10)
    flow(cv, [(460, 225), (524, 225)], t, TEAL, z, speed=70, spacing=40)
    node(cv, 270, 350, 190, 90, "More computers", "same vault, own keys", None, TEAL, more, tsize=18, ssize=14)
    flow(cv, [(365, 350), (365, 280)], t, TEAL, more, speed=60, spacing=30)
    flow(cv, [(385, 280), (385, 350)], t, MINT, more, speed=60, spacing=30, base=False, phase=15)
    node(cv, 36, 350, 160, 90, "Cloud AI apps", "ChatGPT and more", None, TEAL, more, dash=True, tsize=18, ssize=14)
    cv.dashed([(196, 395), (270, 395)], DIM, 1.5, 0.8 * more, 6, 6)
    cv.chip(233, 462, "secure link: off until you switch it on", TEAL, more, 12)
    # wall and business zone
    w = ap(t, c1)
    cv.box(708, 128, 18, 372, r=9, fill=PANEL2, outline=AMBER, width=1.8, a=w)
    cv.chip(717, 112, "hard boundary", AMBER, w, 13, filled=True)
    cv.box(742, 128, 514, 468, r=18, fill=(14, 23, 41), outline=AMBER, width=1.4, a=w, dash=True)
    label(cv, 762, 142, "BUSINESS AND CORPORATE", w, AMBER)
    cv.chip(1190, 146, "COMING", AMBER, w, 12, filled=True)
    b = ap(t, c2)
    node(cv, 762, 175, 200, 90, "Work vaults", "one per member", None, AMBER, b, dash=True, tsize=18, ssize=14)
    node(cv, 1030, 175, 206, 110, "Company vault", "shared, company-owned", None, AMBER, b, dash=True, tsize=18, ssize=14)
    flow(cv, [(962, 205), (1030, 205)], t, TEAL, b, speed=60, spacing=30)
    flow(cv, [(1030, 235), (962, 235)], t, MINT, b, speed=60, spacing=30, base=False, phase=10)
    cv.chip(996, 190, "promote", TEAL, b, 11)
    for i, (txt) in enumerate(["Corporate: departments, projects, provisioning", "audit and retention", "Leavers: access, keys and devices revoked,", "cache wiped, work vault stays"]):
        cv.text(766, 335 + i * 26, ("- " if i in (1, 3) else "") + txt if False else txt, "r", 15, MUTED, ap(t, c2 + 1.0 + i * 0.5), "lm")
    # the engine
    e = ap(t, c2 + 3.6)
    node(cv, 400, 510, 480, 80, "Paid engine", "separate component, own licence, called by Memev", "chip", AMBER, e, dash=True, tsize=18, ssize=14,
         glow=(0.5 + 0.5 * math.sin(t * 3)) * 0.6 if e > 0.9 else 0)
    flow(cv, [(400, 550), (365, 550), (365, 440)], t, AMBER, e, speed=70, spacing=40)
    flow(cv, [(880, 550), (1133, 550), (1133, 285)], t, AMBER, e, speed=70, spacing=40)
    cv.chip(640, 492, "merges edits from several computers and people", AMBER, e, 12)


def end_card(cv, t, cs):
    a = ap(t, 0.3, 0.7)
    cv.text(640, 250, "Memev", "b", 104, TEXT, a, "mm")
    cv.box(560, 312, 160, 4, r=2, fill=TEAL, a=a)
    cv.text(640, 362, "One memory and one team channel, both on computers you own.", "r", 27, MUTED, ap(t, 0.9, 0.7), "mm")
    cv.text(640, 430, "Personal and work stay in separate worlds.", "s", 22, TEAL, ap(t, 1.6, 0.7), "mm")
    cv.text(640, 478, "Business and Corporate are coming.", "s", 22, AMBER, ap(t, 2.4, 0.7), "mm")


# ---------------- storyboard ----------------
HOLD = 1.6      # seconds the animation stands still on each scene's summary before the next scene


def mk(key, fn, texts, head, active, start=0.5, tail=None):
    caps = schedule(texts, start)
    last = caps[-1][1]
    dur = last + HOLD + 0.2
    caps[-1] = (caps[-1][0], dur - 0.05, caps[-1][2])
    return dict(key=key, fn=fn, caps=caps, cs=[c[0] for c in caps], head=head, active=active, dur=dur)


SCENES = [
    mk("title", scene_title, ["Personal, Personal with more computers, Business and Corporate. The last two are coming."],
       None, [], start=2.2),
    mk("personal", scene_personal,
       ["Personal: one person, one computer, with the free core.",
        "Hooks and MCP give each app the notes that match, and a seat on the comms bus.",
        "Notes are plain Markdown, backed up to a private GitHub repository you own."],
       ("Personal", "One person, one computer  \u00b7  the free core"), [0]),
    mk("more", scene_more,
       ["Personal with more computers: the same personal vault on several computers.",
        "Each added computer has its own key. They join over the secure link, off until you switch it on.",
        "A relay can give a stable address. Hosted sync and relay are planned."],
       ("Personal with more computers", "The same personal vault on several computers"), [1]),
    mk("boundary", scene_boundary,
       ["A personal or home vault never crosses into Business or Corporate.",
        "Separate identities, separate keys, no grant or live query. Someone with both uses two identities."],
       ("A hard boundary", "Personal and work never meet"), [0, 1]),
    mk("business", scene_business,
       ["Business, coming: each member has a company-owned work vault, plus the shared company vault.",
        "Members promote or share notes up. Company knowledge flows back down.",
        "An invite gives the team bus by default, plus an optional shared folder. Full access only with --full."],
       ("Business", "Coming  \u00b7  a work vault for each member, plus the company vault"), [2]),
    mk("corporate", scene_corporate,
       ["Corporate, coming: the same model as Business, at larger scale, with departments and projects.",
        "Sign-in provisioning adds members. Audit and retention keep every step on record."],
       ("Corporate", "Coming  \u00b7  the Business model at larger scale"), [3]),
    mk("leavers", scene_leavers,
       ["When someone leaves, their access, keys and devices are revoked and the local cache is wiped.",
        "The work vault stays with the company. No one leaves with vault access."],
       ("When someone leaves", "Coming with Business and Corporate"), [2, 3]),
    mk("engine", scene_engine,
       ["Without the engine, git backup has one writer. Concurrent edits can conflict and need fixing by hand.",
        "The paid engine merges every change automatically. Nothing is lost, and no conflicts to fix by hand.",
        "It fits Personal with more computers, Business and Corporate.",
        "A separate component under its own licence, called by Memev, not part of this repository."],
       ("The paid engine", "Merges changes made in several places at once"), [4]),
    mk("combined", scene_combined,
       ["Personal, with more computers on the same vault, backed up to your own GitHub.",
        "A hard boundary keeps personal and home vaults out of Business and Corporate.",
        "Business and Corporate (coming) add work vaults and a company vault. The paid engine merges edits."],
       ("How the tiers connect", "Personal and work stay separate; the engine is called from outside the core"), None),
]
SCENES.append(dict(key="end", fn=end_card, caps=[], cs=[], head=None, active=[], dur=6.0))
TOTAL = sum(s["dur"] for s in SCENES)


def render_at(T):
    """Draw the frame at global time T (seconds) and return a Pillow RGB image at 1280x720."""
    t = T
    sc = SCENES[-1]
    for s in SCENES:
        if t < s["dur"]:
            sc = s
            break
        t -= s["dur"]
    ta = min(t, sc["dur"] - HOLD - 0.2)            # the animation clock stops for the summary pause
    cv = Cv()
    sc["fn"](cv, ta, sc["cs"])
    if sc["head"]:
        active = sc["active"]
        if active is None:                          # combined: tier chips light up as each layer joins
            c0, c1, c2 = sc["cs"]
            active = [i for (rv, ids) in [(c0, [0]), (c0 + 3.6, [1]), (c1, [2, 3]), (c2 + 3.6, [4])] if ta >= rv for i in ids]
        header(cv, sc["head"][0], sc["head"][1], active, ap(t, 0.1, 0.5))
    caption(cv, sc["caps"], t)
    im = cv.im
    fade = min(ap(t, 0.0, 0.45), 1 - ap(t, sc["dur"] - 0.45, 0.45))
    if sc["key"] == "title":
        fade = ap(t, 0, 0.6) * (1 - ap(t, sc["dur"] - 0.45, 0.45))
    if sc["key"] == "end":
        fade = ap(t, 0.0, 0.45) * (1 - ap(t, sc["dur"] - 0.8, 0.8))
    if fade < 1:
        im = Image.blend(background(), im, fade)
    return im.resize((W, H), Image.LANCZOS)


def _frame_bytes(i):
    return render_at(i / FPS).tobytes()


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    ap_.add_argument("--stills", help="comma separated seconds; write PNGs and stop")
    ap_.add_argument("--no-gif", action="store_true")
    ap_.add_argument("--schedule", action="store_true", help="print each scene's start and length, and stop")
    ap_.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    a = ap_.parse_args()
    if a.schedule:
        t = 0.0
        for s in SCENES:
            print(f"{t:7.1f}  {s['dur']:5.1f}  {s['key']}")
            t += s["dur"]
        print(f"{t:7.1f}  total")
        return 0
    os.makedirs(a.out, exist_ok=True)
    if a.stills:
        for s in a.stills.split(","):
            p = os.path.join(a.out, f"still-{float(s):06.2f}.png")
            render_at(float(s)).save(p)
            print(p)
        return 0
    n = int(round(TOTAL * FPS))
    mp4 = os.path.join(a.out, "memev-tiers.mp4")
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "23",
                           "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], stdin=subprocess.PIPE)
    with Pool(a.workers) as pool:
        for k, b in enumerate(pool.imap(_frame_bytes, range(n), chunksize=6)):
            ff.stdin.write(b)
            if k % 300 == 0:
                print(f"frame {k}/{n}", file=sys.stderr)
    ff.stdin.close()
    ff.wait()
    print(f"{mp4}  {TOTAL:.1f} s")
    if not a.no_gif:
        gif = os.path.join(a.out, "memev-tiers.gif")
        vf = (f"fps={GIF_FPS},scale={GIF_W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors={GIF_COLORS}:stats_mode=diff[p];"
              "[b][p]paletteuse=dither=none:diff_mode=rectangle")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-vf", vf, "-loop", "0", gif], check=True)
        print(gif)
    return 0


if __name__ == "__main__":
    sys.exit(main())
