#!/usr/bin/env python3
"""Génère les icônes PNG de l'application Agora Factures.

Script volontairement autonome (aucune dépendance externe) : il rasterise
lui-même quelques primitives (rectangle arrondi, triangle) avec
sur-échantillonnage, puis écrit les fichiers PNG avec zlib.

Usage :  python3 tools/generer-icones.py
"""

import os
import struct
import zlib

# ---------------------------------------------------------------- palette
BG_A = (18, 55, 95)      # #12375f
BG_B = (11, 35, 64)      # #0b2340
PAPER = (255, 255, 255)
FOLD = (201, 220, 242)   # #c9dcf2
ACCENT = (29, 111, 216)  # #1d6fd8


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else (hi if v > hi else v)


def write_png(path, pixels, width, height):
    """pixels : bytearray RGBA de taille width*height*4."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filtre PNG "None"
        raw += pixels[y * stride:(y + 1) * stride]
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        body = tag + data
        return (struct.pack('>I', len(data)) + body +
                struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF))

    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) +
           chunk(b'IDAT', compressed) + chunk(b'IEND', b''))
    with open(path, 'wb') as fh:
        fh.write(png)


# ------------------------------------------------- couvertures des formes
def cov_rounded_rect(x, y, w, h, r, px, py):
    cx = x + w / 2.0
    cy = y + h / 2.0
    dx = max(abs(px - cx) - (w / 2.0 - r), 0.0)
    dy = max(abs(py - cy) - (h / 2.0 - r), 0.0)
    return clamp(0.5 - ((dx * dx + dy * dy) ** 0.5 - r))


def make_triangle(p0, p1, p2):
    (ax, ay), (bx, by), (cx, cy) = p0, p1, p2
    edges = []
    for a, b in ((p0, p1), (p1, p2), (p2, p0)):
        ex, ey = b[0] - a[0], b[1] - a[1]
        length = (ex * ex + ey * ey) ** 0.5 or 1.0
        edges.append((a[0], a[1], ey / length, -ex / length))
    xs = (ax, bx, cx)
    ys = (ay, by, cy)
    bbox = (min(xs) - 1.0, min(ys) - 1.0, max(xs) + 1.0, max(ys) + 1.0)

    def cov(px, py):
        if px < bbox[0] or py < bbox[1] or px > bbox[2] or py > bbox[3]:
            return 0.0
        d = -1e9
        for (ox, oy, nx, ny) in edges:
            v = (px - ox) * nx + (py - oy) * ny
            if v > d:
                d = v
        return clamp(0.5 - d)

    return cov, bbox


def make_rect(x, y, w, h, r):
    bbox = (x - 1.0, y - 1.0, x + w + 1.0, y + h + 1.0)

    def cov(px, py):
        if px < bbox[0] or py < bbox[1] or px > bbox[2] or py > bbox[3]:
            return 0.0
        return cov_rounded_rect(x, y, w, h, r, px, py)

    return cov, bbox


def make_gradient(size):
    k = 1.0 / (2.0 * size)

    def color(px, py):
        t = clamp((px + py) * k)
        return (BG_A[0] + (BG_B[0] - BG_A[0]) * t,
                BG_A[1] + (BG_B[1] - BG_A[1]) * t,
                BG_A[2] + (BG_B[2] - BG_A[2]) * t)

    return color


def render(size, maskable=False, ss=3):
    """Rend une icône carrée de `size` pixels (RGBA)."""
    scale = size / 512.0
    content_scale = 0.66 if maskable else 1.0
    radius = 0.0 if maskable else 96 * scale

    def S(v):
        # coordonnée espace 512 -> espace image (zone de sécurité PWA si maskable)
        offset = 256 * (1 - content_scale)
        return (offset + v * content_scale) * scale

    grad = make_gradient(size)

    # fond : dégradé plein, arrondi sauf en version « maskable »
    if maskable:
        bg_cov = lambda px, py: 1.0  # noqa: E731
    else:
        bg_cov, _ = make_rect(0, 0, size, size, radius)

    # calques (du fond vers le premier plan)
    layers = []
    layers.append((make_triangle((S(316), S(106)), (S(366), S(106)), (S(366), S(156))), grad))
    layers.append((make_rect(S(146), S(106), S(220), S(300), S(36)), lambda px, py: PAPER))
    layers.append((make_triangle((S(316), S(106)), (S(366), S(156)), (S(316), S(156))), lambda px, py: FOLD))
    layers.append((make_rect(S(180), S(176), S(148), S(16), S(8)), lambda px, py: FOLD))
    layers.append((make_rect(S(180), S(220), S(148), S(16), S(8)), lambda px, py: FOLD))
    layers.append((make_rect(S(180), S(264), S(100), S(16), S(8)), lambda px, py: FOLD))
    layers.append((make_rect(S(180), S(322), S(76), S(30), S(15)), lambda px, py: ACCENT))

    acc = [[0.0, 0.0, 0.0, 0.0] for _ in range(size * size)]
    n = size * ss
    inv_ss = 1.0 / ss

    for sy in range(n):
        py = (sy + 0.5) * inv_ss
        row = (sy // ss) * size
        for sx in range(n):
            px = (sx + 0.5) * inv_ss
            a = bg_cov(px, py)
            if a <= 0.0:
                continue
            r, g, b = grad(px, py)
            for ((cov, _bbox), color) in layers:
                c = cov(px, py)
                if c <= 0.0:
                    continue
                cr, cg, cb = color(px, py)
                r = cr * c + r * (1 - c)
                g = cg * c + g * (1 - c)
                b = cb * c + b * (1 - c)
                a = c + a * (1 - c)
                if a >= 1.0:
                    break
            cell = acc[row + sx // ss]
            cell[0] += r
            cell[1] += g
            cell[2] += b
            cell[3] += a

    total = float(ss * ss)
    out = bytearray(size * size * 4)
    for i, cell in enumerate(acc):
        alpha = clamp(cell[3] / total)
        if alpha > 0:
            r = clamp(cell[0] / total / alpha / 255.0)
            g = clamp(cell[1] / total / alpha / 255.0)
            b = clamp(cell[2] / total / alpha / 255.0)
        else:
            r = g = b = 0.0
        out[i * 4] = int(r * 255)
        out[i * 4 + 1] = int(g * 255)
        out[i * 4 + 2] = int(b * 255)
        out[i * 4 + 3] = int(alpha * 255)
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    icons = os.path.join(os.path.dirname(here), 'assets', 'icons')
    os.makedirs(icons, exist_ok=True)
    targets = [
        ('icon-192.png', 192, False, 4),
        ('icon-512.png', 512, False, 3),
        ('icon-maskable-512.png', 512, True, 3),
        ('apple-touch-icon.png', 180, False, 4),
        ('favicon-32.png', 32, False, 6),
        ('favicon-16.png', 16, False, 8),
    ]
    for name, size, maskable, ss in targets:
        pixels = render(size, maskable, ss)
        path = os.path.join(icons, name)
        write_png(path, pixels, size, size)
        print('écrit %s (%dx%d)' % (path, size, size))


if __name__ == '__main__':
    main()
