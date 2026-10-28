#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Renders the Memev tiers demo video (motion graphics drawn in code).

Output: memev-tiers.mp4 (1280x720, 30 fps, H.264) and memev-tiers.gif (800 px wide, 10 fps, under 8 MB).

Needs: Python 3.9+, Pillow, ffmpeg on PATH. Nothing else.

    python3 make_memev_tiers.py                  # render the mp4 and the gif next to this script
    python3 make_memev_tiers.py --out /tmp/demo  # render somewhere else
    python3 make_memev_tiers.py --stills 3,20,60 --out /tmp/demo   # PNG stills at those seconds only
    python3 make_memev_tiers.py --no-gif         # mp4 only

Every word on screen is in this file (see SCENES). The tier names, limits and statuses are the ones in
docs/PRICING.md and docs/tiers/. Anything not built yet is labelled coming or planned.
"""
import argparse
import math
import os
import subprocess
import sys
from multiprocessing import Pool

from PIL import Image, ImageDraw, ImageFont

W, H, S, FPS = 1280, 720, 2, 30          # logical size, supersampling factor, frames per second

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
TRACK = [("Free", TEAL, False), ("Personal", TEAL, False), ("Team", TEAL, False),
         ("Business", AMBER, True), ("Enterprise", AMBER, True), ("Paid engine", AMBER, False)]


def header(cv, title, sub, active, a=1.0):
    cv.text(40, 26, title, "b", 34, TEXT, a)
    cv.text(40, 72, sub, "r", 18, MUTED, a)
    x = 1240
    for name, col, planned in reversed(TRACK):
        w = cv.tw(name, "s", 14) + 24
        x -= w
        on = TRACK.index((name, col, planned)) in active
        cv.box(x, 32, w, 28, r=14, fill=col if on else BG1, outline=col if on else DIM, width=1.3,
               a=a * (1.0 if on else 0.8), dash=planned and not on)
        cv.text(x + w / 2, 46.5, name, "s", 14, BG1 if on else MUTED, a, "mm")
        x -= 8


def caption(cv, caps, t, total_a=1.0):
    for (t0, t1, s) in caps:
        a = min(ap(t, t0, 0.35), 1 - ap(t, t1 - 0.35, 0.35)) * total_a
        if a <= 0.01:
            continue
        cv.box(40, 618, 1200, 78, r=14, fill=PANEL, outline=BORDER, width=1.3, a=0.95 * a)
        cv.box(40, 618, 6, 78, r=3, fill=TEAL, a=a)
        lines = wrap(cv, s, "r", 25, 1130)
        lh = 31
        y0 = 618 + 39 - lh * len(lines) / 2 + 2
        for i, ln in enumerate(lines):
            cv.text(66, y0 + i * lh + lh / 2, ln, "r", 25, TEXT, a, "lm")


# ---------------- scenes ----------------
def scene_title(cv, t):
    a = ap(t, 0.2, 0.8)
    cv.text(640, 150, "Memev", "b", 104, TEXT, a, "mm")
    cv.box(560, 212, 160 * ap(t, 0.6, 0.8), 4, r=2, fill=TEAL, a=a)
    cv.text(640, 258, "One memory and one team channel, both on computers you own.", "r", 27, MUTED, ap(t, 1.0, 0.8), "mm")
    cv.text(640, 300, "How each tier works, and how the tiers connect", "s", 22, TEAL, ap(t, 1.4, 0.8), "mm")
    names = [("Free", "one computer", TEAL, False), ("Personal", "up to 3 computers", TEAL, False),
             ("Team", "2 to 20 people", TEAL, False), ("Business", "coming", AMBER, True),
             ("Enterprise", "coming", AMBER, True)]
    x0, w, gap, y = 80, 200, 30, 380
    for i, (n, s, col, planned) in enumerate(names):
        t0 = 2.0 + i * 0.55
        al = ap(t, t0, 0.6)
        node(cv, x0 + i * (w + gap), y, w, 84, n, s, None, col, al, dash=planned, tsize=22, ssize=16)
        if i < 4:
            pts = [(x0 + i * (w + gap) + w, y + 42), (x0 + (i + 1) * (w + gap), y + 42)]
            flow(cv, pts, t, col, ap(t, t0 + 0.3, 0.5), speed=60, dashed=planned or names[i + 1][3], spacing=20)
    cv.text(640, 520, "Each tier builds on the one before it.", "r", 20, MUTED, ap(t, 5.2, 0.6), "mm")


def scene_free(cv, t):
    cv.box(30, 120, 770, 480, r=18, fill=(14, 23, 41), outline=BORDER, width=1.4, a=ap(t, 0.4))
    label(cv, 52, 134, "YOUR COMPUTER", ap(t, 0.4))
    apps = [("Cursor", 175), ("Codex", 255), ("Gemini CLI", 335)]
    va = ap(t, 0.8)
    pulse_v = 0.5 + 0.5 * math.sin(t * 3)
    node(cv, 420, 175, 230, 230, "Memev vault", "plain Markdown notes", "vault", TEAL, va,
         glow=pulse_v * 0.9 if 9.8 < t < 14 else 0, sub2="in ~/memev, kept in git")
    cv.chip(535, 372, "Core: Apache-2.0", TEAL, va, 14)
    if t > 10:
        for i in range(3):
            ya = 250 + i * 28
            k = ap(t, 10.2 + i * 0.5, 0.5)
            cv.box(444, ya, 192 * 0.0 + 190, 20, r=5, fill=PANEL2, outline=TEAL, width=1.1, a=k)
            cv.text(454, ya + 10.5, ["a decision, saved", "a fact, saved", "where you left off"][i], "r", 13, TEXT, k, "lm")
    for i, (n, y) in enumerate(apps):
        al = ap(t, 5.5 + i * 0.25)
        node(cv, 64, y, 190, 58, n, "hooks + MCP", None, TEAL, al, tsize=18, ssize=14)
        yc = y + 29
        if t > 6.2:
            f = ap(t, 6.2 + i * 0.2)
            flow(cv, [(254, yc - 6), (420, yc - 6)], t, TEAL, f)
            flow(cv, [(420, yc + 6), (254, yc + 6)], t, MINT, f, phase=20)
    cv.text(64, 405, "and other AI apps", "r", 15, MUTED, ap(t, 5.9))
    if t > 6.4:
        cv.chip(337, 362, "your prompt", TEAL, ap(t, 6.6), 13)
        cv.chip(337, 390, "matching notes", MINT, ap(t, 6.8), 13)
    # bus
    b = ap(t, 14.0)
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
    # github
    g = ap(t, 17.2)
    if g > 0:
        node(cv, 910, 215, 300, 150, "Your private", "GitHub repository", "repo", TEAL, g, tsize=20, sub2="backup and history")
        cv.chip(1060, 346, "you own it", TEAL, g, 13)
        flow(cv, [(650, 290), (910, 290)], t, TEAL, g)
        cv.chip(780, 262, "backup every few minutes", TEAL, g, 13)


def scene_personal(cv, t):
    A = ap(t, 0.4)
    cv.box(30, 122, 360, 320, r=18, fill=(14, 23, 41), outline=BORDER, width=1.4, a=A)
    label(cv, 50, 136, "COMPUTER 1: THE VAULT'S OWN", A)
    node(cv, 56, 168, 308, 100, "Memev vault", "the Free core", "vault", TEAL, A, sub2="one memory, one comms bus")
    node(cv, 56, 332, 308, 80, "Local AI apps", "unlimited, as in Free", "apps", TEAL, A)
    flow(cv, [(210, 268), (210, 332)], t, TEAL, A, speed=60)
    flow(cv, [(210, 332), (210, 268)], t, MINT, A, speed=60, base=False, phase=15)
    # link
    lk = ap(t, 4.8)
    node(cv, 520, 190, 220, 80, "Secure link", "optional", "link", TEAL, lk, tsize=19)
    flow(cv, [(364, 230), (520, 230)], t, TEAL, lk)
    flow(cv, [(520, 240), (364, 240)], t, MINT, lk, base=False, phase=10)
    # other computers
    for i, (x, nm) in enumerate([(836, "Computer 2"), (1040, "Computer 3")]):
        al = ap(t, 5.2 + i * 0.5)
        node(cv, x, 340, 200, 88, nm, "its own key", "computer", TEAL, al, sub2="signs each request")
        flow(cv, [(630, 270), (630, 312), (x + 100, 312), (x + 100, 340)], t, TEAL, al, speed=80, phase=i * 30)
        flow(cv, [(x + 100, 340), (x + 100, 312), (630, 312), (630, 270)], t, MINT, al, speed=80, base=False, phase=40 + i * 30)
    if t > 6:
        cv.chip(740, 312, "signed with that computer's key", AMBER, ap(t, 6.4), 13)
    # cloud
    cl = ap(t, 9.2)
    node(cv, 900, 180, 320, 100, "Cloud AI apps", "ChatGPT and other web AI apps", "cloud", TEAL, cl, sub2="up to 10 connectors")
    flow(cv, [(740, 220), (900, 220)], t, TEAL, cl)
    flow(cv, [(900, 240), (740, 240)], t, MINT, cl, base=False, phase=30)
    cv.chip(820, 200, "you can switch it off", TEAL, cl, 12)
    # relay
    r = ap(t, 12.8)
    node(cv, 440, 470, 430, 96, "Relay (optional)", "a stable address for the vault", "server", AMBER, r, dash=True,
         sub2="it only forwards bytes it cannot read")
    if r > 0:
        cv.dashed([(580, 270), (580, 470)], AMBER, 1.6, 0.5 * r, 7, 6)
        cv.chip(1040, 518, "hosted relay, sync and backup: planned", AMBER, ap(t, 15.9), 14, filled=False)


def scene_team(cv, t):
    a0 = ap(t, 0.4)
    node(cv, 50, 200, 240, 100, "Your computer", "your AI apps", "computer", TEAL, a0, sub2="and the vault owner")
    node(cv, 440, 170, 290, 130, "Shared vault", "one memory for the team", "vault", TEAL, a0,
         sub2="reached over the secure link", glow=(0.5 + 0.5 * math.sin(t * 3)) * 0.8 if 18.0 < t < 21 else 0)
    flow(cv, [(290, 240), (440, 240)], t, TEAL, a0)
    flow(cv, [(440, 255), (290, 255)], t, MINT, a0, base=False, phase=20)
    pv = ap(t, 18.4)
    if pv > 0:
        cv.chip(585, 322, "provenance: who wrote each memory", TEAL, pv, 13)
    lc = ap(t, 4.6)
    node(cv, 50, 440, 400, 110, "Counted per person", "3 computers each, pooled", "person", TEAL, lc,
         sub2="past the count, the next one is refused")
    # the invite command
    tm = ap(t, 8.6)
    if tm > 0:
        cv.box(440, 104, 470, 42, r=10, fill=(6, 10, 20), outline=BORDER, width=1.4, a=tm)
        cmd = "$ memev invite --teammate <name>"
        if t > 15.4:
            cmd += " --full"
        cv.text(456, 125, cmd, "m", 17, TEAL, tm, "lm")
    # bus rail
    br = ap(t, 12.2)
    if br > 0:
        cv.box(844, 190, 14, 185, r=7, fill=PANEL2, outline=TEAL, width=1.6, a=br)
        cv.chip(851, 165, "Team comms bus", TEAL, br, 13)
    # teammates
    for i, (y, nm) in enumerate([(180, "Teammate"), (310, "Another teammate")]):
        al = ap(t, 9.6 + i * 3.0)
        node(cv, 940, y, 300, 100, nm, "seats: <app>@<name>-<machine>", "person", TEAL, al, sub2="joined by invite",
             tsize=19, ssize=13)
    if tm > 0 and t > 9.0:
        flow(cv, [(910, 125), (1090, 125), (1090, 180)], t, AMBER, ap(t, 9.2), speed=90, spacing=40)
        cv.chip(1000, 125, "one-time invite", AMBER, ap(t, 9.6), 12)
    if br > 0:
        flow(cv, [(730, 225), (940, 225)], t, TEAL, br)
        flow(cv, [(940, 237), (730, 237)], t, MINT, br, base=False, phase=25)
        b2 = ap(t, 12.8)
        flow(cv, [(851, 345), (940, 345)], t, TEAL, b2, speed=80)
        flow(cv, [(940, 357), (851, 357)], t, MINT, b2, base=False, phase=30)
        cv.chip(790, 231, "bus only by default", TEAL, br, 12)
        fl = ap(t, 13.4)
        node(cv, 440, 350, 290, 80, "Shared folder", "optional, you pick what is in it", "folder", MINT, fl, tsize=18, ssize=14)
        flow(cv, [(585, 300), (585, 350)], t, MINT, fl, speed=50, spacing=25)
        flow(cv, [(730, 415), (900, 415), (900, 405), (940, 405)], t, MINT, fl, dashed=True)
        flow(cv, [(900, 415), (900, 265), (940, 265)], t, MINT, fl, dashed=True, phase=10)
    fu = ap(t, 15.6)
    if fu > 0:
        flow(cv, [(730, 197), (940, 197)], t, AMBER, fu, speed=100, dashed=True)
        cv.chip(790, 197, "--full: whole vault", AMBER, fu, 12, mono=True)


def scene_coming(cv, t):
    for (x, title, sub, items, t0) in [
        (50, "Business", "from 10 people", ["Company hub on your server", "Departments and roles from an org chart",
                                            "Sign-in with Google or Microsoft", "Restricted notes for a local model"], 0.4),
        (680, "Enterprise", "larger or regulated organisations", ["Your data centre or private cloud", "Air-gapped option, high availability",
                                                 "SIEM and audit export, retention, legal hold"], 4.4)]:
        al = ap(t, t0)
        cv.box(x, 140, 550, 340, r=18, fill=(14, 23, 41), outline=AMBER, width=1.6, a=al, dash=True)
        cv.text(x + 26, 160, title, "b", 30, TEXT, al)
        cv.text(x + 26, 202, sub, "r", 18, MUTED, al)
        cv.chip(x + 480, 178, "COMING", AMBER, al * (0.75 + 0.25 * math.sin(t * 3)), 14, filled=True)
        for i, it in enumerate(items):
            ia = ap(t, t0 + 0.6 + i * 0.35)
            y = 255 + i * 52
            cv.circle(x + 36, y + 12, 5, outline=AMBER, width=1.6, a=ia)
            cv.text(x + 56, y + 12, it, "r", 21, TEXT, ia, "lm")
    cv.dashed([(600, 310), (680, 310)], AMBER, 1.8, 0.7 * ap(t, 4.6), 7, 6)
    cv.text(640, 520, "Planned, not built. Priced on your requirements: contact us.", "s", 20, AMBER, ap(t, 8.4), "mm")


def scene_engine(cv, t):
    A = ap(t, 0.4)
    cv.box(40, 140, 560, 380, r=18, fill=(14, 23, 41), outline=BORDER, width=1.4, a=A)
    label(cv, 62, 156, "MEMEV CORE: THIS REPOSITORY", A)
    node(cv, 70, 200, 260, 110, "Memev core", "vault, recall, bus", "vault", TEAL, A, sub2="hooks and MCP clients")
    cv.chip(500, 158, "Apache-2.0", TEAL, A, 14)
    flow(cv, [(170, 390), (170, 310)], t, TEAL, A, speed=60, spacing=30)
    flow(cv, [(230, 310), (230, 390)], t, MINT, A, speed=60, spacing=30, base=False, phase=12)
    node(cv, 70, 390, 260, 96, "AI apps", "any app with hooks or MCP", "apps", TEAL, A, ssize=14)
    flow(cv, [(200, 390), (200, 372)], t, TEAL, 0.0)
    e = ap(t, 3.4)
    node(cv, 810, 215, 400, 130, "Convergence engine", "separate component, paid", "chip", AMBER, e, dash=True,
         sub2="under its own licence", glow=(0.5 + 0.5 * math.sin(t * 3)) * 0.7 if 3.4 < t < 9 else 0, tsize=22, ssize=16)
    cv.dashed([(700, 120), (700, 540)], AMBER, 1.6, 0.6 * e, 8, 7)
    cv.text(700, 560, "outside this repository", "s", 15, AMBER, e, "mm")
    if e > 0:
        flow(cv, [(330, 245), (810, 245)], t, AMBER, ap(t, 4.4), speed=130, spacing=80)
        flow(cv, [(810, 305), (330, 305)], t, MINT, ap(t, 4.4), speed=130, spacing=80, phase=50)
        cv.chip(520, 245, "Memev calls it", AMBER, ap(t, 4.8), 14)
        cv.chip(520, 305, "answer comes back", MINT, ap(t, 5.2), 14)


COMB = [  # layer, reveal time, caption window start, end
    ("free", 0.4, 0.5, 4.8), ("personal", 4.9, 5.0, 9.0), ("team", 9.2, 9.3, 13.8),
    ("engine", 14.0, 14.1, 18.0), ("coming", 18.2, 18.3, 21.4)]


def scene_combined(cv, t):
    def lay(name):
        for (n, rv, c0, c1) in COMB:
            if n == name:
                a = ap(t, rv, 0.7)
                focus = ap(t, c0, 0.3) * (1 - ap(t, c1, 0.4)) if t < 21.6 else 0
                fin = ap(t, 21.6, 0.5)
                return a * (0.62 + 0.38 * max(focus, fin)) if a > 0 else 0, focus
    A, fa = lay("free")
    cv.box(24, 124, 546, 330, r=18, fill=(14, 23, 41), outline=BORDER, width=1.4, a=A)
    label(cv, 44, 138, "YOUR COMPUTER", A)
    node(cv, 44, 170, 180, 110, "AI apps", "hooks + MCP", "apps", TEAL, A, glow=fa * 0.8)
    node(cv, 300, 170, 240, 150, "Vault", "plain Markdown notes", "vault", TEAL, A, glow=fa * 0.8, sub2="Apache-2.0 core")
    cv.box(44, 392, 496, 44, r=12, fill=PANEL2, outline=TEAL, width=1.6, a=A)
    cv.text(62, 414, "Comms bus", "b", 17, TEXT, A, "lm")
    cv.text(180, 414, "every app has a seat", "r", 14, MUTED, A, "lm")
    flow(cv, [(224, 220), (300, 220)], t, TEAL, A, speed=70, spacing=50)
    flow(cv, [(300, 232), (224, 232)], t, MINT, A, speed=70, spacing=50, base=False, phase=10)
    flow(cv, [(134, 280), (134, 392)], t, TEAL, A, speed=70)
    flow(cv, [(420, 320), (420, 392)], t, MINT, A, speed=70)
    # github
    node(cv, 620, 128, 260, 80, "Your private GitHub", "backup and history", "repo", TEAL, A, tsize=18, ssize=14)
    flow(cv, [(540, 190), (580, 190), (580, 168), (620, 168)], t, TEAL, A, speed=70, spacing=30)
    # personal
    P, fp = lay("personal")
    node(cv, 620, 244, 260, 80, "Secure link", "optional, or a relay", "link", TEAL, P, glow=fp * 0.8, tsize=18, ssize=14)
    node(cv, 940, 128, 300, 70, "Cloud AI apps", "web AI apps", "cloud", TEAL, P, glow=fp * 0.8, tsize=18, ssize=14)
    node(cv, 940, 214, 300, 70, "Your other computers", "up to 3, each with its own key", "computer", TEAL, P, glow=fp * 0.8, tsize=18, ssize=14)
    flow(cv, [(540, 260), (580, 260), (580, 284), (620, 284)], t, TEAL, P, speed=70, spacing=30)
    flow(cv, [(880, 284), (910, 284), (910, 163), (940, 163)], t, TEAL, P, speed=80)
    flow(cv, [(880, 284), (910, 284), (910, 249), (940, 249)], t, TEAL, P, speed=80, phase=20)
    # team
    T_, ft = lay("team")
    node(cv, 940, 308, 300, 80, "Teammates", "bus by default, --full for the vault", "person", TEAL, T_, glow=ft * 0.8, tsize=18, ssize=14)
    flow(cv, [(880, 296), (910, 296), (910, 348), (940, 348)], t, TEAL, T_, speed=80)
    flow(cv, [(940, 372), (540, 372)], t, MINT, T_, speed=110, phase=0, spacing=70)
    flow(cv, [(540, 380), (940, 380)], t, TEAL, T_, speed=110, base=False, spacing=70, phase=30)
    cv.chip(740, 350, "teammates reach the bus", TEAL, T_, 12)
    # engine
    E, fe = lay("engine")
    node(cv, 940, 456, 300, 90, "Convergence engine", "separate, paid, own licence", "chip", AMBER, E, dash=True, glow=fe * 0.8, tsize=18, ssize=14)
    flow(cv, [(540, 312), (600, 312), (600, 500), (940, 500)], t, AMBER, E, speed=110, spacing=60)
    flow(cv, [(940, 516), (620, 516), (620, 330), (540, 330)], t, MINT, E, speed=110, spacing=60, base=False, phase=30)
    cv.dashed([(790, 440), (790, 560)], AMBER, 1.4, 0.0, 8, 7)
    cv.chip(770, 480, "called by Memev", AMBER, E, 12)
    cv.text(1090, 566, "outside this repository", "s", 13, AMBER, E, "mm")
    # coming
    C, fc_ = lay("coming")
    node(cv, 44, 480, 496, 90, "Business and Enterprise", "company hub, roles, sign-in, your data centre", "hub", AMBER, C, dash=True, glow=fc_ * 0.8, tsize=18, ssize=14)
    cv.chip(470, 498, "COMING", AMBER, C, 13, filled=True)
    cv.dashed([(300, 480), (300, 436)], AMBER, 1.6, 0.7 * C, 7, 6)


def end_card(cv, t):
    a = ap(t, 21.8, 0.7)
    if a <= 0:
        return
    cv.box(0, 0, W, H, r=0, fill=BG1, a=0.97 * a)
    cv.text(640, 250, "Memev", "b", 104, TEXT, a, "mm")
    cv.box(560, 312, 160, 4, r=2, fill=TEAL, a=a)
    cv.text(640, 362, "One memory and one team channel, both on computers you own.", "r", 27, MUTED, ap(t, 22.2, 0.7), "mm")
    cv.text(640, 430, "Free, Personal and Team build on today's core. Business and Enterprise are coming.", "s", 22, TEAL, ap(t, 22.8, 0.7), "mm")
    cv.text(640, 490, "Details: docs/tiers/README.md and docs/PRICING.md (draft)", "m", 18, MUTED, ap(t, 23.4, 0.7), "mm")


# ---------------- storyboard ----------------
SCENES = [
    dict(key="title", dur=7.0, fn=scene_title, head=None, active=[],
         caps=[(2.4, 6.8, "Five tiers: Free, Personal, Team, Business and Enterprise. Business and Enterprise are coming.")]),
    dict(key="free", dur=20.4, fn=scene_free, active=[0],
         head=("Free", "One person, one computer  \u00b7  free, for good"),
         caps=[(0.5, 5.4, "Free: one person, one computer. Complete, and never limited."),
               (5.6, 9.8, "Hooks and MCP hand each app the few notes that match what you ask."),
               (10.0, 13.8, "Notes are plain Markdown in git. Every change is written to a checksummed log first."),
               (14.0, 17.0, "Each app gets a seat on the comms bus, so your apps can talk to each other."),
               (17.2, 20.2, "Backup goes to a private GitHub repository that you own.")]),
    dict(key="personal", dur=18.6, fn=scene_personal, active=[1],
         head=("Personal", "One person, up to 3 computers  \u00b7  $15/month or $144/year (draft)"),
         caps=[(0.5, 4.6, "Personal: the same Free core on up to 3 computers, with one memory and one comms bus."),
               (4.8, 9.0, "Each added computer makes its own key and signs every request. A copied token is refused."),
               (9.2, 12.6, "Cloud AI apps reach the vault over the optional secure link. You can switch it off."),
               (12.8, 15.7, "A relay can give the vault a stable address. It only forwards bytes it cannot read."),
               (15.9, 18.4, "The hosted relay, sync and backup are planned, not built.")]),
    dict(key="team", dur=21.6, fn=scene_team, active=[2],
         head=("Team", "2 to 20 people  \u00b7  contact us until member keys ship"),
         caps=[(0.5, 4.4, "Team: one shared vault for 2 to 20 people, reached over the secure link."),
               (4.6, 8.4, "Sold per person: 3 computers each, pooled. Past the count, the vault refuses the next one."),
               (8.6, 12.0, "A teammate joins with a one-time invite made on the vault's computer."),
               (12.2, 15.3, "By default a teammate gets the comms bus, plus an optional shared folder."),
               (15.5, 17.9, "Full vault access only if you pass --full."),
               (18.0, 21.4, "Provenance shows who wrote each memory. A key for each person is planned.")]),
    dict(key="coming", dur=11.4, fn=scene_coming, active=[3, 4],
         head=("Business and Enterprise", "Coming  \u00b7  contact us"),
         caps=[(0.5, 4.2, "Business, from 10 people: a company hub on your server, with roles and sign-in. Coming."),
               (4.4, 8.2, "Enterprise: your data centre, an air-gapped option, audit export. Coming."),
               (8.4, 11.2, "Both are planned, not built, and priced on request.")]),
    dict(key="engine", dur=11.0, fn=scene_engine, active=[5],
         head=("The paid convergence engine", "A separate component, under its own licence"),
         caps=[(0.5, 4.6, "The paid convergence engine is a separate component under its own licence."),
               (4.8, 10.8, "Memev calls it. It is not part of this repository, and the core stays Apache-2.0.")]),
    dict(key="combined", dur=26.0, fn=scene_combined, active=[0, 1, 2, 3, 4, 5],
         head=("How the tiers connect", "Every tier builds on the same local vault and comms bus"),
         caps=[(0.5, 4.8, "Free: your AI apps, the vault and the bus on one computer, backed up to your own GitHub."),
               (5.0, 9.0, "Personal: your other computers and cloud AI apps join over the secure link."),
               (9.3, 13.8, "Team: teammates join the bus by invite. The vault stays yours unless you pass --full."),
               (14.1, 18.0, "The paid convergence engine is separate. Memev calls it from outside the core."),
               (18.3, 21.4, "Business and Enterprise: coming. Planned, not built.")]),
]
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
    cv = Cv()
    sc["fn"](cv, t)
    if sc["head"]:
        active = sc["active"]
        if sc["key"] == "combined":   # the tier chips light up as each layer joins the diagram
            order = [(0.4, [0]), (4.9, [1]), (9.2, [2]), (14.0, [5]), (18.2, [3, 4])]
            active = [i for (rv, ids) in order if t >= rv for i in ids]
        header(cv, sc["head"][0], sc["head"][1], active, ap(t, 0.1, 0.5))
    caption(cv, sc["caps"], t)
    if sc["key"] == "combined":
        end_card(cv, t)
    im = cv.im
    fade = min(ap(t, 0.0, 0.45), 1 - ap(t, sc["dur"] - 0.45, 0.45)) if sc["key"] not in ("title",) else ap(t, 0, 0.6)
    if sc["key"] == "combined":
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
    ap_.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    a = ap_.parse_args()
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
        vf = ("fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=32:stats_mode=diff[p];"
              "[b][p]paletteuse=dither=none:diff_mode=rectangle")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-vf", vf, "-loop", "0", gif], check=True)
        print(gif)
    return 0


if __name__ == "__main__":
    sys.exit(main())
