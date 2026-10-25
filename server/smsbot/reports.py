"""متن گزارش‌های تلگرام: ساعتی، خلاصهٔ روزانه، و قطع و وصل پنل/گوشی. (HTML تلگرام: <b> و <code> برای کپی شماره)"""
from html import escape

from . import util

TYPE_LABEL = {"volume": "⚡ هشدار حجم", "expiry": "📅 هشدار تاریخ", "ended": "⛔ پایان اشتراک",
              "broadcast": "📢 همگانی", "single": "✉️ پیامک تکی", "test": "🧪 آزمایشی"}
MAX_ITEMS = 15  # تلگرام پیام خیلی بلند رو قبول نمی‌کنه
SEP = "➖➖➖➖➖➖➖➖"


def describe(rule, left_gb, days):
    if rule == "ended":
        return "اشتراک تموم شد"
    if rule == "expiry" and days is not None:
        return "%s روز مونده" % util.to_fa(days)
    return "%s مونده" % util.vol_text(max(0.0, left_gb or 0.0))


def _who(email, contacts, phone=""):
    name = (contacts.get(email) or {}).get("name") or ""
    parts = ["<b>%s</b>" % escape(email)] if email else []
    if name:
        parts.append(escape(name))
    if phone:
        parts.append("<code>%s</code>" % escape(phone))
    return " · ".join(parts) or "—"


def _section(title, items, render):
    if not items:
        return []
    out = ["", "%s (%s)" % (title, util.to_fa(len(items)))]
    for it in items[:MAX_ITEMS]:
        out.append(render(it))
    if len(items) > MAX_ITEMS:
        out.append("      … و %s مورد دیگه" % util.to_fa(len(items) - MAX_ITEMS))
    return out


def hourly(db, since, until, queue_reason=""):
    """گزارش یک ساعت؛ اگه هیچ اتفاقی نیفتاده None (پیام نمی‌ره)."""
    rows = db.q("SELECT m.*, b.title AS btitle FROM messages m LEFT JOIN broadcasts b ON b.id = m.broadcast_id "
                "WHERE m.sent_at >= ? AND m.sent_at < ? AND m.type != 'test' ORDER BY m.id", (since, until))
    nophone = db.q("SELECT * FROM events WHERE kind = 'nophone' AND at >= ? AND at < ? ORDER BY id", (since, until))
    if not rows and not nophone:
        return None
    contacts = db.contacts()
    single = [r for r in rows if r["type"] != "broadcast"]
    sent = [r for r in single if r["status"] in ("sending", "sent", "delivered")]
    failed = [r for r in single if r["status"] == "failed"]
    skipped = [r for r in single if r["status"] == "skipped"]
    start, end = util.hm(since), util.hm(until)
    lines = ["🔔 <b>گزارش پیامک‌ها</b>", "🕐 ساعت %s تا %s · %s" % (start, end, util.jalali_text(util.tehran_now())), SEP]
    lines += _section("✅ <b>ارسال شد</b>", sent, lambda r: "▫️ %s\n      %s · ساعت %s" % (
        _who(r["email"], contacts, r["phone"]), TYPE_LABEL.get(r["type"], r["type"]), util.hm(r["sent_at"])))
    lines += _section("📵 <b>به حد هشدار رسیدن ولی شماره ندارن</b>", nophone, lambda e: "▫️ %s\n      %s" % (
        _who(e["email"], contacts), escape(e["text"])))
    lines += _section("⏭ <b>فرستاده نشد</b>", skipped, lambda r: "▫️ %s\n      %s" % (
        _who(r["email"], contacts), escape(r["error"] or "")))
    lines += _section("❌ <b>ناموفق</b>", failed, lambda r: "▫️ %s\n      %s" % (
        _who(r["email"], contacts, r["phone"]), escape((r["error"] or "علت نامعلوم")[:160])))
    # پیام‌های همگانی خلاصه (نه تک‌تک گیرنده‌ها)
    groups = {}
    for r in rows:
        if r["type"] == "broadcast":
            g = groups.setdefault(r["btitle"] or "پیام همگانی", {"ok": 0, "bad": 0})
            g["ok" if r["status"] in ("sending", "sent", "delivered") else "bad"] += 1
    if groups:
        lines += ["", "📢 <b>پیام همگانی</b>"]
        lines += ["▫️ «%s» · %s رفت%s" % (escape(t), util.to_fa(g["ok"]), " · %s ناموفق" % util.to_fa(g["bad"]) if g["bad"] else "")
                  for t, g in groups.items()]
    queued = db.one("SELECT COUNT(*) AS n FROM messages WHERE status = 'queued'")["n"]
    if queued:
        lines += ["", "⏳ <b>در صف: %s پیامک</b>%s" % (util.to_fa(queued), "\n      " + escape(queue_reason) if queue_reason else "")]
    return "\n".join(lines)


