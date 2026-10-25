"""موتور پس‌زمینه: هر چند دقیقه پنل رو چک می‌کنه، پیامک هشدار رو تو صف می‌ذاره، صف رو با رعایت
ساعت مجاز، فاصله و سقف روزانه می‌فرسته، وضعیت پیامک‌ها و گوشی رو از اپ می‌پرسه، و گزارش‌ها و
پشتیبان رو به تلگرام می‌فرسته.

قانون صف: پیامک هشدار لحظهٔ ارسال دوباره با پنل چک می‌شه (اگه تمدید شده نمی‌ره، اگه نه با عدد تازه می‌ره)؛
اگه گوشی یا اتصال مشکل داشت، پیامک لغو نمی‌شه و منتظر می‌مونه تا درست بشه."""
import logging
import threading
import time

from . import backup, reports, util
from .gateway import Gateway, GatewayError
from .panel import Panel, PanelError, normalize
from .telegram import Telegram, TelegramError

log = logging.getLogger("smsbot")
RULES = ("ended", "volume", "expiry")
MANUAL = ("single", "test")  # پیامک‌هایی که خود علی همون لحظه می‌فرسته
RETRY_MAX = 30  # خطای ارسال: حدود یک روز تلاش (فاصله‌ها تا یک ساعت)
DEVICE_RETRY_MAX = 6  # گوشی پیامک رو گرفت ولی نتونست بفرسته: ۶ بار با فاصلهٔ نیم ساعت


def conditions(c, rules):
    """کدوم قانون‌های هشدار الان برای این کانفیگ برقرارن؛ (شرط‌ها، حجم باقی‌مونده)."""
    thr = rules["volume"]["amount"] / 1024 if rules["volume"].get("unit") == "MB" else rules["volume"]["amount"]
    left = c["totalGB"] - c["usedGB"] if c["totalGB"] > 0 else None
    ended = (left is not None and left <= 0) or c["daysLeft"] == 0
    return {
        "ended": ended,
        "volume": not ended and c["enabled"] and left is not None and 0 < left <= thr,
        "expiry": not ended and c["enabled"] and c["daysLeft"] is not None and 0 < c["daysLeft"] <= rules["expiry"]["days"],
    }, left


