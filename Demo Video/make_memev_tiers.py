#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Renders the Memev tiers demo video (explainer graphics drawn in code, in a neutral corporate style).

Output: memev-tiers.mp4 (1280x720, 30 fps, H.264) and memev-tiers.gif (a small inline preview, under 8 MB).

Needs: Python 3.9+, Pillow, ffmpeg on PATH. Nothing else.

    python3 make_memev_tiers.py                  # render the mp4 and the gif next to this script
    python3 make_memev_tiers.py --out /tmp/demo  # render somewhere else
    python3 make_memev_tiers.py --stills 3,20,60 --out /tmp/demo   # PNG stills at those seconds only
    python3 make_memev_tiers.py --no-gif         # mp4 only
    python3 make_memev_tiers.py --audit          # check caption timing, text contrast and text overlaps, and stop

Every word on screen is in this file (see SCENES). It shows no prices, and no number of days, seats or
computers for the Business trial. Anything not built yet is labelled coming or planned. Caption timing:
2 s plus 0.35 s per word, never under 4 s, then a short pause on each scene's summary.

Look: off-white background, charcoal and navy text and shapes, mid greys, and one muted steel-blue accent
used only for the active element and for data flow. No glow, gradient or particle effect, and no pulsing.
"""
import argparse
import math
import os
import subprocess
import sys
from multiprocessing import Pool

from PIL import Image, ImageDraw, ImageFont

W, H, S, FPS = 1280, 720, 2, 30          # logical size, supersampling factor, frames per second
GIF_W, GIF_FPS, GIF_COLORS = 720, 4, 32  # the inline preview: kept under 8 MB for GitHub

# ---- palette: off-white, charcoal and navy, mid greys, one steel-blue accent ----
BG = (245, 245, 243)                      # page
WHITE = (255, 255, 255)                   # node fill
ZONE = (236, 237, 234)                    # a grouped area
TINT = (228, 230, 230)                    # a quiet fill
INK = (31, 42, 55)                        # primary text, #1F2A37
NAVY = (43, 58, 74)                       # primary shapes, #2B3A4A
SLATE = (84, 96, 110)                     # planned or coming shapes and the hard boundary
MUTED = (82, 93, 106)                     # secondary text
RULE = (172, 178, 186)                    # thin strokes
LIGHT = (205, 209, 213)                   # hairlines
ACCENT = (74, 107, 138)                   # steel blue, #4A6B8A: the active element and data flow only
TEAL, AMBER, MINT = NAVY, SLATE, ACCENT   # tier colours used by the scenes below: built, planned, flow

# ---- fonts: Inter if installed, then IBM Plex Sans or Source Sans, otherwise DejaVu ----
FONT_DIRS = ["/usr/share/fonts/truetype/sand-box/google", "/usr/share/fonts/truetype", "/usr/share/fonts",
             os.path.expanduser("~/.fonts"), os.path.expanduser("~/Library/Fonts"), "/Library/Fonts",
             "/System/Library/Fonts/Supplemental"]


def find_font(names):
    for n in names:                                  # earlier names win
        for d in FONT_DIRS:
            for root, _dirs, files in os.walk(d):
                if n in files:
                    return os.path.join(root, n)
    return None


SANS_PATH = find_font(["Inter-VariableFont_opsz,wght.ttf", "Inter.ttf", "IBMPlexSans-VariableFont_wdth,wght.ttf",
                       "IBMPlexSans-Regular.ttf", "SourceSans3-VariableFont_wght.ttf", "DejaVuSans.ttf", "Arial.ttf"])
SANS_BOLD = find_font(["DejaVuSans-Bold.ttf", "Arial Bold.ttf"])   # used only when the sans has no weight axis
_fc = {}


def font(kind, size):
    key = (kind, size)
    if key in _fc:
        return _fc[key]
    px = int(round(size * S))
    wght = {"r": 420, "s": 560, "b": 680}[kind]
    f = ImageFont.truetype(SANS_PATH, px)
    try:
        axes = f.get_variation_axes()
        vals = []
        for ax in axes:
            nm = ax["name"].decode() if isinstance(ax["name"], bytes) else str(ax["name"])
            if nm.lower().startswith("weight"):
                vals.append(max(ax["minimum"], min(ax["maximum"], wght)))
            elif nm.lower().startswith("optical"):
                vals.append(max(ax["minimum"], min(ax["maximum"], 20)))
            elif nm.lower().startswith("width"):
                vals.append(100)
            else:
                vals.append(ax["default"])
        f.set_variation_by_axes(vals)
    except Exception:
        if kind != "r" and SANS_BOLD:
            f = ImageFont.truetype(SANS_BOLD, px)
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


def lerp_col(c1, c2, k):
    return tuple(int(lerp(c1[i], c2[i], k)) for i in range(3))


_bg = None
AUDIT = None                               # a list while --audit runs
DOTS = True                                # moving dots on the connectors (off only when comparing frames)


def background():
    global _bg
    if _bg is None:
        _bg = Image.new("RGB", (W * S, H * S), BG)
    return _bg


def contrast(c1, c2):
    def lum(c):
        v = []
        for x in c:
            x = x / 255.0
            v.append(x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4)
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    a, b = lum(c1), lum(c2)
    if a < b:
        a, b = b, a
    return (a + 0.05) / (b + 0.05)


class Cv:
    def __init__(self):
        self.im = background().copy()
        self.d = ImageDraw.Draw(self.im, "RGBA")

    def box(self, x, y, w, h, r=4, fill=None, outline=None, width=1.3, a=1.0, dash=False):
        if a <= 0.01:
            return
        s = S
        if fill is not None:
            self.d.rounded_rectangle([x * s, y * s, (x + w) * s, (y + h) * s], r * s, fill=rgba(fill, a))
        if outline is not None:
            if dash:
                self.dashed([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)], outline, width, a, 7, 5)
            else:
                self.d.rounded_rectangle([x * s, y * s, (x + w) * s, (y + h) * s], r * s, outline=rgba(outline, a),
                                         width=max(1, int(width * s)))

    def line(self, pts, color, width=1.3, a=1.0):
        if a <= 0.01:
            return
        self.d.line([(px * S, py * S) for px, py in pts], fill=rgba(color, a), width=max(1, int(width * S)), joint="curve")

    def dashed(self, pts, color, width=1.3, a=1.0, dash=7, gap=5):
        if a <= 0.01:
            return
        for seg in dash_segments(pts, dash, gap):
            self.line(seg, color, width, a)

    def circle(self, x, y, r, fill=None, outline=None, width=1.3, a=1.0):
        if a <= 0.01:
            return
        s = S
        self.d.ellipse([(x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s],
                       fill=rgba(fill, a) if fill else None, outline=rgba(outline, a) if outline else None,
                       width=max(1, int(width * s)))

    def arc(self, x, y, r, start, end, color, width=2.0, a=1.0):
        if a <= 0.01 or end <= start:
            return
        self.d.arc([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], start, end, fill=rgba(color, a),
                   width=max(1, int(width * S)))

    def text(self, x, y, s, kind="r", size=20, color=INK, a=1.0, anchor="la"):
        if a <= 0.01 or not s:
            return
        f = font(kind, size)
        if AUDIT is not None:
            bb = self.d.textbbox((x * S, y * S), s, font=f, anchor=anchor)
            crop = self.im.crop((max(0, bb[0]), max(0, bb[1]), min(W * S, bb[2]), min(H * S, bb[3])))
            cols = crop.getcolors(maxcolors=1 << 20) or [(1, BG)]
            bgc = max(cols, key=lambda c: c[0])[1][:3]
            eff = tuple(int(round(color[i] * a + bgc[i] * (1 - a))) for i in range(3))
            AUDIT.append(dict(text=s, bbox=tuple(v / S for v in bb), a=a, ratio=contrast(eff, bgc), size=size,
                              fg=eff, bg=bgc))
        self.d.text((x * S, y * S), s, font=f, fill=rgba(color, a), anchor=anchor)

    def tw(self, s, kind, size):
        return font(kind, size).getlength(s) / S

    def chip(self, cx, cy, s, color=NAVY, a=1.0, size=14, filled=False, kind="s", padx=10):
        """A small flat label. Outlined: dark text on white. Filled: white text on the colour."""
        if a <= 0.01:
            return 0
        w = self.tw(s, kind, size) + 2 * padx
        h = size + 11
        self.box(cx - w / 2, cy - h / 2, w, h, r=3, fill=color if filled else WHITE, outline=color, width=1.2, a=a)
        self.text(cx, cy + 0.5, s, kind, size, WHITE if filled else (INK if color in (NAVY, ACCENT) else color), a, "mm")
        return w

    def stamp(self, cx, cy, s, a=1.0, size=13):
        """COMING or PLANNED: a filled slate stamp."""
        return self.chip(cx, cy, s, SLATE, a, size, filled=True, kind="b", padx=9)


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


def flow(cv, pts, t, color=NAVY, a=1.0, speed=80, rev=False, dashed=False, base=True, phase=0.0, spacing=90):
    """A thin connector with a small dot moving along it. The dot is the accent colour; planned links are dashed."""
    if a <= 0.01:
        return
    dashed = dashed or color == SLATE
    if base:
        if dashed:
            cv.dashed(pts, RULE, 1.2, a, 6, 5)
        else:
            cv.line(pts, RULE, 1.2, a)
    if not DOTS:
        return
    L = path_len(pts)
    n = max(1, int(L / spacing))
    for i in range(n):
        s = ((t * speed + phase + i * L / n) % L)
        d = L - s if rev else s
        edge = min(1.0, s / 18.0, (L - s) / 18.0)
        x, y = path_at(pts, d)
        cv.circle(x, y, 3.3, fill=ACCENT, a=a * edge)


# ---------------- icons: thin line, monochrome ----------------
def icon(cv, kind, cx, cy, color, a=1.0):
    lw = 1.5
    if kind == "apps":
        for dx, dy in [(-9, -8), (3, -8), (-9, 4)]:
            cv.box(cx + dx, cy + dy, 12, 10, r=2, outline=color, width=lw, a=a)
    elif kind == "vault":
        for i in range(3):
            cv.box(cx - 10 + i * 3, cy - 12 + i * 3, 17, 20, r=2, fill=WHITE, outline=color, width=lw, a=a)
        cv.line([(cx - 3, cy + 1), (cx + 3, cy + 1)], color, 1.2, a)
        cv.line([(cx - 3, cy + 5), (cx + 1, cy + 5)], color, 1.2, a)
    elif kind == "bus":
        cv.line([(cx - 13, cy), (cx + 13, cy)], color, 2.0, a)
        for dx in (-9, 0, 9):
            cv.circle(cx + dx, cy, 3.2, fill=WHITE, outline=color, width=1.4, a=a)
            cv.line([(cx + dx, cy - 3), (cx + dx, cy - 9)], color, 1.2, a)
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
        cv.box(cx - 13, cy + 2, 26, 8, r=4, fill=WHITE, a=a)
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
            cv.line([(cx + k, cy - 9), (cx + k, cy - 14)], color, 1.2, a)
            cv.line([(cx + k, cy + 9), (cx + k, cy + 14)], color, 1.2, a)
    elif kind == "hub":
        cv.box(cx - 10, cy - 11, 20, 22, r=2, outline=color, width=lw, a=a)
        for dx in (-4, 4):
            for dy in (-5, 1):
                cv.box(cx + dx - 1.5, cy + dy - 1.5, 3, 3, fill=color, a=a)
    elif kind == "doc":
        cv.box(cx - 9, cy - 12, 18, 24, r=2, outline=color, width=lw, a=a)
        for k in (-5, 0, 5):
            cv.line([(cx - 5, cy + k), (cx + 5, cy + k)], color, 1.1, a)


def node(cv, x, y, w, h, title, sub=None, ic=None, color=NAVY, a=1.0, dash=False, hl=False, tsize=19, ssize=15,
         sub_color=MUTED, sub2=None, fill=WHITE):
    """A flat rectangular node. Planned things are dashed slate. hl draws the active accent outline."""
    if a <= 0.01:
        return
    col = ACCENT if hl else color
    cv.box(x, y, w, h, r=4, fill=fill, outline=col, width=2.0 if hl else 1.4, a=a, dash=dash and not hl)
    tx = x + 16
    if ic:
        icon(cv, ic, x + 30, y + 31, color, a)
        tx = x + 58
    cv.text(tx, y + 12, title, "b", tsize, INK, a)
    if sub:
        cv.text(tx, y + 12 + tsize + 6, sub, "r", ssize, sub_color, a)
    if sub2:
        cv.text(tx, y + 12 + tsize + 6 + ssize + 5, sub2, "r", ssize, sub_color, a)
    if AUDIT is not None:
        room = w - (tx - x) - 8
        for s_, k_, z_ in ((title, "b", tsize), (sub, "r", ssize), (sub2, "r", ssize)):
            if s_ and cv.tw(s_, k_, z_) > room and a > 0.97:
                AUDIT.append(dict(text=s_, bbox=(x, y, x + w, y + h), a=a, ratio=99, size=z_, overflow=True))


def label(cv, x, y, s, a=1.0, color=MUTED):
    cv.text(x, y, s, "s", 14, color, a)


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


def ptext(cv, x, y, s, size, maxw, color=MUTED, a=1.0, kind="r", lh=None):
    """Wrapped paragraph. Returns the number of lines."""
    lh = lh or size + 6
    lines = wrap(cv, s, kind, size, maxw)
    for i, ln in enumerate(lines):
        cv.text(x, y + i * lh, ln, kind, size, color, a)
    return len(lines)


# ---------------- shared chrome: header, tier tracker, caption bar ----------------
TRACK = [("Personal", False), ("More computers", False), ("Business", True), ("Corporate", True), ("Paid engine", False)]


def header(cv, title, sub, active, a=1.0):
    cv.text(40, 26, title, "b", 34, INK, a)
    cv.text(40, 72, sub, "r", 18, MUTED, a)
    cv.line([(40, 104), (1240, 104)], LIGHT, 1.0, a)
    x = 1240
    for idx in range(len(TRACK) - 1, -1, -1):
        name, planned = TRACK[idx]
        w = cv.tw(name, "s", 14) + 24
        x -= w
        on = idx in active
        cv.box(x, 32, w, 28, r=3, fill=NAVY if on else WHITE, outline=NAVY if on else RULE, width=1.2, a=a,
               dash=planned and not on)
        cv.text(x + w / 2, 46.5, name, "s", 14, WHITE if on else MUTED, a, "mm")
        x -= 8


def caption(cv, caps, t):
    for (t0, t1, s) in caps:
        if not s:
            continue
        a = min(ap(t, t0, 0.35), 1 - ap(t, t1 - 0.35, 0.35))
        if a <= 0.01:
            continue
        cv.box(40, 618, 1200, 78, r=4, fill=WHITE, outline=RULE, width=1.2, a=a)
        cv.box(40, 618, 4, 78, r=0, fill=NAVY, a=a)
        lines = wrap(cv, s, "r", 25, 1130)
        lh = 31
        y0 = 618 + 39 - lh * len(lines) / 2 + 2
        for i, ln in enumerate(lines):
            cv.text(66, y0 + i * lh + lh / 2, ln, "r", 25, INK, a, "lm")


def schedule(texts, start=0.5, gap=0.2):
    """Caption timing: each caption is held for 2 s plus 0.35 s per word, and never under 4 s."""
    out, t = [], start
    for s in texts:
        d = max(4.0, 2.0 + 0.35 * len(s.split()))
        out.append((t, t + d, s))
        t += d + gap
    return out


def tick(cv, x, y, a, color=NAVY):
    cv.circle(x, y, 11, fill=color, a=a)
    cv.line([(x - 5, y), (x - 1.5, y + 4), (x + 5.5, y - 4)], WHITE, 2.2, a)


def toggle(cv, x, y, on, a=1.0):
    """A small on/off switch; on is 0..1."""
    cv.box(x, y, 44, 22, r=11, fill=lerp_col(RULE, ACCENT, on), a=a)
    cv.circle(x + 11 + 22 * on, y + 11, 8, fill=WHITE, a=a)


def noentry(cv, x, y, a=1.0, r=11):
    cv.circle(x, y, r, fill=WHITE, outline=SLATE, width=2.0, a=a)
    cv.line([(x - r * 0.7, y + r * 0.7), (x + r * 0.7, y - r * 0.7)], SLATE, 2.0, a)


def person_badge(cv, x, y, a=1.0):
    cv.circle(x, y, 15, fill=WHITE, outline=NAVY, width=1.4, a=a)
    icon(cv, "person", x, y + 2, NAVY, a)


def stamp_corner(cv, t, t0, text="COMING"):
    cv.stamp(1190, 82, text, ap(t, t0))


# ---------------- scene timing: one function decides how long a slide stays ----------------
CAP_W, LABEL_W, ELEM_W, BASE_HOLD, MIN_HOLD = 0.35, 0.25, 0.6, 2.0, 4.0
STAGGER, FADE = 0.35, 0.5                 # reveal pacing: how elements are brought in


def slide_timing(caption, labels, elements, anim=None):
    """How long one slide (a caption and the diagram it explains) stays on screen, in seconds.

    hold = 2.0 s + 0.35 s per caption word + 0.25 s per other visible label word + 0.6 s per diagram element
    that appears or moves, never under 4 s and with no upper cap. The animation time (the reveal of the
    elements) is added on top, because every word must be fully on screen for the whole hold, and a slide
    never changes while a reveal is still running.
    Returns (hold, anim, total, caption_words, label_words)."""
    cw = len(caption.split())
    lw = sum(len(s.split()) for s in labels)
    if anim is None:
        anim = (FADE + STAGGER * (elements - 1)) if elements else 0.0
    hold = max(MIN_HOLD, BASE_HOLD + CAP_W * cw + LABEL_W * lw + ELEM_W * elements)
    return hold, anim, anim + hold, cw, lw


def P(cap, labels, els, anim=None):
    return dict(cap=cap, labels=labels, els=els, anim=anim)


# ---------------- scenes: cs[i] is the start time of phase i (its caption and its reveals) ----------------
def scene_title(cv, t, cs):
    a = ap(t, 0.2, 0.8)
    cv.text(640, 150, "Memev", "b", 100, INK, a, "mm")
    cv.box(600, 212, 80 * ap(t, 0.6, 0.8) * 2, 3, r=0, fill=NAVY, a=a)
    cv.text(640, 300, "How each tier works, and how the tiers connect", "s", 22, INK, ap(t, 1.4, 0.8), "mm")
    tiers = [("Personal", "one computer, the free core", False), ("Personal", "with more computers", False),
             ("Business", "coming", True), ("Corporate", "coming", True)]
    x0, w, gap, y = 40, 270, 40, 390
    for i, (n, s, planned) in enumerate(tiers):
        al = ap(t, 2.0 + i * 0.5, 0.6)
        node(cv, x0 + i * (w + gap), y, w, 90, n, s, None, SLATE if planned else NAVY, al, dash=planned, tsize=24, ssize=17)
    al = ap(t, 3.4, 0.6)
    flow(cv, [(x0 + w, y + 45), (x0 + w + gap, y + 45)], t, NAVY, al, speed=40, spacing=20)
    xw = x0 + 2 * w + 1.5 * gap                      # the wall between personal and work
    cv.box(xw - 4, y - 14, 8, 118, r=0, fill=SLATE, a=ap(t, 3.8, 0.6))
    flow(cv, [(x0 + 3 * w + 2 * gap, y + 45), (x0 + 3 * (w + gap), y + 45)], t, SLATE, ap(t, 4.2, 0.6), speed=40,
         dashed=True, spacing=20)
    cv.text(640, 530, "Personal and work stay separate.", "s", 21, INK, ap(t, 4.8, 0.6), "mm")


TITLE_P = [P("Personal, Personal with more computers, Business and Corporate. The last two are coming.",
             ["Memev",
              "How each tier works, and how the tiers connect", "Personal one computer, the free core",
              "Personal with more computers", "Business coming", "Corporate coming",
              "Personal and work stay separate."], 6, anim=5.4)]


def scene_personal(cv, t, cs):
    c0, c1, c2 = cs
    cv.box(30, 122, 780, 478, r=4, fill=ZONE, outline=RULE, width=1.2, a=ap(t, c0))
    label(cv, 52, 136, "Your computer", ap(t, c0))
    apps = [("Cursor", 175), ("Codex", 255), ("Gemini CLI", 335)]
    va = ap(t, c0 + 0.3)
    node(cv, 420, 175, 230, 220, "Memev vault", "plain Markdown notes", "vault", NAVY, va, sub2="in ~/memev, kept in git")
    cv.chip(535, 380, "Core: Apache-2.0", NAVY, ap(t, c0 + 0.9), 14)
    for i, (n, y) in enumerate(apps):
        al = ap(t, c1 + i * 0.3)
        node(cv, 64, y, 190, 58, n, None, None, NAVY, al, tsize=18, ssize=15)
        yc = y + 29
        f = ap(t, c1 + 0.9 + i * 0.3)
        flow(cv, [(254, yc - 6), (420, yc - 6)], t, NAVY, f)
        flow(cv, [(420, yc + 6), (254, yc + 6)], t, NAVY, f, phase=40)
    cv.text(64, 405, "and other AI apps", "r", 15, MUTED, ap(t, c1 + 0.6))
    cv.chip(337, 362, "your prompt", NAVY, ap(t, c1 + 1.8), 14)
    cv.chip(337, 392, "matching notes", ACCENT, ap(t, c1 + 2.3), 14)
    b = ap(t, c1 + 3.4)
    if b > 0:
        cv.box(90, 480, 640, 46, r=4, fill=WHITE, outline=NAVY, width=1.4, a=b)
        cv.text(110, 503, "Comms bus", "b", 18, INK, b, "lm")
        cv.text(230, 503, "every app has a seat", "r", 15, MUTED, b, "lm")
        for i, dx in enumerate((590, 625, 660)):
            cv.circle(dx, 503, 6, fill=NAVY, a=b)
        for _, y in apps:
            flow(cv, [(64, y + 29), (48, y + 29), (48, 502), (90, 502)], t, NAVY, b, speed=60, phase=y, spacing=140)
        flow(cv, [(535, 480), (535, 395)], t, NAVY, b, speed=50, spacing=60)
    for i in range(3):
        ya = 256 + i * 32
        k = ap(t, c2 + 0.2 + i * 0.4, 0.5)
        cv.box(440, ya, 190, 26, r=3, fill=ZONE, outline=RULE, width=1.0, a=k)
        cv.text(450, ya + 13.5, ["a decision, saved", "a fact, saved", "where you left off"][i], "r", 15, INK, k, "lm")
    g = ap(t, c2 + 1.6)
    if g > 0:
        node(cv, 930, 215, 300, 150, "Your private", "GitHub repository", "repo", NAVY, g, tsize=20, sub2="backup and history")
        cv.chip(1080, 348, "you own it", NAVY, g, 14)
        flow(cv, [(650, 290), (930, 290)], t, NAVY, g, speed=70)
        cv.chip(790, 262, "backup every few minutes", ACCENT, g, 14)


PERSONAL_P = [
    P("Personal: one person, one computer, with the free core.",
      ["Your computer", "Memev vault", "plain Markdown notes", "in ~/memev, kept in git", "Core: Apache-2.0"], 3, anim=1.6),
    P("Hooks and MCP give each app the notes that match, and a seat on the comms bus.",
      ["Cursor", "Codex", "Gemini CLI", "and other AI apps", "your prompt",
       "matching notes", "Comms bus", "every app has a seat"], 11, anim=4.0),
    P("Notes are plain Markdown, backed up to a private GitHub repository you own.",
      ["a decision, saved", "a fact, saved", "where you left off", "Your private", "GitHub repository",
       "backup and history", "you own it", "backup every few minutes"], 6, anim=3.0),
]


def scene_more(cv, t, cs):
    c0, c1, c2 = cs
    A = ap(t, c0)
    cv.box(30, 122, 360, 320, r=4, fill=ZONE, outline=RULE, width=1.2, a=A)
    label(cv, 50, 136, "Computer 1", A)
    node(cv, 56, 168, 308, 100, "Personal vault", "the same vault, on every computer", "vault", NAVY, A, sub2="one memory, one comms bus", ssize=15)
    node(cv, 56, 332, 308, 80, "Local AI apps", "as in Personal", "apps", NAVY, A)
    flow(cv, [(210, 268), (210, 332)], t, NAVY, A, speed=50, spacing=60)
    sw_on = ap(t, c1 + 5.4, 0.5)                    # the person switches the secure link on
    lk = ap(t, c1 + 0.2)
    node(cv, 510, 190, 250, 80, "Secure link", "off until you switch it on" if sw_on < 0.5 else "switched on by you", "link",
         NAVY if sw_on > 0.5 else SLATE, lk, dash=sw_on < 0.5, hl=sw_on > 0.5, tsize=19, ssize=15)
    toggle(cv, 712, 200, sw_on, lk)
    for i, (x, nm) in enumerate([(816, "Computer 2"), (1030, "Computer 3")]):
        al = ap(t, c1 + 1.0 + i * 0.5)
        node(cv, x, 340, 200, 88, nm, "its own key", "computer", NAVY, al)
        fa = min(al, sw_on)
        pts = [(630, 270), (630, 312), (x + 100, 312), (x + 100, 340)]
        flow(cv, pts, t, NAVY, fa, speed=70, phase=i * 40)
        if sw_on < 1:
            cv.dashed(pts, RULE, 1.2, al * (1 - sw_on), 6, 5)
    cl = ap(t, c1 + 2.0)
    node(cv, 900, 180, 320, 100, "Cloud AI apps", "ChatGPT and more", "cloud", NAVY, cl)
    flow(cv, [(364, 230), (510, 230)], t, NAVY, min(lk, sw_on))
    flow(cv, [(760, 230), (900, 230)], t, NAVY, min(cl, sw_on))
    if sw_on < 1:
        cv.dashed([(364, 230), (510, 230)], RULE, 1.2, lk * (1 - sw_on), 6, 5)
        cv.dashed([(760, 230), (900, 230)], RULE, 1.2, cl * (1 - sw_on), 6, 5)
    if t > c1 + 6.0:
        cv.chip(820, 168, "you can switch it off again", NAVY, ap(t, c1 + 6.0), 14)
    if t > c1 + 4.0:
        cv.chip(780, 312, "signed with that computer's key", ACCENT, ap(t, c1 + 4.0), 14)
    r = ap(t, c2)
    node(cv, 440, 470, 430, 96, "Relay (optional)", "a stable address for the vault", "hub", SLATE, r, dash=True,
         sub2="it only forwards bytes it cannot read")
    if r > 0:
        cv.dashed([(580, 270), (580, 470)], RULE, 1.3, r, 6, 5)
        cv.stamp(1040, 518, "PLANNED", ap(t, c2 + 1.0))
        cv.text(1040, 548, "hosted relay and sync", "s", 15, INK, ap(t, c2 + 1.0), "mm")


MORE_P = [
    P("Personal with more computers: the same personal vault on several computers.",
      ["Computer 1", "Personal vault", "the same vault, on every computer", "one memory, one comms bus", "Local AI apps",
       "as in Personal"], 3, anim=1.6),
    P("Each added computer has its own key. They join over the secure link, off until you switch it on.",
      ["Secure link", "off until you switch it on", "switched on by you", "Computer 2", "its own key",
       "Computer 3", "its own key", "Cloud AI apps", "ChatGPT and more",
       "signed with that computer's key", "you can switch it off again"], 9, anim=6.8),
    P("A relay can give a stable address. Hosted sync and relay are planned.",
      ["Relay (optional)", "a stable address for the vault", "it only forwards bytes it cannot read", "PLANNED",
       "hosted relay and sync"], 3, anim=2.0),
]


def scene_boundary(cv, t, cs):
    c0, c1 = cs
    z = ap(t, c0)
    cv.box(30, 142, 520, 430, r=4, fill=ZONE, outline=NAVY, width=1.4, a=z)
    label(cv, 52, 156, "Personal or home", z, INK)
    node(cv, 70, 200, 300, 100, "Personal vault", None, "vault", NAVY, z)
    node(cv, 70, 360, 300, 80, "Your AI apps", None, "apps", NAVY, z)
    flow(cv, [(220, 360), (220, 300)], t, NAVY, z, speed=50, spacing=60)
    cv.box(730, 142, 520, 430, r=4, fill=ZONE, outline=SLATE, width=1.4, a=z, dash=True)
    label(cv, 752, 156, "Business or Corporate", z, INK)
    cv.stamp(1180, 160, "COMING", z)
    node(cv, 880, 200, 330, 100, "Work vault", None, "vault", SLATE, z, dash=True)
    node(cv, 880, 360, 330, 80, "Company vault", "company-owned", "hub", SLATE, z, dash=True)
    w = ap(t, c0 + 1.2, 0.8)
    cv.box(626, 142, 8, 430, r=0, fill=SLATE, a=w)
    cv.chip(630, 128, "hard boundary", SLATE, w, 14, filled=True)
    f = ap(t, c0 + 2.2)
    for yy in (250, 400):
        flow(cv, [(370, yy), (596, yy)], t, NAVY, f, speed=70, spacing=120)
        flow(cv, [(880, yy), (664, yy)], t, SLATE, f, speed=70, spacing=120)
        noentry(cv, 614, yy, f, 9)
        noentry(cv, 646, yy, f, 9)
    cv.chip(630, 590, "no grant, no release, no live query", NAVY, ap(t, c0 + 3.4), 14)
    k = ap(t, c1)
    for x, col in ((310, NAVY), (1040, SLATE)):
        cv.chip(x, 500, "own identity", col, k, 14)
        cv.chip(x, 534, "own keys", col, k, 14)


BOUNDARY_P = [
    P("A personal or home vault never crosses into Business or Corporate.",
      ["Personal or home", "Personal vault", "Your AI apps",
       "Business or Corporate", "COMING", "Work vault", "Company vault", "company-owned", "hard boundary",
       "no grant, no release, no live query"], 10, anim=4.4),
    P("Each side has its own identity and keys, with no grant and no live query. Someone with both uses two identities.",
      ["own identity", "own keys", "own identity", "own keys"], 4, anim=1.4),
]


# ---------------- Business: members, work vaults, the company vault ----------------
def scene_business(cv, t, cs):
    c0, c1, c2 = cs
    stamp_corner(cv, t, c0)
    ys = [140, 255, 370]
    names = ["Member A", "Member B", "Member C"]
    for i, y in enumerate(ys):
        k = c0 + i * 0.4 if i < 2 else c1 + 1.6
        al = ap(t, k)
        node(cv, 30, y, 250, 90, names[i], "AI apps and a computer", "person", NAVY, al, ssize=15)
        wv = ap(t, k + 0.5)
        node(cv, 350, y, 250, 90, "Work vault", "company-owned" if i < 2 else "new member: bus only", "vault", SLATE, wv, dash=True,
             ssize=15)
        flow(cv, [(280, y + 35), (350, y + 35)], t, NAVY, wv, speed=50, spacing=80)
    cvl = ap(t, c0 + 1.6)
    node(cv, 780, 235, 300, 120, "Company vault", "shared, company-owned", "hub", SLATE, cvl, dash=True)
    # B2: an organisation admin invites members into the company vault
    ad = ap(t, c1)
    node(cv, 800, 128, 260, 76, "Organisation admin", "invites members", "person", NAVY, ad, tsize=18, ssize=15)
    inv = ap(t, c1 + 0.8)
    flow(cv, [(930, 204), (930, 235)], t, NAVY, inv, speed=40, spacing=40)
    trunk_c = [(780, 295), (700, 295), (700, 415), (600, 415)]
    flow(cv, trunk_c, t, NAVY, ap(t, c1 + 1.8), speed=60, spacing=100)
    cv.chip(930, 408, "Bus only by default", NAVY, ap(t, c1 + 2.6), 14)
    cv.chip(930, 446, "Full access is a role", ACCENT, ap(t, c1 + 3.2), 14)
    wl = ap(t, c1 + 3.8)
    cv.line([(40, 492), (640, 492)], SLATE, 4, wl)
    noentry(cv, 340, 492, wl, 12)
    cv.box(40, 512, 300, 56, r=4, fill=WHITE, outline=NAVY, width=1.4, a=wl)
    cv.text(56, 540, "Home vault, yours alone", "s", 17, INK, wl, "lm")
    cv.text(780, 530, "Teammates exist only on the business side.", "s", 16, INK, ap(t, c1 + 4.4), "lm")
    # B3: promote or share up, company knowledge flows back down (one trunk into the company vault)
    up, dn = ap(t, c2), ap(t, c2 + 1.8)
    for y in ys[:2]:
        flow(cv, [(600, y + 45), (700, y + 45), (700, 295), (780, 295)], t, NAVY, up, speed=70, spacing=130)
    cv.line([(700, 185), (700, 295)], RULE, 1.2, up)
    for k_, y in enumerate(ys):
        flow(cv, [(780, 295), (700, 295), (700, y + 45), (600, y + 45)], t, NAVY, dn, speed=70, spacing=130, base=False, phase=50 + k_ * 20)
    flow(cv, [(600, 415), (700, 415), (700, 295), (780, 295)], t, NAVY, up, speed=70, spacing=130, base=False, phase=30)
    cv.chip(700, 160, "promote or share", NAVY, up, 14)
    cv.chip(700, 450, "company knowledge", ACCENT, dn, 14)


BUSINESS_P = [
    P("Business: each member has a company-owned work vault, plus the shared company vault.",
      ["COMING", "Member A", "AI apps and a computer", "Work vault", "company-owned",
       "Member B", "AI apps and a computer", "Work vault", "company-owned",
       "Company vault", "shared, company-owned"], 7, anim=3.0),
    P("An organisation admin invites members into the company vault: bus only by default, full access as a role. "
      "Teammates exist only on the business side.",
      ["Organisation admin", "invites members", "Member C", "AI apps and a computer", "Work vault",
       "new member: bus only", "Bus only by default", "Full access is a role", "Home vault, yours alone",
       "Teammates exist only on the business side."], 8, anim=5.0),
    P("Members promote or share notes up. Company knowledge flows back down.",
      ["promote or share", "company knowledge"], 8, anim=2.4),
]

FUNCS = [  # name, what the scope holds, (reads, owns, promotes), planned lock
    ("Senior leadership", "Summaries and decisions", (1, 0, 1)),
    ("Heads of department", "Their own department folder", (1, 1, 1)),
    ("PMO", "Project status", (1, 0, 1)),
    ("Sales", "Accounts and pipeline", (0, 1, 1)),
    ("Engineering", "Projects and decisions", (0, 1, 1)),
    ("BD", "Partners and guests", (1, 0, 1)),
    ("Corporate functions", "Finance, legal, HR, compliance", (0, 1, 1)),
]
FUNC_X = [44 + i * 172 for i in range(7)]
FUNC_CHIP = ["reads", "owns", "reads", "owns", "owns", "works with guests", "need-to-know"]


def func_tile(cv, i, x, y, w, h, a, lit=False, rows=True, dash=None):
    name, sub, flags = FUNCS[i]
    planned = i == 6 if dash is None else dash
    cv.box(x, y, w, h, r=4, fill=WHITE, outline=ACCENT if lit else (SLATE if planned else NAVY), width=2.0 if lit else 1.4,
           a=a, dash=planned and not lit)
    ptext(cv, x + 12, y + 12, name, 17, w - 22, INK, a, "b", 21)
    ptext(cv, x + 12, y + 64, sub, 15, w - 22, MUTED, a, "r", 20)
    if rows:
        cv.chip(x + w / 2, y + h - 30, FUNC_CHIP[i], ACCENT if lit else (SLATE if planned else NAVY), a, 14)


def scene_functions(cv, t, cs):
    (c0,) = cs
    stamp_corner(cv, t, c0)
    cv.box(30, 118, 1220, 322, r=4, fill=ZONE, outline=RULE, width=1.2, a=ap(t, c0))
    cv.text(50, 134, "Company vault", "b", 20, INK, ap(t, c0), "lm")
    cv.text(220, 134, "one folder for each function", "r", 16, MUTED, ap(t, c0), "lm")
    for i in range(7):
        func_tile(cv, i, FUNC_X[i], 160, 160, 200, ap(t, c0 + 0.5 + i * 0.35))
    ptext(cv, 50, 392, "Reads: sees the folder. Owns: edits it. Promotes: moves a note up to the company.", 16, 1150, MUTED,
          ap(t, c0 + 3.2))


FUNCTIONS_P = [
    P("Each function has its own scope. Leaders read summaries, departments own their folders, and sensitive work stays need-to-know.",
      ["COMING", "Company vault", "one folder for each function"]
      + [f[0] for f in FUNCS] + [f[1] for f in FUNCS] + FUNC_CHIP
      + ["Reads: sees the folder. Owns: edits it. Promotes: moves a note up to the company."], 10, anim=4.6),
]


def scene_reports(cv, t, cs):
    (c0,) = cs
    vb = ap(t, c0)
    node(cv, 40, 440, 1200, 66, "Company vault", "the notes, decisions and graph every report reads from", "hub", SLATE, vb, dash=True,
         tsize=19, ssize=15)
    cards = ["Weekly digest", "Portfolio status", "Pipeline summary", "Decision log"]
    for i, nm in enumerate(cards):
        k = ap(t, c0 + 0.8 + i * 0.5, 0.7)
        x = 41 + i * 306
        yy = 168 + (1 - k) * 40
        cv.box(x, yy, 280, 230, r=4, fill=WHITE, outline=SLATE, width=1.4, a=k, dash=True)
        cv.text(x + 16, yy + 24, nm, "b", 19, INK, k, "lm")
        for r_ in range(4):
            cv.box(x + 16, yy + 56 + r_ * 24, 248 - r_ * 50, 10, r=2, fill=TINT, a=k)
        cv.box(x + 16, yy + 168, 40, 40, r=2, fill=TINT, a=k)
        cv.box(x + 64, yy + 184, 40, 24, r=2, fill=TINT, a=k)
        cv.box(x + 112, yy + 176, 40, 32, r=2, fill=TINT, a=k)
        cv.stamp(x + 232, yy + 200, "PLANNED", k, 12)
        flow(cv, [(x + 140, 440), (x + 140, 398)], t, NAVY, k, speed=40, spacing=60)
    n = ap(t, c0 + 3.0)
    cv.box(40, 530, 1200, 54, r=4, fill=WHITE, outline=NAVY, width=1.4, a=n)
    person_badge(cv, 74, 557, n)
    cv.text(104, 557, "Access follows each person's scope", "s", 19, INK, n, "lm")


REPORTS_P = [
    P("Reports are views over the company vault. They show each person only what they are allowed to read.",
      ["Company vault", "the notes, decisions and graph every report reads from", "Weekly digest", "PLANNED",
       "Portfolio status", "PLANNED", "Pipeline summary", "PLANNED", "Decision log", "PLANNED",
       "Access follows each person's scope"], 10, anim=4.6),
]


def scene_modules(cv, t, cs):
    (c0,) = cs
    tiles = [("CRM", 140), ("Project tools", 245), ("Ticketing", 350)]
    for i, (nm, y) in enumerate(tiles):
        k = ap(t, c0 + i * 0.5)
        node(cv, 40, y, 270, 80, nm, "a business module", "folder", SLATE, k, dash=True)
        cv.stamp(268, y + 56, "PLANNED", k, 11)
        pts = [(310, y + 40), (430, y + 40), (430, 320), (640, 320)]
        flow(cv, pts, t, NAVY, ap(t, c0 + 1.8 + i * 0.4), speed=70, spacing=120)
    g = ap(t, c0 + 1.4)
    cv.box(640, 130, 600, 380, r=4, fill=ZONE, outline=SLATE, width=1.4, a=g, dash=True)
    cv.text(660, 152, "Company vault graph", "b", 19, INK, g, "lm")
    pos = [(760, 250), (900, 210), (1040, 270), (840, 360), (990, 400), (1130, 350), (1140, 220)]
    edges = [(0, 1), (1, 2), (0, 3), (3, 4), (2, 5), (4, 5), (1, 6), (2, 6)]
    for k_, (a_, b_) in enumerate(edges):
        e = ap(t, c0 + 3.6 + k_ * 0.25, 0.5)
        pa, pb = pos[a_], pos[b_]
        cv.line([pa, (lerp(pa[0], pb[0], e), lerp(pa[1], pb[1], e))], ACCENT, 1.4, e)
    for k_, (px, py) in enumerate(pos):
        cv.circle(px, py, 15, fill=WHITE, outline=NAVY, width=1.5, a=ap(t, c0 + 2.8 + k_ * 0.2, 0.5))
    cv.text(640 + 300, 485, "nodes and edges", "s", 15, MUTED, ap(t, c0 + 4.0), "mm")
    pb_ = ap(t, c0 + 5.0)
    person_badge(cv, 430, 320, pb_)
    cv.chip(560, 292, "a person approves changes", NAVY, pb_, 14)
    cv.text(40, 548, "AI apps can already use those vendors' own tools beside Memev.", "r", 16, MUTED, ap(t, c0 + 5.6))


MODULES_P = [
    P("Business modules, such as CRM, project tools and ticketing, add nodes and edges to the company vault. Planned.",
      ["CRM", "a business module", "PLANNED", "Project tools", "a business module", "PLANNED", "Ticketing",
       "a business module", "PLANNED", "Company vault graph", "nodes and edges", "a person approves changes",
       "AI apps can already use those vendors' own tools beside Memev."], 15, anim=6.2),
]


# ---------------- Business trial (planned): T1 to T3 ----------------
def ring(cv, x, y, r, frac, a=1.0, color=ACCENT):
    cv.circle(x, y, r, outline=RULE, width=2.0, a=a)
    cv.arc(x, y, r, -90, -90 + 360 * frac, color, 3.0, a)


def scene_trial(cv, t, cs):
    c0, c1, c2 = cs
    stamp_corner(cv, t, c0, "PLANNED")
    off = ap(t, c1 + 0.6)                           # the trial ends: merge stops
    back = ap(t, c2 + 1.4)                          # a licence is installed: the engine is on again
    on = max(0.0, 1 - off) + back * off
    frac = ap(t, c0 + 0.6, 4.0) * 0.5 + ap(t, c1, 1.6) * 0.5
    ring(cv, 130, 270, 50, frac, ap(t, c0))
    cv.text(130, 270, "14 days", "b", 18, INK, ap(t, c0), "mm")
    cv.text(130, 345, "extendable once by 14 days", "s", 14, MUTED, ap(t, c0), "mm")
    cv.text(130, 378, "cloud-hosted, free, self-serve", "b", 15, INK, ap(t, c0 + 2.2), "mm")
    for i, (x, nm) in enumerate([(240, "Computer 1"), (930, "Computer 2")]):
        al = ap(t, c0 + 0.3 + i * 0.3)
        node(cv, x, 215, 210, 84, nm, None, "computer", NAVY, al, ssize=15)
    cv.box(480, 124, 360, 262, r=4, fill=ZONE, outline=ACCENT if on > 0.5 else NAVY, width=2.0 if on > 0.5 else 1.4, a=ap(t, c0 + 0.6))
    cv.text(498, 142, "Company vault", "b", 18, INK, ap(t, c0 + 0.6), "lm")
    merged = ap(t, c0 + 2.2) * (1 - off) + back
    merged = min(1.0, merged)
    split = off * (1 - back)
    lines = [("A adds a line on the launch", NAVY), ("B adds a line on the budget", NAVY)]
    doc_a = ap(t, c0 + 1.0)
    cv.box(500, 160, 320, 136, r=4, fill=WHITE, outline=NAVY, width=1.4, a=doc_a)
    cv.text(516, 178, "Shared note", "b", 16, INK, doc_a, "lm")
    for i, (txt, _c) in enumerate(lines):
        cv.box(514, 196 + i * 28, 292, 22, r=3, fill=ZONE, outline=RULE, width=1.0, a=doc_a)
        cv.text(524, 207 + i * 28, txt, "r", 14, INK, doc_a, "lm")
    cv.text(516, 276, "one note, both edits" if merged > 0.5 and split < 0.5 else "two copies, both kept" if split > 0.5 else "", "s", 14,
            ACCENT if merged > 0.5 else INK, doc_a, "lm")
    # engine badge
    bw = cv.chip(660, 340, "Full merge engine" if on > 0.5 else "Merge is off", ACCENT if on > 0.5 else SLATE,
                 ap(t, c0 + 2.0), 15, filled=on > 0.5)
    cv.text(660, 366, "a separate component, its own licence", "r", 14, MUTED, ap(t, c0 + 2.4), "mm")
    flow(cv, [(450, 257), (480, 257)], t, NAVY, ap(t, c0 + 1.0), speed=30, spacing=30)
    flow(cv, [(930, 257), (840, 257)], t, NAVY, ap(t, c0 + 1.0), speed=30, spacing=30)
    # T2: both copies are kept, and both vaults can go to a backup you own
    cp = ap(t, c1 + 1.4)
    for i, nm in enumerate(["Copy from computer 1", "Copy from computer 2"]):
        cv.box(480 + i * 190, 420, 170, 70, r=4, fill=WHITE, outline=NAVY, width=1.4, a=cp)
        cv.text(480 + i * 190 + 12, 440, nm, "s", 14, INK, cp, "lm")
        for r_ in range(2):
            cv.box(480 + i * 190 + 12, 456 + r_ * 14, 146 - r_ * 40, 7, r=2, fill=TINT, a=cp)
    cv.text(660, 512, "kept, nothing deleted", "s", 16, INK, cp, "mm")
    bk = ap(t, c1 + 3.0)
    node(cv, 920, 420, 300, 84, "Your own backup", "your private GitHub repository", "repo", NAVY, bk, ssize=15)
    flow(cv, [(860, 455), (920, 455)], t, NAVY, bk, speed=40, spacing=40)
    cv.text(1070, 520, "vaults stay readable and exportable", "r", 15, MUTED, bk, "mm")
    # T3: a licence file drops on the vault; kept copies are listed for a person to merge
    lic = ap(t, c2, 1.2)
    lx = lerp(1130, 880, lic)
    ly = lerp(190, 300, lic)
    if t >= c2:
        la = lic * (1 - ap(t, c2 + 1.4, 0.4))
        cv.box(lx - 40, ly - 24, 80, 48, r=3, fill=WHITE, outline=ACCENT, width=1.6, a=la)
        icon(cv, "doc", lx - 18, ly, ACCENT, la)
        cv.text(lx + 8, ly, "Licence", "s", 14, INK, la, "lm")
    mg = ap(t, c2 + 2.4)
    cv.chip(575, 560, "Merge", NAVY, mg, 14)
    person_badge(cv, 515, 560, mg)
    cv.text(640, 560, "a person merges the kept copies", "r", 15, MUTED, mg, "lm")


TRIAL_P = [
    P("Try cloud-hosted Business free for 14 days, extendable once by 14 days. It is self-serve and needs no card.",
      ["PLANNED", "14 days", "extendable once by 14 days", "cloud-hosted, free, self-serve", "Computer 1", "Computer 2", "Company vault",
       "Shared note", "A adds a line on the launch", "B adds a line on the budget", "one note, both edits", "Full merge engine",
       "a separate component, its own licence"], 7, anim=4.6),
    P("When a trial ends, nothing is deleted: vaults stay readable and exportable, merge stops.",
      ["Merge is off", "two copies, both kept", "Copy from computer 1", "Copy from computer 2", "kept, nothing deleted",
       "Your own backup", "your private GitHub repository", "vaults stay readable and exportable"], 5, anim=4.6),
    P("Install a paid licence and carry on. Nothing moves.",
      ["Licence", "Full merge engine", "Merge", "a person merges the kept copies"], 4, anim=3.0),
]


def scene_pilot(cv, t, cs):
    (c0,) = cs
    stamp_corner(cv, t, c0, "PLANNED")
    node(cv, 70, 240, 290, 100, "A person guides you", "a guided pilot for Corporate", "person", NAVY, ap(t, c0), ssize=15)
    k = ap(t, c0 + 1.0)
    ring(cv, 560, 290, 62, 0.62, k, NAVY)
    cv.arc(560, 290, 62, 134, 134 + 150 * ap(t, c0 + 3.6, 1.6), ACCENT, 3.0, k)
    cv.text(560, 380, "The pilot", "s", 16, MUTED, k, "mm")
    flow(cv, [(360, 290), (484, 290)], t, NAVY, k, speed=50, spacing=60)
    f = ap(t, c0 + 2.4)
    cv.box(780, 200, 340, 190, r=4, fill=WHITE, outline=NAVY, width=1.4, a=f)
    cv.text(800, 224, "Order form", "b", 19, INK, f, "lm")
    for r_ in range(3):
        cv.box(800, 250 + r_ * 22, 300 - r_ * 60, 9, r=2, fill=TINT, a=f)
    cv.line([(800, 350), (940, 350)], INK, 1.2, f)
    cv.text(800, 366, "Signed", "r", 14, MUTED, f, "lm")
    flow(cv, [(780, 290), (630, 290)], t, NAVY, ap(t, c0 + 3.4), speed=50, spacing=60)
    cv.text(950, 440, "longer by agreement", "s", 16, INK, ap(t, c0 + 4.4), "mm")


PILOT_P = [
    P("Corporate starts with a guided pilot, and longer by agreement.",
      ["PLANNED", "A person guides you", "a guided pilot for Corporate", "The pilot", "Order form", "Signed", "longer by agreement"], 5, anim=5.4),
]


def lane(cv, t, c, y, heading, sub, mid, mid_sub, right, right_sub, right_ic, dash, bound=None):
    """One deployment lane: your team, the company vault, and the AI the team uses."""
    cv.box(30, y, 1220, 200, r=4, fill=None, outline=RULE, width=1.2, a=ap(t, c))
    cv.text(52, y + 20, heading, "b", 20, INK, ap(t, c), "lm")
    cv.text(52, y + 46, sub, "s", 15, MUTED, ap(t, c + 0.3), "lm")
    ny = y + 78
    node(cv, 60, ny, 270, 90, "Your team", "members of the company", "person", NAVY, ap(t, c + 0.6), ssize=15)
    if bound:
        cv.box(430, y + 66, 780, 116, r=4, fill=None, outline=SLATE, width=1.2, a=ap(t, c + 1.0), dash=True)
    node(cv, 460, ny, 290, 90, "Company vault", mid_sub, "hub", SLATE, ap(t, c + 1.0), dash=dash, ssize=15)
    node(cv, 910, ny, 290, 90, right, right_sub, right_ic, NAVY, ap(t, c + 1.4), ssize=15)
    flow(cv, [(330, ny + 45), (460, ny + 45)], t, NAVY, ap(t, c + 1.8), speed=50, spacing=70)
    flow(cv, [(750, ny + 45), (910, ny + 45)], t, NAVY, ap(t, c + 2.2), speed=50, spacing=70)


def scene_deploy(cv, t, cs):
    c0, c1 = cs
    stamp_corner(cv, t, c0, "COMING")
    lane(cv, t, c0, 118, "Cloud-hosted", "we run it for you", "", "hosted for you",
         "External AI providers", "hosted AI services", "cloud", True)
    cv.chip(1080, 138, "free trial, self-serve", ACCENT, ap(t, c0 + 2.8), 14)
    lane(cv, t, c1, 335, "On-premises or self-hosted", "you run it", "", "on your own servers",
         "Internal AI model", "your own LLM", "chip", True, bound=True)
    cv.chip(830, 335 + 66, "inside your own environment", ACCENT, ap(t, c1 + 2.8), 14)
    cv.chip(760, 355, "paid setup service", NAVY, ap(t, c1 + 3.2), 14)
    cv.chip(1020, 355, "one-command Docker package", ACCENT, ap(t, c1 + 3.6), 14)


DEPLOY_P = [
    P("Cloud-hosted is managed by us, for teams that use external hosted AI providers. It is the fastest to start, with a free self-serve trial.",
      ["COMING", "Cloud-hosted", "we run it for you", "Your team", "members of the company",
       "Company vault", "hosted for you", "External AI providers", "hosted AI services", "free trial, self-serve"], 7, anim=3.6),
    P("On-premises or self-hosted is for teams that run an internal AI model or have strict data residency. Setup is a paid service, done fast with a one-command Docker package.",
      ["On-premises or self-hosted", "you run it", "Your team", "members of the company", "Company vault",
       "on your own servers", "Internal AI model", "your own LLM", "inside your own environment", "paid setup service",
       "one-command Docker package"], 9, anim=4.4),
]


def scene_remote(cv, t, cs):
    (c0,) = cs
    stamp_corner(cv, t, c0, "COMING")
    z = ap(t, c0)
    cv.box(40, 140, 520, 340, r=4, fill=ZONE, outline=RULE, width=1.2, a=z)
    label(cv, 60, 158, "Your environment", z, INK)
    node(cv, 70, 190, 460, 90, "Start remote setup", "you start it, from your side", "person", NAVY, ap(t, c0 + 0.6), hl=True, ssize=15)
    node(cv, 70, 330, 460, 90, "Your servers", "the vault and your internal model", "vault", SLATE, ap(t, c0 + 1.2), dash=True, ssize=15)
    cv.chip(300, 452, "no inbound connection", NAVY, ap(t, c0 + 4.2), 14)
    node(cv, 900, 190, 330, 90, "Our setup team", "helps with the setup", "person", NAVY, ap(t, c0 + 1.8), ssize=15)
    flow(cv, [(530, 235), (900, 235)], t, ACCENT, ap(t, c0 + 2.4), speed=70, spacing=70)
    cv.chip(715, 205, "outbound only", ACCENT, ap(t, c0 + 2.8), 14)
    node(cv, 600, 330, 200, 90, "Time-limited", "ends by itself", None, NAVY, ap(t, c0 + 3.4), tsize=18, ssize=15)
    node(cv, 820, 330, 200, 90, "Logged", "every action recorded", None, NAVY, ap(t, c0 + 3.8), tsize=18, ssize=15)
    node(cv, 1040, 330, 200, 90, "Revocable", "you can end it any time", None, NAVY, ap(t, c0 + 4.4), hl=True, tsize=18, ssize=14)


REMOTE_P = [
    P("Remote setup is optional, and you start it. It connects outbound only, is time-limited and logged, and you can revoke it at any time.",
      ["COMING", "Your environment", "Start remote setup", "you start it, from your side", "Your servers",
       "the vault and your internal model", "no inbound connection", "Our setup team", "helps with the setup", "outbound only",
       "Time-limited", "ends by itself", "Logged", "every action recorded", "Revocable", "you can end it any time"], 10, anim=5.4),
]


# ---------------- Corporate: C1 to C5 ----------------
def scene_corp_scopes(cv, t, cs):
    (c0,) = cs
    stamp_corner(cv, t, c0)
    node(cv, 400, 130, 480, 90, "Company vault", "shared, company-owned", "hub", SLATE, ap(t, c0), dash=True)
    scopes = [(60, "Department A", "its members and work vaults"),
              (470, "Department B", "its members and work vaults"),
              (880, "Project X", "the people on the project")]
    for i, (x, nm, sub) in enumerate(scopes):
        al = ap(t, c0 + 1.0 + i * 0.6)
        node(cv, x, 330, 340, 110, nm, sub, "folder", SLATE, al, dash=True, ssize=15)
        cx = x + 170
        pts = {0: [(520, 220), (520, 275), (cx, 275), (cx, 330)], 1: [(640, 220), (640, 330)],
               2: [(760, 220), (760, 275), (cx, 275), (cx, 330)]}[i]
        flow(cv, pts, t, SLATE, al, speed=60, spacing=100)
    cv.chip(640, 276, "scopes", SLATE, ap(t, c0 + 1.6), 14)


CORP_SCOPES_P = [
    P("Corporate: the same model at larger scale, with departments and projects as scopes.",
      ["COMING", "Company vault", "shared, company-owned", "Department A", "its members and work vaults",
       "Department B", "its members and work vaults", "Project X", "the people on the project",
       "scopes"], 8, anim=4.0),
]

COLS = ["Company", "Projects", "Accounts", "Need-to-know"]
COLX = [290, 490, 690, 860]
MATRIX = [  # per function: cells for Company, Projects, Accounts, Need-to-know
    [["reads", "promotes"], ["reads"], ["reads"], []],
    [["reads", "promotes"], ["reads"], ["reads"], []],
    [["promotes"], ["reads", "promotes"], [], []],
    [["promotes"], [], ["owns", "promotes"], []],
    [["promotes"], ["owns", "promotes"], [], []],
    [["promotes"], [], ["reads", "promotes"], []],
    [[], [], [], ["owns", "promotes"]],
]
ROW_NAMES = ["Senior leadership", "Heads of department", "PMO", "Sales", "Engineering", "BD", "Corporate functions"]
ROWY = [158 + i * 52 for i in range(7)]


def scene_corp_functions(cv, t, cs):
    c0, c1, c2 = cs
    stamp_corner(cv, t, c0)
    A = ap(t, c0)
    cv.text(44, 128, "Function", "s", 15, MUTED, A, "lm")
    for j, nm in enumerate(COLS):
        cv.text(COLX[j] + 8, 128, nm, "s", 15, MUTED, A, "lm")
    lit_at = [c0 + 0.6, c0 + 1.4, c1 + 0.4, c1 + 1.0, c1 + 1.6, c1 + 2.2, c2 + 0.4]
    for i in range(7):
        ya = ap(t, c0 + 0.1 + i * 0.1, 0.4)
        lit = ap(t, lit_at[i])
        cur = lit > 0.5 and (i in (0, 1) or (i in (2, 3, 4, 5) and t >= c1) and t < c2 or (i == 6 and t >= c2))
        cv.box(40, ROWY[i], 1200, 46, r=4, fill=WHITE, outline=ACCENT if cur else RULE, width=2.0 if cur else 1.2, a=ya,
               dash=(i == 6 and not cur))
        cv.text(54, ROWY[i] + 24, ROW_NAMES[i], "b", 16, INK, ya, "lm")
        for j in range(4):
            cx = COLX[j] + 8
            for k, wd in enumerate(MATRIX[i][j]):
                w_ = cv.tw(wd, "s", 14) + 18
                cv.box(cx, ROWY[i] + 11, w_, 24, r=3, fill=WHITE, outline=ACCENT if cur else NAVY, width=1.3, a=lit)
                cv.text(cx + w_ / 2, ROWY[i] + 23.5, wd, "s", 14, INK, lit, "mm")
                cx += w_ + 8
    # C2: leaders read across the company and promote decisions
    if t >= c2:
        p = ap(t, c2 + 1.0)
        cv.chip(1128, ROWY[6] + 23, "second approver", ACCENT, p, 14)
        person_badge(cv, 1214, ROWY[6] + 23, p)


CORP_FUNCTIONS_P = [
    P("Leadership and heads of department read across the company, and promote decisions.",
      ["COMING", "Function", "Company", "Projects", "Accounts", "Need-to-know"] + ROW_NAMES
      + ["reads", "promotes", "reads", "reads", "reads", "promotes", "reads", "reads",
         ], 6, anim=3.4),
    P("The PMO, Sales, Engineering and BD work in project and account scopes, and promote up.",
      ["promotes", "reads", "promotes", "promotes", "owns", "promotes", "promotes", "owns", "promotes", "promotes", "reads",
       "promotes"], 6, anim=5.0),
    P("Finance, legal, HR and compliance keep need-to-know scopes, with a second approver.",
      ["owns", "promotes", "second approver"], 3, anim=2.6),
]


def scene_corp_prov(cv, t, cs):
    (c0,) = cs
    stamp_corner(cv, t, c0, "PLANNED")
    p = ap(t, c0)
    node(cv, 40, 140, 320, 90, "Sign-in provisioning", "adds and removes members", "person", SLATE, p, dash=True, ssize=15)
    node(cv, 480, 140, 320, 90, "Company vault", "members arrive in their scopes", "hub", SLATE, ap(t, c0 + 1.0), dash=True, ssize=15)
    flow(cv, [(360, 185), (480, 185)], t, SLATE, ap(t, c0 + 1.0), speed=50, spacing=60)
    node(cv, 920, 140, 320, 90, "Audit and retention", "kept as the company decides", "doc", SLATE, ap(t, c0 + 2.0), dash=True, ssize=15)
    flow(cv, [(800, 185), (920, 185)], t, SLATE, ap(t, c0 + 2.0), speed=50, spacing=60)
    b = ap(t, c0 + 3.0)
    cv.box(60, 340, 1160, 100, r=4, fill=WHITE, outline=SLATE, width=1.4, a=b, dash=True)
    cv.text(84, 372, "Audit log", "b", 19, INK, b, "lm")
    cv.text(84, 408, "who read, wrote, promoted and left, kept under the company's own retention", "r", 16, MUTED, b, "lm")
    flow(cv, [(60, 470), (1220, 470)], t, SLATE, b, speed=70, spacing=300)


CORP_PROV_P = [
    P("Sign-in provisioning adds members. Audit and retention keep every step on record.",
      ["PLANNED", "Sign-in provisioning", "adds and removes members", "Company vault", "members arrive in their scopes",
       "Audit and retention", "kept as the company decides", "Audit log",
       "who read, wrote, promoted and left, kept under the company's own retention"], 6, anim=4.0),
]


def scene_leavers(cv, t, cs):
    c0, c1 = cs
    stamp_corner(cv, t, c0)
    m = ap(t, c0)
    node(cv, 50, 220, 270, 120, "Member leaves", "their work login ends", "person", NAVY, m, sub2="at the company's request")
    chips = [("Access ended", c0 + 1.4), ("Keys revoked", c0 + 2.4), ("Devices removed", c0 + 3.4), ("Local cache wiped", c0 + 4.4)]
    pa = ap(t, c0 + 0.5)
    cv.box(430, 150, 400, 340, r=4, fill=WHITE, outline=NAVY, width=1.4, a=pa)
    cv.text(456, 178, "Offboarding", "b", 22, INK, pa, "lm")
    for i, (txt, tt) in enumerate(chips):
        y = 232 + i * 64
        ia = ap(t, c0 + 0.8 + i * 0.2)
        cv.circle(472, y, 11, outline=RULE, width=1.5, a=ia)
        tick(cv, 472, y, ap(t, tt, 0.4), NAVY)
        cv.text(498, y - (6 if i == 3 else 0), txt, "s", 21, INK, ia, "lm")
    cv.text(498, 232 + 3 * 64 + 17, "when that computer next starts or connects", "r", 15, MUTED, ap(t, c0 + 4.4), "lm")
    done = ap(t, c0 + 5.0, 0.6)
    flow(cv, [(320, 280), (430, 280)], t, NAVY, m * (1 - done), speed=50, spacing=60)
    if done > 0:
        cv.dashed([(320, 280), (430, 280)], RULE, 1.4, done, 6, 5)
        cv.chip(375, 252, "ended", SLATE, done, 14, filled=True)
    v = ap(t, c1)
    node(cv, 910, 220, 330, 120, "Work vault", "stays with the company", "vault", SLATE, v, dash=True, sub2="company-owned and kept")
    flow(cv, [(830, 280), (910, 280)], t, SLATE, v, speed=40, spacing=30)
    cv.chip(1075, 372, "no vault access leaves", NAVY, ap(t, c1 + 1.4), 14)
    cv.chip(1075, 412, "Work vault kept for the company for 30 days", ACCENT, ap(t, c1 + 2.2), 14)


LEAVERS_P = [
    P("When someone leaves, their access, keys and devices are revoked and the local cache is wiped.",
      ["COMING", "Member leaves", "their work login ends", "at the company's request", "Offboarding", "Access ended", "Keys revoked",
       "Devices removed", "Local cache wiped", "when that computer next starts or connects", "ended"], 8, anim=5.6),
    P("The work vault stays with the company. No one leaves with vault access.",
      ["Work vault", "stays with the company", "company-owned and kept", "no vault access leaves",
       "Work vault kept for the company for 30 days"], 4, anim=3.2),
]


def doc(cv, x, y, w, h, a, lines, color=NAVY, title="Shared note"):
    cv.box(x, y, w, h, r=4, fill=WHITE, outline=color, width=1.4, a=a)
    cv.text(x + 16, y + 18, title, "b", 17, INK, a, "lm")
    for i, (txt, col) in enumerate(lines):
        yy = y + 40 + i * 28
        cv.box(x + 14, yy, w - 28, 22, r=3, fill=ZONE, outline=RULE, width=1.0, a=a)
        cv.text(x + 24, yy + 11.5, txt, "r", 14, INK, a, "lm")


def scene_engine(cv, t, cs):
    c0, c1, c2, c3 = cs
    a0 = ap(t, c0)
    merged = ap(t, c1 + 2.6, 0.6)
    cv.chip(640, 140, "Without the engine" if t < c1 else "With the paid engine", NAVY, a0, 15, filled=t >= c1)
    node(cv, 60, 230, 250, 100, "Computer 1", "edits the note", "computer", NAVY, a0)
    node(cv, 970, 230, 250, 100, "Computer 2", "at once", "computer", NAVY, a0)
    conflict = ap(t, c0 + 3.4) * (1 - ap(t, c1 - 0.2, 0.4))
    lines_c = [("A adds a line on the launch", NAVY), ("B adds a line on the budget", NAVY)]
    if merged > 0.5:
        lines_c.append(("one note with both changes", NAVY))
    doc(cv, 500, 186, 280, 150, a0, lines_c, color=ACCENT if merged > 0.5 else (SLATE if conflict > 0.3 else NAVY))
    ea = ap(t, c0 + 1.0)
    flow(cv, [(310, 270), (500, 270)], t, NAVY, ea, speed=70)
    flow(cv, [(970, 270), (780, 270)], t, NAVY, ea, speed=70)
    if conflict > 0.01:
        cv.chip(640, 168, "conflict: fix by hand", SLATE, conflict, 14, filled=True)
    free = ap(t, c0 + 2.2) * (0.55 if t >= c1 else 1.0)
    node(cv, 60, 450, 380, 100, "Free core: git backup", "one writer; a failed merge is left as it is", "repo", NAVY, free,
         ssize=15, sub2="run memev doctor")
    e = ap(t, c1)
    node(cv, 500, 450, 380, 100, "Paid engine", "merges every change", "chip", SLATE, e, dash=True, hl=c1 <= t < c2,
         sub2="nothing lost, no conflicts", ssize=15)
    if e > 0:
        fa = ap(t, c1 + 0.8)
        flow(cv, [(630, 340), (630, 450)], t, NAVY, fa, speed=50, spacing=60)
        flow(cv, [(670, 450), (670, 340)], t, NAVY, ap(t, c1 + 2.0), speed=50, spacing=60, base=False, phase=20)
        cv.chip(540, 395, "Memev calls it", NAVY, fa, 14)
        cv.chip(765, 395, "merged note comes back", ACCENT, ap(t, c1 + 2.0), 14)
        back = ap(t, c1 + 3.4)
        flow(cv, [(500, 300), (310, 300)], t, NAVY, back, speed=70)
        flow(cv, [(780, 300), (970, 300)], t, NAVY, back, speed=70)
        if back > 0.5:
            tick(cv, 590, 168, ap(t, c1 + 3.6))
            cv.text(610, 168, "nothing lost", "s", 16, INK, ap(t, c1 + 3.6), "lm")
    fit = ap(t, c2)
    if fit > 0:
        cv.text(1080, 426, "Where it fits", "s", 15, MUTED, fit, "mm")
        for i, (nm, planned) in enumerate([("Personal with more computers", False), ("Business (coming)", True), ("Corporate (coming)", True)]):
            a = ap(t, c2 + 0.6 + i * 0.7)
            y = 450 + i * 46
            cv.box(920, y, 320, 38, r=4, fill=WHITE, outline=SLATE if planned else NAVY, width=1.4, a=a, dash=planned)
            cv.text(938, y + 19.5, nm, "s", 16, INK, a, "lm")
            flow(cv, [(880, 500), (900, 500), (900, y + 19), (920, y + 19)], t, SLATE, a, speed=40, spacing=40, dashed=True)
    sep = ap(t, c3)
    if sep > 0:
        cv.dashed([(470, 425), (470, 575)], SLATE, 1.5, sep, 8, 6)
        cv.chip(250, 596, "separate component, its own licence, not in this repository", SLATE, sep, 14)


ENGINE_P = [
    P("Without the engine, git backup has one writer. Concurrent edits can conflict and need fixing by hand.",
      ["Without the engine", "Computer 1", "edits the note", "Computer 2", "at once", "Shared note", "A adds a line on the launch",
       "B adds a line on the budget", "conflict: fix by hand", "Free core: git backup",
       "one writer; a failed merge is left as it is", "run memev doctor"], 6, anim=4.4),
    P("The paid engine merges every change automatically. Nothing is lost, and no conflicts to fix by hand.",
      ["With the paid engine", "Paid engine", "merges every change", "nothing lost, no conflicts", "Memev calls it",
       "merged note comes back", "one note with both changes", "nothing lost"], 6, anim=5.0),
    P("It fits Personal with more computers, Business and Corporate.",
      ["Where it fits", "Personal with more computers", "Business (coming)", "Corporate (coming)"], 4, anim=3.0),
    P("A separate component under its own licence, called by Memev, not part of this repository.",
      ["separate component, its own licence, not in this repository"], 1, anim=1.0),
]


def scene_combined(cv, t, cs):
    c0, c1, c2 = cs
    z = ap(t, c0)
    more = ap(t, c0 + 3.0)
    cv.box(20, 120, 672, 480, r=4, fill=ZONE, outline=RULE, width=1.2, a=z)
    label(cv, 40, 136, "Personal", z, INK)
    node(cv, 36, 160, 160, 90, "AI apps", "hooks + MCP", None, NAVY, z, tsize=18, ssize=15)
    node(cv, 270, 160, 190, 110, "Personal vault", "plain Markdown", None, NAVY, z, ssize=15, sub2="and the comms bus", tsize=18)
    node(cv, 524, 160, 150, 90, "GitHub", "your own backup", None, NAVY, z, tsize=18, ssize=15)
    flow(cv, [(196, 205), (270, 205)], t, NAVY, z, speed=50, spacing=60)
    flow(cv, [(460, 215), (524, 215)], t, NAVY, z, speed=50, spacing=60)
    node(cv, 270, 340, 190, 90, "More computers", "same vault, own keys", None, NAVY, more, tsize=18, ssize=15)
    flow(cv, [(365, 340), (365, 270)], t, NAVY, more, speed=40, spacing=40)
    node(cv, 36, 340, 160, 90, "Cloud AI apps", "ChatGPT and more", None, NAVY, more, dash=True, tsize=18, ssize=15)
    cv.dashed([(196, 385), (270, 385)], RULE, 1.4, more, 6, 5)
    cv.chip(233, 456, "secure link: off until you switch it on", NAVY, more, 14)
    w = ap(t, c1)
    cv.box(708, 120, 8, 400, r=0, fill=SLATE, a=w)
    cv.box(732, 120, 524, 480, r=4, fill=ZONE, outline=SLATE, width=1.4, a=w, dash=True)
    label(cv, 752, 136, "Business and Corporate", w, INK)
    cv.stamp(1190, 138, "COMING", w, 12)
    cv.chip(712, 462, "hard boundary", SLATE, w, 14, filled=True)
    b = ap(t, c2)
    node(cv, 752, 160, 200, 90, "Work vaults", "one per member", None, SLATE, b, dash=True, tsize=18, ssize=15)
    node(cv, 1020, 160, 206, 110, "Company vault", "shared, company-owned", None, SLATE, b, dash=True, tsize=18, ssize=15)
    flow(cv, [(952, 205), (1020, 205)], t, NAVY, b, speed=40, spacing=40)
    cv.chip(986, 188, "promote", NAVY, b, 13)
    rows = ["Corporate: departments and projects", "Functions, reports, modules: planned",
            "Trial with the full merge engine: planned", "Leavers: access, keys, devices revoked"]
    for i, txt in enumerate(rows):
        cv.text(756, 312 + i * 30, txt, "r", 16, MUTED if i != 2 else INK, ap(t, c2 + 0.8 + i * 0.5), "lm")
    e = ap(t, c2 + 3.0)
    node(cv, 400, 520, 480, 74, "Paid engine", "separate component, own licence, called by Memev", "chip", SLATE, e, dash=True, tsize=18,
         ssize=14)
    flow(cv, [(400, 557), (365, 557), (365, 430)], t, SLATE, e, speed=40, spacing=80)
    flow(cv, [(880, 557), (1133, 557), (1133, 270)], t, SLATE, e, speed=40, spacing=80)
    cv.chip(640, 496, "merges edits from several computers and people", SLATE, e, 14)


COMBINED_P = [
    P("Personal, with more computers on the same vault, backed up to your own GitHub.",
      ["Personal", "AI apps", "hooks + MCP", "Personal vault", "plain Markdown", "and the comms bus", "GitHub", "your own backup",
       "More computers", "same vault, own keys", "Cloud AI apps", "ChatGPT and more", "secure link: off until you switch it on"], 8, anim=4.6),
    P("A hard boundary keeps personal and home vaults out of Business and Corporate.",
      ["hard boundary", "Business and Corporate", "COMING"], 3, anim=1.8),
    P("Business and Corporate (coming) add work vaults, a company vault and a trial with the full merge engine.",
      ["Work vaults", "one per member", "Company vault", "shared, company-owned", "promote",
       "Corporate: departments and projects", "Functions, reports, modules: planned",
       "Trial with the full merge engine: planned", "Leavers: access, keys, devices revoked", "Paid engine",
       "separate component, own licence, called by Memev", "merges edits from several computers and people"], 8, anim=6.0),
]


END_P = [P("", ["Memev", "One memory and one team channel, both on computers you own.",
              "Personal and work stay separate.", "Business and Corporate are coming."], 0, anim=3.1)]


def end_card(cv, t, cs):
    a = ap(t, 0.3, 0.7)
    cv.text(640, 250, "Memev", "b", 100, INK, a, "mm")
    cv.box(600, 312, 80 * ap(t, 0.4, 0.8) * 2, 3, r=0, fill=NAVY, a=a)
    cv.text(640, 362, "One memory and one team channel, both on computers you own.", "r", 27, MUTED, ap(t, 0.9, 0.7), "mm")
    cv.text(640, 430, "Personal and work stay separate.", "s", 22, INK, ap(t, 1.6, 0.7), "mm")
    cv.text(640, 478, "Business and Corporate are coming.", "s", 22, INK, ap(t, 2.4, 0.7), "mm")


# ---------------- storyboard ----------------
START, GAP, TAIL = 0.5, 0.3, 1.0   # first caption, gap between slides, rest at the end of a scene (the fade-out)


def mk(key, fn, phases, head, active, start=START):
    t, cs, caps, rows = start, [], [], []
    for n_, ph in enumerate(phases):
        extra = list(head) if (head and n_ == 0) else []        # the header is read on the first slide of a scene
        ph["labels"] = ph["labels"] if n_ or not head else [x for x in ph["labels"]]
        hold, anim, total, cw, lw = slide_timing(ph["cap"], list(ph["labels"]) + extra, ph["els"], ph["anim"])
        cs.append(t)
        caps.append((t, t + total, ph["cap"]))
        rows.append(dict(cap_words=cw, label_words=lw, els=ph["els"], hold=hold, anim=anim, total=total))
        t += total + GAP
    dur = t - GAP + TAIL
    return dict(key=key, fn=fn, caps=caps, cs=cs, head=head, active=active, dur=dur, rows=rows, phases=phases)


SCENES = [
    mk("title", scene_title, TITLE_P, None, []),
    mk("personal", scene_personal, PERSONAL_P, ("Personal", "One person, one computer  \u00b7  the free core"), [0]),
    mk("more", scene_more, MORE_P, ("Personal with more computers", "The same personal vault on several computers"), [1]),
    mk("boundary", scene_boundary, BOUNDARY_P, ("A hard boundary", "Personal and work never meet"), [0, 1]),
    mk("business", scene_business, BUSINESS_P, ("Business", "Coming  \u00b7  a work vault for each member, plus the company vault"), [2]),
    mk("functions", scene_functions, FUNCTIONS_P, ("Business functions", "Coming  \u00b7  each function has its own scope"), [2]),
    mk("reports", scene_reports, REPORTS_P, ("Business reports", "Planned  \u00b7  views over the company vault"), [2]),
    mk("modules", scene_modules, MODULES_P, ("Business modules", "Planned  \u00b7  CRM, project tools and ticketing"), [2]),
    mk("trial", scene_trial, TRIAL_P, ("Business trial", "Planned  \u00b7  the cloud-hosted trial, with the full merge engine"), [2]),
    mk("deploy", scene_deploy, DEPLOY_P, ("Business deployment options", "Coming  \u00b7  where the company vault runs"), [2]),
    mk("remote", scene_remote, REMOTE_P, ("Optional secure remote setup", "Coming  \u00b7  you start it, you can end it"), [2]),
    mk("corp_scopes", scene_corp_scopes, CORP_SCOPES_P, ("Corporate", "Coming  \u00b7  the Business model at larger scale"), [3]),
    mk("corp_functions", scene_corp_functions, CORP_FUNCTIONS_P, ("Corporate functions", "Coming  \u00b7  who reads, owns and promotes what"), [3]),
    mk("corp_prov", scene_corp_prov, CORP_PROV_P, ("Provisioning and audit", "Planned  \u00b7  members in, every step on record"), [3]),
    mk("pilot", scene_pilot, PILOT_P, ("Corporate pilot", "Planned  \u00b7  a guided start"), [3]),
    mk("leavers", scene_leavers, LEAVERS_P, ("When someone leaves", "Coming with Business and Corporate"), [2, 3]),
    mk("engine", scene_engine, ENGINE_P, ("The paid engine", "Merges changes made in several places at once"), [4]),
    mk("combined", scene_combined, COMBINED_P, ("How the tiers connect", "Personal and work stay separate; the engine is called from outside the core"), [0, 1, 2, 3, 4]),
]
SCENES.append(mk("end", end_card, END_P, None, [], start=0.0))
TOTAL = sum(s["dur"] for s in SCENES)


def timing_table():
    """Print one row per slide: how its hold time was worked out from everything visible on it."""
    out = ["scene            slide  cap_w  label_w  elems   hold    anim   total | scene start    length",
           "-" * 92]
    t0 = 0.0
    for s in SCENES:
        for i, r in enumerate(s["rows"]):
            first = f"{t0:8.1f}  {s['dur']:7.1f}" if i == 0 else ""
            out.append(f"{s['key'] if i == 0 else '':<16} {i + 1:>5} {r['cap_words']:>6} {r['label_words']:>8} {r['els']:>6} "
                       f"{r['hold']:6.1f} {r['anim']:7.1f} {r['total']:7.1f} | {first}")
        t0 += s["dur"]
    out.append("-" * 92)
    out.append(f"total {TOTAL:.1f} s ({int(TOTAL // 60)} min {int(round(TOTAL % 60))} s)   hold = 2.0 + 0.35 per caption word + 0.25 per other "
               "label word + 0.6 per element, min 4 s, no maximum; anim added on top")
    return "\n".join(out)


DOTS = True


def scene_at(T):
    t = T
    for s in SCENES:
        if t < s["dur"]:
            return s, t
        t -= s["dur"]
    return SCENES[-1], t


def render_at(T, with_audit=False):
    """Draw the frame at global time T (seconds) and return a Pillow RGB image at 1280x720."""
    sc, t = scene_at(T)
    cv = Cv()
    sc["fn"](cv, t, sc["cs"])
    if sc["head"]:
        header(cv, sc["head"][0], sc["head"][1], sc["active"], ap(t, 0.1, 0.5))
    caption(cv, sc["caps"], t)
    im = cv.im
    fade = ap(t, 0.0, 0.45) * (1 - ap(t, sc["dur"] - 0.45, 0.45))
    if sc["key"] == "end":
        fade = ap(t, 0.0, 0.45) * (1 - ap(t, sc["dur"] - 0.8, 0.8))
    if fade < 1:
        im = Image.blend(background(), im, fade)
    return im.resize((W, H), Image.LANCZOS)


def _frame_bytes(i):
    return render_at(i / FPS).tobytes()


def _audit_one(T):
    global AUDIT
    AUDIT = []
    render_at(T)
    items = [x for x in AUDIT if x["a"] >= 0.97]
    AUDIT = None
    sc, t = scene_at(T)
    issues = []
    fade_ok = t > 0.7 and t < sc["dur"] - 0.6
    if not fade_ok:
        return T, sc["key"], [], 0
    words = 0
    for x in items:
        if x.get("overflow"):
            issues.append(f"overflow: '{x['text']}'")
            continue
        if x["ratio"] < 4.5:
            issues.append(f"contrast {x['ratio']:.2f}: '{x['text']}'")
        bb = x["bbox"]
        if bb[0] < 0 or bb[1] < 0 or bb[2] > W or bb[3] > H:
            issues.append(f"off canvas: '{x['text']}'")
        if bb[1] > 104 and bb[3] < 612:
            words += len(x["text"].split())
    its = [x for x in items if not x.get("overflow")]
    for i in range(len(its)):
        for j in range(i + 1, len(its)):
            a, b = its[i]["bbox"], its[j]["bbox"]
            ox, oy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            if ox > 2 and oy > 3:
                issues.append(f"overlap: '{its[i]['text']}' / '{its[j]['text']}'")
    return T, sc["key"], issues, words


def audit(workers):
    """Check caption timing, text contrast (WCAG AA 4.5:1), overflow, overlaps, and that no reveal runs into a hold."""
    global DOTS
    bad = 0
    t0 = 0.0
    times, checks = [], []
    for s in SCENES:
        for (c, ph, r) in zip(s["cs"], s["phases"], s["rows"]):
            need = max(4.0, 2.0 + 0.35 * r["cap_words"])
            if r["hold"] + 1e-6 < need or r["total"] + 1e-6 < r["hold"] + r["anim"]:
                print(f"TIMING {s['key']}: hold {r['hold']:.2f} s is under the caption rule {need:.2f} s")
                bad += 1
            checks.append((t0 + c + r["anim"] + 0.05, t0 + c + r["total"] - 0.5, s["key"]))
            times += [t0 + c + r["anim"] + 0.1, t0 + c + (r["anim"] + r["total"]) / 2, t0 + c + r["total"] - 0.3]
            times += [t0 + c + 0.8, t0 + c + r["anim"] * 0.5 + 0.2]
        t0 += s["dur"]
    t = 1.0
    while t < TOTAL:
        times.append(t)
        t += 2.0
    times = sorted(set(round(x, 2) for x in times if x < TOTAL))
    with Pool(workers) as pool:
        res = pool.map(_audit_one, times, chunksize=4)
    maxw, seen = {}, set()
    for T, key, issues, words in res:
        maxw[key] = max(maxw.get(key, 0), words)
        for m in issues:
            k = (key, m)
            if k not in seen:
                seen.add(k)
                print(f"  {T:7.1f}s {key}: {m}")
                bad += 1
    for s in SCENES:
        decl = sum(len(x.split()) for ph in s["phases"] for x in ph["labels"])
        drawn = maxw.get(s["key"], 0)
        if drawn > decl * 1.0 + 3:
            print(f"WORDS {s['key']}: {drawn} words drawn on the diagram, only {decl} counted in the hold time")
            bad += 1
    DOTS = False
    steady = []
    for (a, b, key) in checks:
        steady += [a, b]
    with Pool(workers, initializer=_nodots) as pool:
        imgs = pool.map(_steady, steady, chunksize=4)
    for k in range(0, len(imgs), 2):
        if imgs[k] != imgs[k + 1]:
            print(f"REVEAL still running in the hold of a slide in {checks[k // 2][2]} at {checks[k // 2][0]:.1f}s")
            bad += 1
    print(f"audit: {len(times)} frames checked, {bad} issue(s)")
    return 1 if bad else 0


def _nodots():
    global DOTS
    DOTS = False


def _steady(T):
    return render_at(T).tobytes()


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    ap_.add_argument("--stills", help="comma separated seconds; write PNGs and stop")
    ap_.add_argument("--no-gif", action="store_true")
    ap_.add_argument("--schedule", action="store_true", help="print the per-slide timing table, and stop")
    ap_.add_argument("--audit", action="store_true", help="check timing, contrast, overflow and overlaps, and stop")
    ap_.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    a = ap_.parse_args()
    if a.schedule:
        print(timing_table())
        return 0
    if a.audit:
        return audit(a.workers)
    os.makedirs(a.out, exist_ok=True)
    if a.stills:
        for s in a.stills.split(","):
            p = os.path.join(a.out, f"still-{float(s):06.2f}.png")
            render_at(float(s)).save(p)
            print(p)
        return 0
    print(timing_table())
    n = int(round(TOTAL * FPS))
    mp4 = os.path.join(a.out, "memev-tiers.mp4")
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
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