def daily(db, day_start, status, queue_reason="", near=0):
    contacts = db.contacts()
    cnt = {r["status"]: r["n"] for r in db.q(
        "SELECT status, COUNT(*) AS n FROM messages WHERE sent_at >= ? AND type != 'test' GROUP BY status", (day_start,))}
    sent = cnt.get("sending", 0) + cnt.get("sent", 0) + cnt.get("delivered", 0)
    nophone = db.q("SELECT DISTINCT email FROM events WHERE kind = 'nophone' AND at >= ?", (day_start,))
    queued = db.one("SELECT COUNT(*) AS n FROM messages WHERE status = 'queued'")["n"]
    dot = lambda ok: "🟢" if ok else ("🔴" if ok is False else "⚪️")
    lines = [
        "📊 <b>خلاصهٔ امروز</b> · %s" % util.jalali_text(util.tehran_now()), SEP,
        "✅ ارسال‌شده: <b>%s</b>    ❌ ناموفق: <b>%s</b>" % (util.to_fa(sent), util.to_fa(cnt.get("failed", 0))),
        "⏭ فرستاده‌نشده (تمدید شده): <b>%s</b>    ⏳ در صف: <b>%s</b>" % (util.to_fa(cnt.get("skipped", 0)), util.to_fa(queued)),
        "⚠️ نزدیک اتمام الان: <b>%s</b>    📵 بدون شماره: <b>%s</b>" % (util.to_fa(near), util.to_fa(len(nophone))),
        "%s پنل %s    %s گوشی %s" % (dot(status["panel"]["ok"]), "وصله" if status["panel"]["ok"] else "قطعه",
                                     dot(status["phone"]["ok"]), "وصله" if status["phone"]["ok"] else "قطعه"),
    ]
    if queued and queue_reason:
        lines.append("      " + escape(queue_reason))
    if nophone:
        names = [escape(r["email"]) for r in nophone[:20]]
        lines += ["", "📵 <b>امروز به حد هشدار رسیدن ولی شماره ندارن:</b>",
                  "، ".join(names) + (" … و %s تای دیگه" % util.to_fa(len(nophone) - 20) if len(nophone) > 20 else "")]
    return "\n".join(lines)


def health(kind, ok, detail="", queued=0):
    """پیام قطع یا وصل شدن پنل/گوشی."""
    what = "پنل" if kind == "panel" else "گوشی"
    now = util.hm(util.tehran_now())
    if not ok:
        tail = ("تا وصل نشه، کانفیگ‌ها چک نمی‌شن و هشداری ساخته نمی‌شه." if kind == "panel"
                else "پیامک‌ها تو صف می‌مونن و وقتی گوشی وصل شد فرستاده می‌شن.")
        return "🔴 <b>%s قطع شد</b> · ساعت %s\n%s%s" % (what, now, ("علت: " + escape(detail) + "\n") if detail else "", tail)
    tail = ("\n⏳ %s پیامک تو صف الان فرستاده می‌شه." % util.to_fa(queued)) if queued and kind == "phone" else ""
    return "🟢 <b>%s دوباره وصل شد</b> · ساعت %s%s" % (what, now, tail)
