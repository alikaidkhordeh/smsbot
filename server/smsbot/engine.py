"""موتور پس‌زمینه: هر چند دقیقه پنل رو چک می‌کنه، پیامک هشدار رو تو صف می‌ذاره، صف رو با رعایت
ساعت مجاز، فاصله و سقف روزانه می‌فرسته و وضعیت پیامک‌ها و گوشی رو از اپ می‌پرسه."""
import logging
import threading
import time

from . import util
from .gateway import Gateway, GatewayError
from .panel import Panel, PanelError, normalize

log = logging.getLogger("smsbot")
RULES = ("ended", "volume", "expiry")


class Engine:
    def __init__(self, db):
        self.db = db
        self.wake = threading.Event()
        self.panel_status = {"ok": None, "checkedAt": 0, "error": "", "version": ""}
        self.phone_status = {"ok": None, "checkedAt": 0, "error": "", "device": "", "lastSeenAgo": None}
        self._panel, self._panel_key = None, None
        self.last_check = self.last_send = self.last_poll = self.last_device = 0.0

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
        except PanelError as e:
            self.mark_panel(False, str(e))
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
        thr = rules["volume"]["amount"] / 1024 if rules["volume"].get("unit") == "MB" else rules["volume"]["amount"]
        contacts, states = self.db.contacts(), self.db.alert_states()
        templates = {t["id"]: t["text"] for t in self.db.q("SELECT id, text FROM templates")}

        for c in map(normalize, raw):
            email = c["email"]
            contact = contacts.get(email) or {}
            phone = contact.get("phone") or util.clean_phone(c["comment"])
            left = c["totalGB"] - c["usedGB"] if c["totalGB"] > 0 else None
            ended = (left is not None and left <= 0) or c["daysLeft"] == 0
            conds = {
                "ended": ended,
                "volume": not ended and c["enabled"] and left is not None and 0 < left <= thr,
                "expiry": not ended and c["enabled"] and c["daysLeft"] is not None and 0 < c["daysLeft"] <= rules["expiry"]["days"],
            }
            have = states.get(email, set())
            for rule in RULES:
                if not conds[rule]:
                    if rule in have:  # تمدید شده → دورهٔ بعد دوباره هشدار می‌گیره
                        self.db.clear_alert(email, rule)
                    continue
                if rule in have:
                    continue
                r = rules[rule]
                active = rules.get("enabled") and r.get("on")
                if rule == "ended" and not active:
                    # «پایان اشتراک» فقط لحظهٔ تموم شدن معنی داره؛ اگه خاموش بود، بعداً با روشن شدنش برای قدیمی‌ها نره
                    self.db.mark_alert(email, rule)
                    continue
                if not active or not phone or r.get("templateId") not in templates:
                    continue
                text = util.fill_vars(templates[r["templateId"]], contact.get("name", ""), email, left, c["daysLeft"])
                self.db.enqueue(phone, text, rule, int(r.get("line") or 1), email)
                self.db.mark_alert(email, rule)
                log.info("alert queued: %s %s", rule, email)

    # ───── صف ارسال ─────
    def process_queue(self, s):
        gw = self.gateway(s["phone"])
        if not gw.configured:
            return
        snd = s["sending"]
        row = self.db.one("SELECT * FROM messages WHERE status = 'queued' AND send_after <= ? "
                          "ORDER BY CASE WHEN type = 'broadcast' THEN 1 ELSE 0 END, id LIMIT 1", (util.now_ms(),))
        if not row:
            return
        if not util.in_window(snd.get("from"), snd.get("to")):
            return
        if self.db.sent_today() >= int(snd.get("dailyLimit") or 50):
            return
        if time.time() - self.last_send < int(snd.get("gapSec") or 20):
            return
        self.last_send = time.time()
        self._send_row(gw, row)

    def _send_row(self, gw, row):
        self.db.update_message(row["id"], status="sending", sent_at=util.now_ms(), error=None)
        try:
            gid = gw.send(row["phone"], row["text"], int(row["line"] or 1))
            self.db.update_message(row["id"], gateway_id=gid)
        except GatewayError as e:
            self.db.update_message(row["id"], status="failed", error=str(e))
            log.warning("send failed #%s: %s", row["id"], e)

    def send_now(self, phone, text, line, email="", kind="single"):
        """پیامک دستی (تکی یا آزمایشی): همون لحظه، بدون منتظر موندن برای ساعت مجاز."""
        mid = self.db.enqueue(phone, text, kind, line, email, status="sending")
        row = self.db.one("SELECT * FROM messages WHERE id = ?", (mid,))
        self._send_row(self.gateway(), row)
        row = self.db.one("SELECT status, error FROM messages WHERE id = ?", (mid,))
        if row["status"] == "failed":
            raise GatewayError(row["error"])
        return mid

    def poll_states(self, s):
        gw = self.gateway(s["phone"])
        if not gw.configured:
            return
        rows = self.db.q("SELECT id, gateway_id FROM messages WHERE status = 'sending' AND gateway_id IS NOT NULL "
                         "AND sent_at > ? ORDER BY id LIMIT 30", (util.now_ms() - 3 * util.DAY_MS,))
        for r in rows:
            try:
                state, err, _ = gw.state(r["gateway_id"])
            except GatewayError:
                return
            if state != "sending":
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
            return
        if not devs:
            self.phone_status.update(ok=False, error="هیچ گوشی‌ای به این حساب وصل نیست.", device="", lastSeenAgo=None)
            return
        d = min(devs, key=lambda x: x["lastSeenAgo"] if x["lastSeenAgo"] is not None else 10 ** 9)
        ago = d["lastSeenAgo"]
        self.phone_status.update(ok=ago is not None and ago <= 60, device=d["name"], lastSeenAgo=ago, checkedAt=time.time(),
                                 error="" if ago is not None and ago <= 60 else "گوشی مدتیه به اینترنت وصل نشده.")

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
        }
