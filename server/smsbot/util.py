"""ابزارهای مشترک: زمان تهران، شماره موبایل، اعداد فارسی، پر کردن متن پیامک."""
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone

# ایران از ۱۴۰۱ ساعت تابستانی نداره؛ همیشه +۳:۳۰. سرور ممکنه خارج از ایران و روی UTC باشه.
TEHRAN = timezone(timedelta(hours=3, minutes=30))
GB = 1024 ** 3
DAY_MS = 86_400_000

# کلادفلر درخواست‌های پایتون بدون شناسه رو رد می‌کنه (خطای 1010)
USER_AGENT = "smsbot (+https://github.com/alikaidkhordeh/smsbot)"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def app_version():
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "dev"

FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_TO_EN = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "0123456789" * 2)
_TO_FA = str.maketrans("0123456789", FA_DIGITS)
PHONE_RE = re.compile(r"(?<!\d)(?:\+98|0098|0)?(9\d{9})(?!\d)")


def now_ms():
    return int(time.time() * 1000)


def tehran_now():
    return datetime.now(TEHRAN)


def to_en(s):
    return str(s or "").translate(_TO_EN)


def to_fa(s):
    return str(s).translate(_TO_FA)


def clean_phone(s):
    """هر شکلی از شمارهٔ ایرانی → 09xxxxxxxxx یا '' اگه نامعتبر بود."""
    m = PHONE_RE.search(to_en(s).replace(" ", "").replace("-", ""))
    return "0" + m.group(1) if m else ""


def e164(phone):
    """09121234567 → +989121234567 (قالبی که اپ گوشی می‌خواد)."""
    return "+98" + phone[1:] if phone.startswith("0") else phone


def vol_text(gb):
    if gb is None:
        return ""
    if gb >= 1:
        v = round(gb * 10) / 10
        return to_fa(("%g" % v).replace(".", "٫")) + " گیگ"
    return to_fa(int(round(gb * 1024))) + " مگ"


def fill_vars(text, name="", account="", left_gb=None, days=None):
    out = (text.replace("{اسم}", name or "")
           .replace("{اکانت}", account or "")
           .replace("{حجم}", vol_text(left_gb) if left_gb is not None else "")
           .replace("{روز}", to_fa(days) if days is not None else ""))
    out = re.sub(r" +([،,.!؟])", r"\1", out)
    return re.sub(r" {2,}", " ", out).strip()


def parse_hhmm(s, default):
    try:
        h, m = to_en(s).split(":")[:2]
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return default


def in_window(start, end, dt=None):
    """آیا الان (به وقت تهران) داخل بازهٔ ساعت مجاز ارسال هست؟ بازهٔ شبانه هم پشتیبانی می‌شه."""
    dt = dt or tehran_now()
    cur = dt.hour * 60 + dt.minute
    a, b = parse_hhmm(start, 9 * 60), parse_hhmm(end, 22 * 60)
    if a == b:
        return True
    return a <= cur < b if a < b else (cur >= a or cur < b)


def next_window_start(start, dt=None):
    dt = dt or tehran_now()
    a = parse_hhmm(start, 9 * 60)
    target = dt.replace(hour=a // 60, minute=a % 60, second=0, microsecond=0)
    if target <= dt:
        target += timedelta(days=1)
    return target


def tehran_day_start_ms(dt=None):
    dt = dt or tehran_now()
    return int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def fmt_time(ms):
    """زمان برای نمایش: «امروز ۱۰:۴۲»، «دیروز ۱۸:۲۰» یا «۳ روز پیش»."""
    if not ms:
        return ""
    dt = datetime.fromtimestamp(ms / 1000, TEHRAN)
    today = tehran_now().date()
    hm = to_fa(dt.strftime("%H:%M"))
    diff = (today - dt.date()).days
    if diff == 0:
        return "امروز " + hm
    if diff == 1:
        return "دیروز " + hm
    if diff < 0:
        return ("فردا " if diff == -1 else to_fa(-diff) + " روز دیگه ") + hm
    return to_fa(diff) + " روز پیش"


def days_left(expiry_ms, now=None):
    """None = بدون تاریخ (یا شروع بعد از اولین اتصال)، ۰ = تموم شده."""
    if not expiry_ms or expiry_ms < 0:
        return None
    now = now or now_ms()
    return max(0, math.ceil((expiry_ms - now) / DAY_MS))


def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))
