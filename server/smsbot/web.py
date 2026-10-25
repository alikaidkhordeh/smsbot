"""سرور وب برنامه: نمایش صفحه‌ها، API برای صفحه‌ها، ورود با رمز."""
import collections
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import secrets
import socket
import ssl
import subprocess
import threading
import time
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import util
from .gateway import GatewayError
from .panel import Panel, PanelError, normalize, resolve_url

log = logging.getLogger("smsbot")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB_DIR = os.path.join(ROOT, "web")
COOKIE = "smsbot_sid"
SESSION_IDLE_MS = 30 * util.DAY_MS
MAX_BODY = 4 * 1024 * 1024
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class MemoryLog(logging.Handler):
    """۳۰۰ خط آخر گزارش برنامه تو حافظه، برای صفحهٔ «گزارش برنامه» (که برای پیدا کردن مشکل ترمینال لازم نباشه)."""

    def __init__(self, size=300):
        super().__init__()
        self.lines = collections.deque(maxlen=size)
        fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%m-%d %H:%M:%S")
        fmt.converter = lambda ts: datetime.fromtimestamp(ts, util.TEHRAN).timetuple()  # ساعت تهران
        self.setFormatter(fmt)

    def emit(self, record):
        try:
            self.lines.append(self.format(record))
        except Exception:  # گزارش نباید برنامه رو بخوابونه
            pass


MEMORY_LOG = MemoryLog()


