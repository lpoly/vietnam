#!/usr/bin/env python3
"""Draw the app icons (a transit-line station mark) as PNGs. Standard library only.

    python scripts/make-icons.py
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "img" / "icons"
INK = (17, 17, 20)
WHITE = (255, 255, 255)
LINES = [(208, 0, 28), (0, 128, 58), (0, 99, 173), (194, 80, 0)]


def png(path, size, pixels):
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(data)


def draw(size, pad):
    """Dark tile; four coloured horizontal line segments meeting at a white interchange ring."""
    px = [[INK] * size for _ in range(size)]
    c = size / 2
    inner = size * (1 - 2 * pad)
    lw = inner * 0.11
    for y in range(size):
        for x in range(size):
            dx, dy = x + 0.5 - c, y + 0.5 - c
            r = (dx * dx + dy * dy) ** 0.5
            # vertical line, coloured in four bands
            if abs(dx) < lw / 2 and abs(dy) < inner / 2:
                band = min(3, int((dy + inner / 2) / (inner / 4)))
                px[y][x] = LINES[band]
            # station ring
            if inner * 0.17 < r < inner * 0.27:
                px[y][x] = WHITE
            elif r <= inner * 0.17:
                px[y][x] = INK
    return px


OUT.mkdir(parents=True, exist_ok=True)
for name, size, pad in (("icon-180.png", 180, 0.08), ("icon-192.png", 192, 0.08),
                        ("icon-512.png", 512, 0.08), ("icon-maskable-512.png", 512, 0.2)):
    png(OUT / name, size, draw(size, pad))
    print("wrote", OUT / name)
