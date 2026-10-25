"""ساخت آیکون‌های برنامه (PNG) بدون هیچ کتابخونهٔ اضافه: مربع آبی با حباب پیام سفید.

اجرا: python tools/make_icons.py  ← خروجی در web/icons/
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "icons")
BLUE = (59, 91, 219)
WHITE = (255, 255, 255)


def rounded_rect(x, y, x0, y0, x1, y1, r):
    cx, cy = min(max(x, x0 + r), x1 - r), min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1


def capsule(x, y, ax, ay, bx, by, w):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= w / 2


def triangle(x, y, a, b, c):
    def s(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = s((x, y), a, b), s((x, y), b, c), s((x, y), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def bubble(u, v):
    """حباب پیام در مختصات ۰ تا ۲۴ (مثل آیکون داخل برنامه)؛ خط‌های متن سوراخ‌ان."""
    inside = rounded_rect(u, v, 3, 3, 21, 17, 3) or triangle(u, v, (3.6, 14), (3.6, 21.5), (9.5, 16.5))
    if not inside:
        return False
    return not (capsule(u, v, 8, 8.5, 16, 8.5, 1.9) or capsule(u, v, 8, 12.5, 13, 12.5, 1.9))


def render(size, maskable=False, rounded=True):
    ss = 3  # نمونه‌برداری اضافه برای لبهٔ صاف
    scale = 0.52 if maskable else 0.62  # آیکون maskable باید داخل ناحیهٔ امن (۸۰٪ وسط) بمونه
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            bg = fg = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if rounded and not maskable and not rounded_rect(x, y, 0, 0, 1, 1, 0.225):
                        continue
                    bg += 1
                    u = (x - 0.5) / scale * 24 + 12
                    v = (y - 0.5) / scale * 24 + 12.6
                    if bubble(u, v):
                        fg += 1
            n = ss * ss
            if bg == 0:
                row += bytes(4)
                continue
            t = fg / bg
            col = [round(BLUE[i] * (1 - t) + WHITE[i] * t) for i in range(3)]
            row += bytes(col + [round(255 * bg / n)])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, size, kw in (("icon-192.png", 192, {}), ("icon-512.png", 512, {}),
                           ("maskable-512.png", 512, {"maskable": True}),
                           ("apple-touch-icon.png", 180, {"rounded": False}),
                           ("favicon-32.png", 32, {})):
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(render(size, **kw))
        print("ok", name)