class ApiError(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def set_password(db, password):
    salt = secrets.token_hex(16)
    db.save_section("auth", {"salt": salt, "hash": hash_password(password, salt)})


def check_password(db, password):
    a = db.settings()["auth"]
    return bool(a.get("hash")) and hmac.compare_digest(hash_password(password, a["salt"]), a["hash"])


def schedule_restart(delay=1.5):
    """برنامه خودش بسته می‌شه و سرویس systemd دوباره بالاش میاره (برای تغییر پورت/گواهی یا آپدیت)."""
    threading.Timer(delay, lambda: os._exit(3)).start()


def version():
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "dev"


class Handler(BaseHTTPRequestHandler):
    server_version = "smsbot"
    app = None  # در main مقدار می‌گیره
    failed_logins = {}

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    # ───── پاسخ‌ها ─────
    def _headers(self, status, ctype, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _json(self, status, obj, extra=None):
        body = util.dumps(obj).encode()
        self._headers(status, "application/json; charset=utf-8", len(body), {"Cache-Control": "no-store", **(extra or {})})
        self.wfile.write(body)

    def _static(self, path):
        rel = "index.html" if path in ("", "/") else urllib.parse.unquote(path.lstrip("/"))
        full = os.path.realpath(os.path.join(WEB_DIR, rel))
        if not full.startswith(os.path.realpath(WEB_DIR) + os.sep) or not os.path.isfile(full):
            full = os.path.join(WEB_DIR, "index.html") if "." not in rel.rsplit("/", 1)[-1] else None
        if not full:
            return self._json(404, {"ok": False, "error": "پیدا نشد"})
        with open(full, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json")):
            ctype += "; charset=utf-8"
        # صفحه و سرویس‌ورکر همیشه تازه؛ بقیه ۵ دقیقه (کلادفلر هم همین رو رعایت می‌کنه)
        cache = "no-cache" if full.endswith((".html", "sw.js", ".webmanifest")) else "public, max-age=300"
        self._headers(200, ctype, len(data), {
            "Cache-Control": cache,
            "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                                       "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        })
        self.wfile.write(data)

    # ───── نشست ─────
    def _session(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE and v:
                return v
        return ""

    def _authed(self):
        tok = self._session()
        return bool(tok) and self.app.db.touch_session(tok, SESSION_IDLE_MS)

    def _cookie(self, value, max_age):
        # https مستقیم، یا پشت کلادفلر (کلادفلر https رو می‌ده و X-Forwarded-Proto اینو می‌گه)
        https = isinstance(self.connection, ssl.SSLSocket) or self.headers.get("X-Forwarded-Proto") == "https"
        secure = "; Secure" if https else ""
        return "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d%s" % (COOKIE, value, max_age, secure)

    def _client_ip(self):
        """آی‌پی واقعی بازدیدکننده (پشت کلادفلر همهٔ درخواست‌ها از آی‌پی کلادفلر میان)."""
        fwd = self.headers.get("CF-Connecting-IP") or (self.headers.get("X-Forwarded-For") or "").split(",")[0]
        return fwd.strip() or self.client_address[0]

    # ───── مسیریابی ─────
    def _dispatch(self, method):
        url = urllib.parse.urlparse(self.path)
        if not url.path.startswith("/api/"):
            if method != "GET":
                return self._json(405, {"ok": False, "error": "روش نامعتبر"})
            return self._static(url.path)
        route = self.app.routes.get((method, url.path))
        if not route:
            return self._json(404, {"ok": False, "error": "مسیر API پیدا نشد"})
        fn, public = route
        if method == "POST" and self.headers.get("X-Requested-With") != "XMLHttpRequest":
            return self._json(403, {"ok": False, "error": "درخواست نامعتبر"})
        if not public and not self._authed():
            return self._json(401, {"ok": False, "error": "اول وارد شو"})
        body = {}
        if method == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                return self._json(413, {"ok": False, "error": "حجم درخواست زیاده"})
            try:
                body = json.loads(self.rfile.read(n).decode() or "{}") if n else {}
            except ValueError:
                return self._json(400, {"ok": False, "error": "درخواست نامعتبر"})
        query = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            result = fn(self, body, query)
            if isinstance(result, tuple):  # (داده، هدرهای اضافه)
                return self._json(200, {"ok": True, "data": result[0]}, result[1])
            return self._json(200, {"ok": True, "data": result})
        except ApiError as e:
            return self._json(e.status, {"ok": False, "error": str(e)})
        except (PanelError, GatewayError) as e:
            # نه ۵۰۲: کلادفلر جواب ۵۰۲/۵۰۴ رو با صفحهٔ خطای خودش عوض می‌کنه و پیام اصلی گم می‌شه
            log.warning("%s %s: %s", method, url.path, e)
            return self._json(422, {"ok": False, "error": str(e)})
        except Exception:
            log.exception("api %s %s", method, url.path)
            return self._json(500, {"ok": False, "error": "خطای داخلی برنامه؛ لاگ سرور رو ببین."})


class DualServer(ThreadingHTTPServer):
    """یک پورت، هم http هم https: بایت اول اتصال رو نگاه می‌کنه؛ اگه شروع TLS بود (0x16) رمزنگاری می‌کنه.
    این‌طوری پشت کلادفلر با هر حالت SSL (Flexible که http می‌فرسته یا Full که https) کار می‌کنه."""
    daemon_threads = True
    ssl_ctx = None

    def finish_request(self, request, client_address):
        conn = request
        if self.ssl_ctx:
            try:
                request.settimeout(15)
                first = request.recv(1, socket.MSG_PEEK)
                if first == b"\x16":
                    conn = self.ssl_ctx.wrap_socket(request, server_side=True)
                conn.settimeout(None)
            except (OSError, ssl.SSLError):
                return
        try:
            self.RequestHandlerClass(conn, client_address, self)
        finally:
            if conn is not request:
                try:
                    conn.close()
                except OSError:
                    pass


def serve(app, host, port, cert="", key=""):
    Handler.app = app
    httpd = DualServer((host, port), Handler)
    if cert and key and os.path.isfile(cert) and os.path.isfile(key):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpd.ssl_ctx = ctx
    log.info("listening on %s:%s (http%s)", host, port, " + https" if httpd.ssl_ctx else "")
    httpd.serve_forever()

SECRET_FIELDS = {"panel": ("token", "password"), "phone": ("password",)}
STATUS_VIEW = {"queued": "queued", "sending": "queued", "sent": "sent", "delivered": "sent",
               "failed": "failed", "cancelled": "failed"}


def _int(v, default=0, lo=None, hi=None):
    try:
        n = int(float(util.to_en(v)))
    except (TypeError, ValueError):
        return default
    if lo is not None and n < lo:
        return lo
    if hi is not None and n > hi:
        return hi
    return n


def clean_account(v):
    """اسم کانفیگ تو پنل: فاصله مجاز نیست (به - تبدیل می‌شه)، / و \\ هم مجاز نیستن."""
    name = "-".join(str(v or "").split())
    if "/" in name or "\\" in name:
        raise ApiError("تو اسم کانفیگ / و \\ مجاز نیست.")
    return name


def _float(v, default=0.0):
    try:
        return max(0.0, float(util.to_en(v)))
    except (TypeError, ValueError):
        return default


class App:
    def __init__(self, db, engine):
        self.db, self.engine, self.https = db, engine, False
        r = {}

        def route(method, path, public=False):
            def deco(fn):
                r[(method, path)] = (fn, public)
                return fn
            return deco

        self.routes = r
        e, d = engine, db

        # ───── ورود ─────
        @route("GET", "/api/me", public=True)
        def me(h, b, q):
            return {"loggedIn": h._authed(), "hasPassword": bool(d.settings()["auth"].get("hash")), "version": version()}

        @route("POST", "/api/login", public=True)
        def login(h, b, q):
            ip = h._client_ip()
            fails, until = Handler.failed_logins.get(ip, (0, 0))
            if until > time.time():
                raise ApiError("چند بار رمز اشتباه زدی؛ %d دقیقه دیگه دوباره امتحان کن." % (int(until - time.time()) // 60 + 1), 429)
            if not check_password(d, str(b.get("password") or "")):
                fails += 1
                Handler.failed_logins[ip] = (fails, time.time() + 300 if fails >= 5 else 0)
                raise ApiError("رمز اشتباهه.", 401)
            Handler.failed_logins.pop(ip, None)
            tok = secrets.token_urlsafe(32)
            d.add_session(tok)
            return True, {"Set-Cookie": h._cookie(tok, SESSION_IDLE_MS // 1000)}

        @route("POST", "/api/logout")
        def logout(h, b, q):
            d.drop_session(h._session())
            return True, {"Set-Cookie": h._cookie("", 0)}

        @route("POST", "/api/password")
        def change_password(h, b, q):
            if not check_password(d, str(b.get("old") or "")):
                raise ApiError("رمز فعلی اشتباهه.")
            new = str(b.get("new") or "")
            if len(new) < 6:
                raise ApiError("رمز جدید حداقل ۶ حرف باشه.")
            set_password(d, new)
            return True

        # ───── وضعیت ─────
        @route("GET", "/api/status")
        def status(h, b, q):
            return e.status_view()

        # ───── کانفیگ‌ها ─────
        def panel_call(fn, *args, **kw):
            if not e.panel().configured:
                raise ApiError("پنل هنوز وصل نشده؛ از تنظیمات ← «اتصال به پنل» آدرس و نام کاربری و رمز پنل رو وارد کن.", 409)
            try:
                out = fn(*args, **kw)
                e.mark_panel(True)
                return out
            except PanelError as err:
                e.mark_panel(False, str(err))
                raise

        def merged_clients():
            raw = panel_call(e.panel().clients)
            contacts, states = d.contacts(), d.alert_states()
            out = []
            for c in map(normalize, raw):
                ct = contacts.get(c["email"]) or {}
                c["name"] = ct.get("name", "")
                c["phone"] = ct.get("phone") or util.clean_phone(c["comment"])
                st = states.get(c["email"], set()) - {"ended"}
                c["alerted"] = sorted(st)[0] if st else None
                out.append(c)
            return out

        def find_client(email):
            for c in merged_clients():
                if c["email"] == email:
                    return c
            raise ApiError("این کانفیگ تو پنل پیدا نشد.", 404)

        @route("GET", "/api/inbounds")
        def inbounds(h, b, q):
            return panel_call(e.panel().inbounds)

        @route("GET", "/api/clients")
        def clients(h, b, q):
            return merged_clients()

        @route("POST", "/api/clients/add")
        def client_add(h, b, q):
            account = clean_account(b.get("account"))
            if not account:
                raise ApiError("اسم کانفیگ رو بنویس.")
            phone = util.clean_phone(b.get("phone")) if b.get("phone") else ""
            if b.get("phone") and not phone:
                raise ApiError("شماره باید ۱۱ رقم باشه و با ۰۹ شروع بشه.")
            name = str(b.get("name") or "").strip()
            days = _int(b.get("daysLeft"), 0, 0)
            panel_call(e.panel().add_client, account, _int(b.get("inboundId"), 0),
                       round(_float(b.get("totalGB")) * util.GB), util.now_ms() + days * util.DAY_MS if days else 0,
                       _int(b.get("limitIp"), 0, 0), " ".join(x for x in (name, phone) if x))
            if name or phone:
                d.save_contact(account, name, phone)
            return find_client(account)

        @route("POST", "/api/clients/update")
        def client_update(h, b, q):
            email = str(b.get("email") or "")
            account = clean_account(b.get("account") or email)
            phone = util.clean_phone(b.get("phone")) if b.get("phone") else ""
            if b.get("phone") and not phone:
                raise ApiError("شماره باید ۱۱ رقم باشه و با ۰۹ شروع بشه.")
            changes = {}
            if account and account != email:
                changes["email"] = account
            if "limitIp" in b:
                changes["limitIp"] = _int(b.get("limitIp"), 0, 0)
            if "enabled" in b:
                changes["enable"] = bool(b.get("enabled"))
            if changes:
                panel_call(e.panel().update_client, email, **changes)
            if account != email:
                d.rename_contact(email, account)
            d.save_contact(account, str(b.get("name") or "").strip(), phone)
            return True

        @route("POST", "/api/clients/renew")
        def client_renew(h, b, q):
            email = str(b.get("email") or "")
            days = _int(b.get("days"), 0, 0)
            panel_call(e.panel().update_client, email, totalGB=round(_float(b.get("totalGB")) * util.GB),
                       expiryTime=util.now_ms() + days * util.DAY_MS if days else 0, enable=True)
            if b.get("reset"):
                panel_call(e.panel().reset_traffic, email)
            d.clear_alert(email)
            return True

        @route("POST", "/api/clients/reset")
        def client_reset(h, b, q):
            email = str(b.get("email") or "")
            panel_call(e.panel().reset_traffic, email)
            d.clear_alert(email, "volume")
            return True

        @route("POST", "/api/clients/delete")
        def client_delete(h, b, q):
            email = str(b.get("email") or "")
            panel_call(e.panel().delete_client, email)
            d.delete_contact(email)
            return True

        @route("GET", "/api/clients/links")
        def client_links(h, b, q):
            email = q.get("email") or ""
            p = e.panel()
            links = panel_call(p.links, email)
            rec = (panel_call(p.get_client, email) or {}).get("client") or {}
            return {"config": links, "sub": p.sub_link(rec.get("subId") or "")}

        # ───── هشدارها و متن‌ها ─────
        @route("GET", "/api/rules")
        def rules_get(h, b, q):
            return d.settings()["rules"]

        @route("POST", "/api/rules")
        def rules_save(h, b, q):
            cur = d.settings()["rules"]
            cur["enabled"] = bool(b.get("enabled"))
            cur["intervalMin"] = _int(b.get("intervalMin"), 10, 1, 1440)
            for k in ("volume", "expiry", "ended"):
                src = b.get(k) or {}
                cur[k].update(on=bool(src.get("on")), templateId=_int(src.get("templateId"), cur[k]["templateId"]),
                              line=_int(src.get("line"), 1, 1, 3))
            cur["volume"].update(amount=_float(b.get("volume", {}).get("amount"), 1) or 1,
                                 unit="MB" if b.get("volume", {}).get("unit") == "MB" else "GB")
            cur["expiry"]["days"] = _int(b.get("expiry", {}).get("days"), 2, 1, 365)
            d.save_section("rules", cur)
            e.check_soon()
            return True

        @route("GET", "/api/templates")
        def templates(h, b, q):
            return d.q("SELECT id, title, text FROM templates ORDER BY id")

        @route("POST", "/api/templates/save")
        def template_save(h, b, q):
            title, text = str(b.get("title") or "").strip(), str(b.get("text") or "").strip()
            if not title or not text:
                raise ApiError("اسم و متن رو کامل کن.")
            if b.get("id"):
                d.run("UPDATE templates SET title = ?, text = ? WHERE id = ?", (title, text, _int(b["id"])))
            else:
                d.run("INSERT INTO templates (title, text) VALUES (?, ?)", (title, text))
            return True

        @route("POST", "/api/templates/delete")
        def template_delete(h, b, q):
            tid = _int(b.get("id"))
            rules = d.settings()["rules"]
            if any(rules[k]["templateId"] == tid for k in ("volume", "expiry", "ended")):
                raise ApiError("این متن تو هشدارها استفاده شده؛ اول اونجا عوضش کن.")
            d.run("DELETE FROM templates WHERE id = ?", (tid,))
            return True

        # ───── ارسال ─────
        def vars_for(c):
            left = c["totalGB"] - c["usedGB"] if c["totalGB"] > 0 else None
            return dict(name=c["name"], account=c["account"], left_gb=max(0, left) if left is not None else None, days=c["daysLeft"])

        @route("POST", "/api/send")
        def send_one(h, b, q):
            c = find_client(str(b.get("email") or ""))
            if not c["phone"]:
                raise ApiError("این کانفیگ شماره نداره.")
            text = util.fill_vars(str(b.get("text") or ""), **vars_for(c))
            if not text:
                raise ApiError("متن پیامک خالیه.")
            e.send_now(c["phone"], text, _int(b.get("line"), 1, 1, 3), c["email"], "single")
            return True

        @route("POST", "/api/test/phone")
        def test_phone(h, b, q):
            phone = util.clean_phone(b.get("phone"))
            if not phone:
                raise ApiError("شمارهٔ درست وارد کن.")
            s = d.settings()["phone"]
            e.send_now(phone, "پیامک آزمایشی پنل پیامک؛ اتصال گوشی درسته.", _int(b.get("line"), s.get("defaultLine", 1), 1, 3), "", "test")
            e.last_device = 0
            e.wake.set()
            return True

        @route("GET", "/api/history")
        def history(h, b, q):
            rows = d.q("SELECT m.*, b.title AS btitle FROM messages m LEFT JOIN broadcasts b ON b.id = m.broadcast_id "
                       "ORDER BY m.id DESC LIMIT ?", (_int(q.get("limit"), 300, 1, 2000),))
            return [{"id": r["id"], "at": util.fmt_time(r["sent_at"] or r["created_at"]),
                     "account": r["email"] or ("آزمایشی" if r["type"] == "test" else ""), "phone": r["phone"],
                     "type": r["type"], "line": r["line"], "status": STATUS_VIEW.get(r["status"], "queued"),
                     "delivered": r["status"] == "delivered", "text": r["text"], "error": r["error"] or "",
                     "broadcast": r["btitle"] or ""} for r in rows]

        @route("POST", "/api/history/retry")
        def retry(h, b, q):
            d.run("UPDATE messages SET status = 'queued', error = NULL, send_after = 0 WHERE id = ? AND status IN ('failed', 'cancelled')",
                  (_int(b.get("id")),))
            e.wake.set()
            return True

        @route("GET", "/api/broadcasts")
        def broadcasts(h, b, q):
            out = []
            for bc in d.q("SELECT * FROM broadcasts ORDER BY id DESC LIMIT 30"):
                cnt = {r["status"]: r["n"] for r in d.q("SELECT status, COUNT(*) AS n FROM messages WHERE broadcast_id = ? GROUP BY status", (bc["id"],))}
                sent = cnt.get("sent", 0) + cnt.get("delivered", 0) + cnt.get("sending", 0)
                failed = cnt.get("failed", 0)
                queued = cnt.get("queued", 0)
                if bc["status"] == "cancelled":
                    state = "cancelled"
                elif queued == 0:
                    state = "done"
                elif bc["send_after"] > util.now_ms() and queued == bc["total"]:
                    state = "scheduled"
                else:
                    state = "sending"
                out.append({"id": bc["id"], "title": bc["title"], "at": util.fmt_time(bc["send_after"] or bc["created_at"]),
                            "total": bc["total"], "sent": sent, "failed": failed, "line": bc["line"], "status": state})
            return out

        @route("POST", "/api/broadcasts/send")
        def broadcast_send(h, b, q):
            text = str(b.get("text") or "").strip()
            emails = set(b.get("emails") or [])
            if not text or not emails:
                raise ApiError("متن و گیرنده‌ها لازمه.")
            line = _int(b.get("line"), 1, 1, 3)
            send_at = _int(b.get("sendAt"), 0, 0)
            targets = [c for c in merged_clients() if c["email"] in emails and c["phone"]]
            if not targets:
                raise ApiError("هیچ‌کدوم از گیرنده‌ها شماره ندارن.")
            bid = d.run("INSERT INTO broadcasts (title, text, line, total, created_at, send_after) VALUES (?, ?, ?, ?, ?, ?)",
                        (str(b.get("title") or text[:30]), text, line, len(targets), util.now_ms(), send_at))
            for c in targets:
                d.enqueue(c["phone"], util.fill_vars(text, **vars_for(c)), "broadcast", line, c["email"], send_at, bid)
            e.wake.set()
            return {"count": len(targets)}

        @route("POST", "/api/broadcasts/cancel")
        def broadcast_cancel(h, b, q):
            bid = _int(b.get("id"))
            d.run("UPDATE messages SET status = 'cancelled', error = 'لغو شد' WHERE broadcast_id = ? AND status = 'queued'", (bid,))
            d.run("UPDATE broadcasts SET status = 'cancelled' WHERE id = ?", (bid,))
            return True

        # ───── تنظیمات ─────
        @route("GET", "/api/settings")
        def settings_get(h, b, q):
            s = d.settings()
            out = {k: dict(s[k]) for k in ("panel", "phone", "sending", "app")}
            for sec, fields in SECRET_FIELDS.items():
                for f in fields:
                    out[sec]["has_" + f] = bool(out[sec].get(f))
                    out[sec][f] = ""
            out["version"] = version()
            return out

        def merged_section(sec, src):
            cur = dict(d.settings()[sec])
            for k, v in (src or {}).items():
                if k.startswith("has_") or k not in cur:
                    continue
                if k in SECRET_FIELDS.get(sec, ()) and not v:
                    continue  # خالی یعنی همون قبلی بمونه
                cur[k] = v
            return cur

        @route("POST", "/api/settings")
        def settings_save(h, b, q):
            old = d.settings()
            panel = merged_section("panel", b.get("panel"))
            phone = merged_section("phone", b.get("phone"))
            sending = merged_section("sending", b.get("sending"))
            app = merged_section("app", b.get("app"))
            sending["gapSec"] = _int(sending.get("gapSec"), 20, 1, 3600)
            sending["dailyLimit"] = _int(sending.get("dailyLimit"), 50, 1, 5000)
            app["port"] = _int(app.get("port"), 8090, 1, 65535)
            phone["defaultLine"] = _int(phone.get("defaultLine"), 1, 1, 3)
            for c in ("cert", "key"):
                if app.get(c) and not os.path.isfile(app[c]):
                    raise ApiError("فایل گواهی پیدا نشد: " + app[c])
            if panel.get("url") != old["panel"].get("url"):
                panel["url"] = resolve_url(panel["url"], panel.get("linkHost") or "")
                if panel.get("linkHost") == old["panel"].get("linkHost"):
                    panel["linkHost"] = ""  # آدرس پنل عوض شد → آدرس لینک‌ها دوباره خودکار پیدا بشه
            for k, v in (("panel", panel), ("phone", phone), ("sending", sending), ("app", app)):
                d.save_section(k, v)
            restart = any(old["app"].get(k) != app.get(k) for k in ("port", "cert", "key"))
            if restart:
                schedule_restart()
            e.last_device = 0
            e.check_soon()
            return {"restart": restart}

        def test_cfg(cfg):
            p = Panel(cfg)
            n = len(p.clients())
            try:
                ver = p.status().get("version", "")
            except PanelError:
                ver = ""
            return {"ok": True, "version": ver, "clients": n, "linkHost": cfg.get("linkHost") or p.detect_host()}

        def fill_link_host(r):
            """اگه آدرس عمومی سرور خالیه، همون که از پنل پیدا شد رو ذخیره کن."""
            cur = d.settings()["panel"]
            if not cur.get("linkHost") and r.get("linkHost"):
                d.save_section("panel", dict(cur, linkHost=r["linkHost"]))

        @route("POST", "/api/test/panel")
        def test_panel(h, b, q):
            src = b.get("panel")
            cfg = merged_section("panel", src) if src else d.settings()["panel"]
            cfg["url"] = resolve_url(cfg.get("url"), cfg.get("linkHost") or "")
            r = test_cfg(cfg)
            r["url"] = cfg["url"]
            if not src:
                e.mark_panel(True)
                fill_link_host(r)
            return r

        @route("POST", "/api/panel/connect")
        def panel_connect(h, b, q):
            url = resolve_url(str(b.get("url") or ""), d.settings()["panel"].get("linkHost") or "")
            p = Panel({"url": url, "auth": "login", "username": b.get("username") or "", "password": b.get("password") or ""})
            p.login(str(b.get("twoFactorCode") or "").strip())
            cfg = dict(d.settings()["panel"], url=url)
            try:
                cfg.update(auth="token", token=p.create_token(), username="", password="")
            except PanelError:
                if b.get("twoFactorCode"):
                    raise
                cfg.update(auth="login", token="", username=b.get("username") or "", password=b.get("password") or "")
            d.save_section("panel", cfg)
            r = test_cfg(cfg)
            fill_link_host(r)
            e.mark_panel(True)
            e.check_soon()
            r["auth"] = cfg["auth"]
            return r

        @route("GET", "/api/panel/certs")
        def panel_certs(h, b, q):
            s = panel_call(e.panel().settings)
            return {"cert": s.get("webCertFile") or "", "key": s.get("webKeyFile") or "", "domain": s.get("webDomain") or ""}

        @route("GET", "/api/logs")
        def logs(h, b, q):
            return list(MEMORY_LOG.lines)[-200:]

        # ───── پشتیبان و آپدیت ─────
        @route("GET", "/api/backup")
        def backup(h, b, q):
            s = d.settings()
            data = {"app": "smsbot", "version": version(), "exportedAt": util.now_ms(),
                    "contacts": list(d.contacts().values()),
                    "templates": d.q("SELECT id, title, text FROM templates ORDER BY id"),
                    "rules": s["rules"], "sending": s["sending"],
                    "lines": {"line1": s["phone"]["line1"], "line2": s["phone"]["line2"]}}
            return data

        @route("POST", "/api/restore")
        def restore(h, b, q):
            if b.get("app") != "smsbot":
                raise ApiError("این فایل پشتیبان این برنامه نیست.")
            for c in b.get("contacts") or []:
                if c.get("email"):
                    d.save_contact(c["email"], c.get("name") or "", util.clean_phone(c.get("phone")) if c.get("phone") else "")
            if b.get("templates"):
                with d.lock:
                    d.conn.execute("DELETE FROM templates")
                    d.conn.executemany("INSERT INTO templates (id, title, text) VALUES (?, ?, ?)",
                                       [(t["id"], t["title"], t["text"]) for t in b["templates"]])
                    d.conn.commit()
            if isinstance(b.get("rules"), dict):
                d.save_section("rules", b["rules"])
            if isinstance(b.get("sending"), dict):
                d.save_section("sending", b["sending"])
            return {"contacts": len(b.get("contacts") or [])}

        @route("POST", "/api/update")
        def update(h, b, q):
            if not os.path.isdir(os.path.join(ROOT, ".git")):
                raise ApiError("این نصب از گیت نیست؛ آپدیت خودکار ممکن نیست.")
            def git(*args):
                out = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True, timeout=120)
                if out.returncode != 0:
                    raise ApiError("آپدیت انجام نشد: " + (out.stderr or out.stdout).strip()[-300:])
                return out.stdout.strip()

            try:
                # مثل نصب‌کننده: آخرین نسخهٔ شاخه رو می‌گیره (نصب سبک و بدون تاریخچه)؛ پوشهٔ data دست نمی‌خوره
                branch = git("rev-parse", "--abbrev-ref", "HEAD")
                before = git("rev-parse", "HEAD")
                git("fetch", "-q", "--depth", "1", "origin", branch)
                after = git("rev-parse", "origin/" + branch)
                if after != before:
                    git("reset", "-q", "--hard", "origin/" + branch)
            except (OSError, subprocess.TimeoutExpired) as err:
                raise ApiError("آپدیت انجام نشد: %s" % err)
            updated = after != before
            if updated:
                schedule_restart()
            return {"updated": updated, "version": version()}