class Engine:
    def __init__(self, db):
        self.db = db
        self.wake = threading.Event()
        self.panel_status = {"ok": None, "checkedAt": 0, "error": "", "version": ""}
        self.phone_status = {"ok": None, "checkedAt": 0, "error": "", "device": "", "lastSeenAgo": None}
        self._panel, self._panel_key = None, None
        self.last_check = self.last_send = self.last_poll = self.last_device = self.last_backup_try = 0.0
        self.queue_reason = ""  # چرا صف الان منتظره (برای صفحه و گزارش)
        self.near_count = 0
        self.panel_fails = 0
        self.reported = {"panel": True, "phone": True}  # آخرین وضعیتی که به تلگرام گزارش شد

    # ───── اتصال‌ها (با هر تغییر تنظیمات از نو ساخته می‌شن) ─────
    def panel(self, cfg=None):
        cfg = cfg or self.db.settings()["panel"]
        key = util.dumps(cfg)
        if key != self._panel_key:
            self._panel, self._panel_key = Panel(cfg), key
        return self._panel

    def gateway(self, cfg=None):
        return Gateway(cfg or self.db.settings()["phone"])

    def mark_panel(self, ok, error=""):
        if error and error != self.panel_status.get("error"):
            log.warning("panel: %s", error)
        self.panel_status.update(ok=ok, error=error, checkedAt=time.time())

    def check_soon(self):
        self.last_check = 0
        self.wake.set()

    # ───── حلقهٔ اصلی ─────
    def start(self):
        threading.Thread(target=self._loop, name="engine", daemon=True).start()

    def _loop(self):
        pause = 10
        while True:
            try:
                pause = self.tick()
            except Exception:  # موتور هیچ‌وقت نباید بخوابه
                log.exception("engine tick failed")
            self.wake.wait(pause)
            self.wake.clear()

    def tick(self):
        s = self.db.settings()
        now = time.time()
        if now - self.last_check >= max(1, int(s["rules"].get("intervalMin") or 10)) * 60:
            self.last_check = now
            self.check_alerts(s)
        if now - self.last_device >= 120:
            self.last_device = now
            self.refresh_phone(s)
        self.process_queue(s)
        if now - self.last_poll >= 60:
            self.last_poll = now
            self.poll_states(s)
        self.maybe_backup(s)
        self.maybe_reports(s)
        # اگه فاصلهٔ پیامک‌ها کمتر از ۱۰ ثانیه‌ست، زودتر سر بزن
        return max(1, min(10, int(s["sending"].get("gapSec") or 20)))

    # ───── هشدارها ─────
    def check_alerts(self, s):
        p = self.panel(s["panel"])
        if not p.configured:
            self.panel_status.update(ok=None, error="", checkedAt=0)
            return
        try:
            raw = p.clients()
            self.mark_panel(True)
            self.panel_fails = 0
            self._health("panel", True)
        except PanelError as e:
            self.mark_panel(False, str(e))
            self.panel_fails += 1
            if self.panel_fails >= 2:  # یه خطای گذرا رو گزارش نکن
                self._health("panel", False, str(e))
            return
        try:
            self.panel_status["version"] = p.status().get("version") or self.panel_status["version"]
        except PanelError:
            pass
        if not s["panel"].get("linkHost"):
            # بدون آدرس عمومی، لینک‌ها با localhost ساخته می‌شن؛ یک بار از پنل پیدا و ذخیره‌ش می‌کنیم
            host = p.detect_host()
            if host:
                self.db.save_section("panel", dict(s["panel"], linkHost=host))
                log.info("link host detected: %s", host)

        rules = s["rules"]
        contacts, states = self.db.contacts(), self.db.alert_states()
        templates = {t["id"]: t["text"] for t in self.db.q("SELECT id, text FROM templates")}
        near = 0
        for c in map(normalize, raw):
            email = c["email"]
            phone = util.phone_for(contacts, email, c["comment"])
            conds, left = conditions(c, rules)
            near += 1 if (conds["volume"] or conds["expiry"]) else 0
            have = states.get(email, set())
            for rule in RULES:
                np_key = "nophone_" + rule
                if not conds[rule]:
                    for k in (rule, np_key):
                        if k in have:  # تمدید شده → دورهٔ بعد دوباره هشدار می‌گیره
                            self.db.clear_alert(email, k)
                    continue
                if rule in have:
                    continue
                r = rules[rule]
                active = rules.get("enabled") and r.get("on")
                if rule == "ended" and not active:
                    # «پایان اشتراک» فقط لحظهٔ تموم شدن معنی داره؛ اگه خاموش بود، بعداً با روشن شدنش برای قدیمی‌ها نره
                    self.db.mark_alert(email, rule)
                    continue
                if not active or r.get("templateId") not in templates:
                    continue
                if not phone:
                    if np_key not in have:  # برای گزارش تلگرام: به حد هشدار رسیده ولی شماره نداره (یک بار)
                        self.db.add_event("nophone", email, reports.describe(rule, left, c["daysLeft"]))
                        self.db.mark_alert(email, np_key)
                    continue
                text = util.fill_vars(templates[r["templateId"]], (contacts.get(email) or {}).get("name", ""), email, left, c["daysLeft"])
                self.db.enqueue(phone, text, rule, int(r.get("line") or 1), email)
                self.db.mark_alert(email, rule)
                log.info("alert queued: %s %s", rule, email)
        self.near_count = near

    def revalidate(self, row, s):
        """لحظهٔ ارسال: هشدار هنوز درسته؟ ('send', شماره، متن تازه) / ('skip', دلیل) / ('wait', دلیل)."""
        rule, email = row["type"], row["email"]
        p = self.panel(s["panel"])
        try:
            rec = p.get_client(email) or {}
        except PanelError:
            try:
                p.status()  # پنل در دسترسه → یعنی خود کانفیگ نیست
                return "skip", "فرستاده نشد: کانفیگ تو پنل نیست"
            except PanelError as e:
                return "wait", "منتظر وصل شدن پنل (%s)" % e
        client = rec.get("client") or {}
        if not client:
            return "skip", "فرستاده نشد: کانفیگ تو پنل نیست"
        c = normalize(dict(client, inboundIds=rec.get("inboundIds") or [], traffic={"up": rec.get("usedTraffic") or 0, "down": 0}))
        conds, left = conditions(c, s["rules"])
        if not conds.get(rule):
            return "skip", "فرستاده نشد: تمدید شده" if rule != "ended" else "فرستاده نشد: دوباره فعال شده"
        contacts = self.db.contacts()
        phone = util.phone_for(contacts, email, c["comment"])
        if not phone:
            return "skip", "فرستاده نشد: شماره حذف شده"
        tpl = self.db.one("SELECT text FROM templates WHERE id = ?", (s["rules"][rule].get("templateId"),))
        text = util.fill_vars(tpl["text"], (contacts.get(email) or {}).get("name", ""), email, left, c["daysLeft"]) if tpl else row["text"]
        return "send", phone, text

    # ───── صف ارسال ─────
    def process_queue(self, s):
        gw = self.gateway(s["phone"])
        row = self.db.one("SELECT * FROM messages WHERE status = 'queued' AND send_after <= ? "
                          "ORDER BY CASE WHEN type = 'broadcast' THEN 1 ELSE 0 END, id LIMIT 1", (util.now_ms(),))
        if not row:
            later = self.db.one("SELECT wait_reason FROM messages WHERE status = 'queued' ORDER BY send_after LIMIT 1")
            self.queue_reason = (later or {}).get("wait_reason") or ""
            return
        snd = s["sending"]
        if not gw.configured:
            self.queue_reason = "گوشی تو تنظیمات وصل نشده"
            return
        if not util.in_window(snd.get("from"), snd.get("to")):
            self.queue_reason = "بیرون از ساعت مجاز؛ ساعت %s فرستاده می‌شه" % util.hm(util.next_window_start(snd.get("from")))
            return
        limit = int(snd.get("dailyLimit") or 50)
        if self.db.sent_today() >= limit:
            self.queue_reason = "سقف روزانه (%s پیامک) پر شده؛ فردا فرستاده می‌شه" % util.to_fa(limit)
            return
        if self.phone_status.get("ok") is False:
            self.queue_reason = "منتظر وصل شدن گوشی (%s)" % (self.phone_status.get("error") or "قطعه")
            return
        if time.time() - self.last_send < int(snd.get("gapSec") or 20):
            return
        if row["type"] in RULES:
            verdict = self.revalidate(row, s)
            if verdict[0] == "wait":
                self.queue_reason = verdict[1]
                return
            if verdict[0] == "skip":
                self.db.update_message(row["id"], status="skipped", error=verdict[1], sent_at=util.now_ms(), wait_reason=None)
                if verdict[1].endswith("تمدید شده") or verdict[1].endswith("فعال شده"):
                    self.db.clear_alert(row["email"], row["type"])
                log.info("queued alert skipped #%s %s: %s", row["id"], row["email"], verdict[1])
                self.wake.set()
                return
            row = dict(row, phone=verdict[1], text=verdict[2])
            self.db.update_message(row["id"], phone=row["phone"], text=row["text"])
        self.queue_reason = ""
        self.last_send = time.time()
        self._send_row(gw, row)

    def _send_row(self, gw, row, manual=False):
        self.db.update_message(row["id"], status="sending", sent_at=util.now_ms(), error=None, wait_reason=None)
        try:
            gid = gw.send(row["phone"], row["text"], int(row["line"] or 1))
            self.db.update_message(row["id"], gateway_id=gid)
        except GatewayError as e:
            attempts = (row.get("attempts") or 0) + 1
            if manual or attempts > RETRY_MAX:
                self.db.update_message(row["id"], status="failed", error=str(e), attempts=attempts)
            else:
                # لغو نمی‌شه: صبر می‌کنه و دوباره امتحان می‌کنه (۵، ۱۰، ۲۰، ۴۰ دقیقه، بعد ساعتی)
                delay = min(60, 5 * 2 ** min(attempts - 1, 4))
                at = util.now_ms() + delay * 60_000
                self.db.update_message(row["id"], status="queued", send_after=at, attempts=attempts, gateway_id=None,
                                       wait_reason="تلاش دوباره ساعت %s · %s" % (util.hm(at), e))
            log.warning("send failed #%s (try %s): %s", row["id"], attempts, e)

    def send_now(self, phone, text, line, email="", kind="single"):
        """پیامک دستی (تکی یا آزمایشی): همون لحظه، بدون منتظر موندن برای ساعت مجاز."""
        mid = self.db.enqueue(phone, text, kind, line, email, status="sending")
        row = self.db.one("SELECT * FROM messages WHERE id = ?", (mid,))
        self._send_row(self.gateway(), row, manual=True)
        row = self.db.one("SELECT status, error FROM messages WHERE id = ?", (mid,))
        if row["status"] == "failed":
            raise GatewayError(row["error"])
        return mid

    def poll_states(self, s):
        gw = self.gateway(s["phone"])
        if not gw.configured:
            return
        rows = self.db.q("SELECT id, gateway_id, type, attempts FROM messages WHERE status = 'sending' AND gateway_id IS NOT NULL "
                         "AND sent_at > ? ORDER BY id LIMIT 30", (util.now_ms() - 3 * util.DAY_MS,))
        for r in rows:
            try:
                state, err, _ = gw.state(r["gateway_id"])
            except GatewayError:
                return
            if state == "sending":
                continue
            if state == "failed" and r["type"] not in MANUAL and (r["attempts"] or 0) < DEVICE_RETRY_MAX:
                # گوشی نتونست بفرسته (مثلاً اجازه یا آنتن): نیم ساعت بعد دوباره
                at = util.now_ms() + 30 * 60_000
                self.db.update_message(r["id"], status="queued", send_after=at, attempts=(r["attempts"] or 0) + 1,
                                       gateway_id=None, wait_reason="گوشی نتونست بفرسته؛ ساعت %s دوباره · %s" % (util.hm(at), err))
                continue
            self.db.update_message(r["id"], status=state, error=err or None)

    def refresh_phone(self, s):
        gw = self.gateway(s["phone"])
        if not gw.configured:
            self.phone_status.update(ok=None, error="", device="", lastSeenAgo=None, checkedAt=time.time())
            return
        try:
            devs = gw.devices()
        except GatewayError as e:
            if str(e) != self.phone_status.get("error"):
                log.warning("phone: %s", e)
            self.phone_status.update(ok=False, error=str(e), checkedAt=time.time())
            self._health("phone", False, str(e))
            return
        if not devs:
            self.phone_status.update(ok=False, error="هیچ گوشی‌ای به این حساب وصل نیست.", device="", lastSeenAgo=None)
            self._health("phone", False, "هیچ گوشی‌ای به حساب اپ وصل نیست")
            return
        d = min(devs, key=lambda x: x["lastSeenAgo"] if x["lastSeenAgo"] is not None else 10 ** 9)
        ago = d["lastSeenAgo"]
        ok = ago is not None and ago <= 60
        self.phone_status.update(ok=ok, device=d["name"], lastSeenAgo=ago, checkedAt=time.time(),
                                 error="" if ok else "گوشی مدتیه به اینترنت وصل نشده.")
        self._health("phone", ok, "آخرین ارتباط %s دقیقه پیش" % util.to_fa(ago) if ago is not None else "")

    # ───── تلگرام: قطع و وصل، گزارش‌ها، پشتیبان ─────
    def _telegram(self):
        b = self.db.settings()["backup"]
        return (Telegram(b.get("token")), b.get("chatId")) if b.get("token") and b.get("chatId") else (None, None)

    def _health(self, kind, ok, detail=""):
        """فقط وقتی وضعیت عوض می‌شه پیام می‌ده (وصل → قطع، قطع → وصل)."""
        if self.reported.get(kind) == ok:
            return
        self.reported[kind] = ok
        if not self.db.settings()["reports"].get("health"):
            return
        tg, chat = self._telegram()
        if not tg:
            return
        queued = self.db.one("SELECT COUNT(*) AS n FROM messages WHERE status = 'queued'")["n"]
        try:
            tg.send_message(chat, reports.health(kind, ok, detail, queued), html=True)
        except TelegramError as e:
            log.warning("telegram health: %s", e)

    def maybe_reports(self, s):
        rep = s.get("reports") or {}
        tg, chat = self._telegram()
        if not tg or not (rep.get("hourly") or rep.get("daily")):
            return
        now = util.tehran_now()
        hour_ms = int(now.replace(minute=0, second=0, microsecond=0).timestamp() * 1000)
        if rep.get("hourly") and (rep.get("lastHourly") or 0) < hour_ms:
            since = max(rep.get("lastHourly") or 0, hour_ms - 3_600_000)
            self._save_meta("reports", lastHourly=hour_ms)  # اول ذخیره: اگه تلگرام خطا داد، هر ۱۰ ثانیه تکرار نشه
            text = reports.hourly(self.db, since, hour_ms, self.queue_reason)
            if text:
                try:
                    tg.send_message(chat, text, html=True)
                except TelegramError as e:
                    log.warning("telegram hourly: %s", e)
        at = util.parse_hhmm(rep.get("dailyTime"), 22 * 60)
        target = now.replace(hour=at // 60, minute=at % 60, second=0, microsecond=0)
        target_ms = int(target.timestamp() * 1000)
        if rep.get("daily") and now >= target and (rep.get("lastDaily") or 0) < target_ms:
            self._save_meta("reports", lastDaily=target_ms)
            try:
                text = reports.daily(self.db, util.tehran_day_start_ms(now), self.status_view(), self.queue_reason, self.near_count)
                tg.send_message(chat, text, html=True)
            except TelegramError as e:
                log.warning("telegram daily: %s", e)

    def maybe_backup(self, s):
        b = s.get("backup") or {}
        if not (b.get("telegram") and b.get("token") and b.get("chatId")):
            return
        now = util.tehran_now()
        at = util.parse_hhmm(b.get("time"), 3 * 60)
        target = now.replace(hour=at // 60, minute=at % 60, second=0, microsecond=0)
        if now < target or (b.get("lastSent") or 0) >= int(target.timestamp() * 1000):
            return  # هنوز ساعتش نشده، یا امروز فرستاده شده
        if time.time() - self.last_backup_try < 3600:
            return  # بعد از خطا، ساعتی یه بار دوباره
        self.last_backup_try = time.time()
        try:
            self.send_backup()
        except (TelegramError, OSError):
            pass  # خطا تو تنظیمات ذخیره شده و تو صفحه نشون داده می‌شه

    def send_backup(self):
        """فایل پشتیبان کامل + اکسل شماره‌ها به ربات تلگرام."""
        b = self.db.settings()["backup"]
        tg, chat = Telegram(b.get("token")), b.get("chatId")
        try:
            rows = backup.contact_rows(self.db, self)
            st = backup.stamp()
            caption = ("💾 پشتیبان پنل پیامک · %s · ساعت %s\n📇 %s شماره · نسخهٔ %s\n"
                       "برای بازگردانی: تنظیمات ← «بازگردانی از پشتیبان» ← همین فایل .db"
                       % (util.jalali_text(util.tehran_now()), util.hm(util.tehran_now()), util.to_fa(len(rows) - 1), util.app_version()))
            tg.send_document(chat, "smsbot-backup-%s.db" % st, backup.db_bytes(self.db), caption)
            tg.send_document(chat, "smsbot-numbers-%s.xlsx" % st, backup.xlsx(rows), "📇 شماره‌های مشتری‌ها (اکسل)")
            self._save_meta("backup", lastSent=util.now_ms(), lastError="")
            log.info("backup sent to telegram")
        except TelegramError as e:
            self._save_meta("backup", lastError=str(e))
            log.warning("backup: %s", e)
            raise

    def _save_meta(self, section, **meta):
        # دوباره می‌خونیم که تنظیماتی که همین الان ذخیره شده پاک نشه
        cur = self.db.settings()[section]
        cur.update(meta)
        self.db.save_section(section, cur)

    def status_view(self):
        s = self.db.settings()
        p, ph = self.panel_status, self.phone_status
        ago = lambda t: int((time.time() - t) // 60) if t else None
        return {
            "panel": {"ok": p["ok"], "configured": self.panel(s["panel"]).configured, "type": "3X-UI", "version": p["version"],
                      "checkedAgo": ago(p["checkedAt"]), "error": p["error"]},
            "phone": {"ok": ph["ok"], "configured": self.gateway(s["phone"]).configured, "device": ph["device"],
                      "lastSeenAgo": ph["lastSeenAgo"], "error": ph["error"]},
            "smsToday": self.db.sent_today(), "dailyLimit": int(s["sending"].get("dailyLimit") or 50),
            "queued": self.db.one("SELECT COUNT(*) AS n FROM messages WHERE status = 'queued'")["n"],
            "queueReason": self.queue_reason,
        }
