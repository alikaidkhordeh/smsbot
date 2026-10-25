"""اتصال به پنل 3X-UI (نسخهٔ ۳ به بعد، API کلاینت‌ها زیر /panel/api/clients).

دو روش ورود:
- توکن API (پیشنهادی): هدر Authorization: Bearer؛ نه کوکی می‌خواد نه CSRF، پس «وارد نشدن» پیش نمیاد.
- نام کاربری و رمز: لاگین + توکن CSRF؛ اگه نشست منقضی شد، خودکار دوباره لاگین می‌کنه.
"""
import http.client
import http.cookiejar
import json
import secrets
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request

from . import util


class PanelError(Exception):
    pass


class Panel:
    def __init__(self, cfg):
        self.base = (cfg.get("url") or "").strip().rstrip("/")
        self.token = (cfg.get("token") or "").strip() if cfg.get("auth") == "token" else ""
        self.username = cfg.get("username") or ""
        self.password = cfg.get("password") or ""
        # آدرس عمومی سرور: پنل لینک‌ها رو با هدر Host می‌سازه و اگه دامنه داشته باشه، Host دیگه رو رد می‌کنه (۴۰۳)
        self.host = (cfg.get("linkHost") or "").strip()
        self.timeout = 25
        self.csrf = ""
        self.lock = threading.Lock()
        self._sub = None
        ctx = ssl.create_default_context()
        # پنل معمولاً با آدرس داخلی (127.0.0.1) صدا زده می‌شه و گواهی SSL به اسم دامنه‌ست
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
            urllib.request.HTTPSHandler(context=ctx))

    # ───── درخواست پایه ─────
    def _raw(self, method, path, body=None, extra_headers=None):
        if not self.base.startswith(("http://", "https://")):
            raise PanelError("آدرس پنل باید با http:// یا https:// شروع بشه.")
        headers = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest", "User-Agent": util.USER_AGENT}
        if self.host:
            headers["Host"] = self.host
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        elif self.csrf and method != "GET":
            headers["X-CSRF-Token"] = self.csrf
        headers.update(extra_headers or {})
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                raise _AuthExpired(e.code)
            raise PanelError("پنل خطای %s برگردوند." % e.code)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            # HTTPException: مثلاً http ساده به پورتی که فقط https جواب می‌ده
            raise PanelError("به پنل وصل نشد (%s). آدرس و پورت رو چک کن." % getattr(e, "reason", e))
        try:
            return json.loads(raw.decode() or "{}")
        except ValueError:
            raise PanelError("جواب پنل قابل خوندن نبود؛ شاید آدرس (مسیر پنل) اشتباهه.")

    def _fetch_csrf(self):
        try:
            self.csrf = (self._raw("GET", "/csrf-token") or {}).get("obj") or ""
        except _AuthExpired:
            raise PanelError("صفحهٔ ورود پنل پیدا نشد؛ آدرس پنل (همراه مسیرش، مثل /abc123/) رو چک کن.")

    def login(self, two_factor=""):
        # پنل نسخهٔ ۳ برای خود /login هم توکن CSRF می‌خواد؛ بعد از ورود نشست عوض می‌شه، پس دوباره می‌گیریم
        self._fetch_csrf()
        body = {"username": self.username, "password": self.password}
        if two_factor:
            body["twoFactorCode"] = two_factor
        try:
            r = self._raw("POST", "/login", body)
        except _AuthExpired:
            raise PanelError("پنل ورود رو رد کرد؛ آدرس پنل رو چک کن.")
        if not r.get("success"):
            raise PanelError("ورود به پنل ناموفق بود: " + (r.get("msg") or "نام کاربری یا رمز اشتباهه"))
        self._fetch_csrf()

    def call(self, method, path, body=None):
        """درخواست به API پنل؛ در حالت رمز، اگه نشست تموم شده بود یک بار دوباره وارد می‌شه."""
        with self.lock:
            for attempt in (1, 2):
                try:
                    if not self.token and not self.csrf and attempt == 1:
                        self.login()
                    r = self._raw(method, path, body)
                    break
                except _AuthExpired as e:
                    if self.token and e.code == 403:
                        raise PanelError("پنل درخواست رو رد کرد (۴۰۳). اگه تو پنل دامنه تنظیم شده، «آدرس عمومی سرور» رو همون دامنه بذار.")
                    if self.token:
                        raise PanelError("پنل توکن رو قبول نکرد (کد %s)؛ توکن رو از پنل دوباره بساز." % e.code)
                    if attempt == 2:
                        raise PanelError("ورود به پنل انجام نشد؛ نام کاربری و رمز رو چک کن.")
                    self.csrf = ""
                    self.login()
        if isinstance(r, dict) and r.get("success") is False:
            raise PanelError(r.get("msg") or "پنل درخواست رو انجام نداد.")
        return r.get("obj") if isinstance(r, dict) else r

    # ───── اطلاعات ─────
    def status(self):
        s = self.call("GET", "/panel/api/server/status") or {}
        return {"version": s.get("panelVersion") or s.get("appVersion") or ""}

    @property
    def configured(self):
        return bool(self.base and (self.token or (self.username and self.password)))

    def detect_host(self):
        """آدرس عمومی سرور برای لینک‌ها. پنل روی سرور دیگه: همون آدرسی که باهاش وصل می‌شیم (مثل خود پنل
        که لینک رو با آدرس مرورگر می‌سازه). پنل روی همین سرور (127.0.0.1): دامنهٔ پنل یا آی‌پی عمومی سرور."""
        url_host = urllib.parse.urlparse(self.base).hostname or ""
        if url_host and url_host != "localhost" and not url_host.startswith("127.") and url_host != "::1":
            return url_host
        try:
            s = self.settings()
            if s.get("webDomain") or s.get("subDomain"):
                return s.get("webDomain") or s.get("subDomain")
            ip = (self.call("GET", "/panel/api/server/status") or {}).get("publicIP") or {}
            ip = ip.get("ipv4") if isinstance(ip, dict) else ip
            return ip if ip and ip != "N/A" else ""
        except PanelError:
            return ""

    def inbounds(self):
        rows = self.call("GET", "/panel/api/inbounds/options") or []
        return [{"id": r.get("id"), "remark": r.get("remark") or r.get("tag") or "", "protocol": r.get("protocol") or "",
                 "port": r.get("port") or 0} for r in rows]

    def clients(self):
        return self.call("GET", "/panel/api/clients/list") or []

    def get_client(self, email):
        return self.call("GET", "/panel/api/clients/get/" + _q(email)) or {}

    def links(self, email):
        return self.call("GET", "/panel/api/clients/links/" + _q(email)) or []

    def settings(self):
        return self.call("POST", "/panel/api/setting/all") or {}

    def sub_link(self, sub_id):
        """لینک ساب از روی تنظیمات ساب پنل؛ اگه ساب خاموش باشه ''."""
        if not sub_id:
            return ""
        if self._sub is None:
            try:
                self._sub = self.settings()
            except PanelError:
                return ""
        s = self._sub
        if not s.get("subEnable"):
            return ""
        if s.get("subURI"):
            return s["subURI"].rstrip("/") + "/" + sub_id
        host = s.get("subDomain") or s.get("webDomain") or self.host or urllib.parse.urlparse(self.base).hostname or ""
        scheme = "https" if s.get("subCertFile") else "http"
        path = "/" + (s.get("subPath") or "/sub/").strip("/") + "/"
        return "%s://%s:%s%s%s" % (scheme, host, s.get("subPort") or 2096, path, sub_id)

    # ───── ساخت و ویرایش کلاینت ─────
    def add_client(self, email, inbound_id, total_bytes, expiry_ms, limit_ip, comment=""):
        client = {"email": email, "totalGB": int(total_bytes), "expiryTime": int(expiry_ms), "limitIp": int(limit_ip),
                  "enable": True, "tgId": 0, "comment": comment, "subId": secrets.token_hex(8)}
        self.call("POST", "/panel/api/clients/add", {"client": client, "inboundIds": [int(inbound_id)]})

    def update_client(self, current_email, **changes):
        """update در پنل کل ردیف رو جایگزین می‌کنه، پس اول ردیف کامل رو می‌گیریم و فقط تغییرات رو روش می‌ذاریم.
        changes می‌تونه email جدید (تغییر اسم) هم داشته باشه."""
        email = current_email
        rec = (self.get_client(email) or {}).get("client") or {}
        if not rec:
            raise PanelError("این کانفیگ تو پنل پیدا نشد.")
        payload = {
            "id": rec.get("uuid") or "", "password": rec.get("password") or "", "auth": rec.get("auth") or "",
            "flow": rec.get("flow") or "", "security": rec.get("security") or "", "email": rec.get("email"),
            "limitIp": rec.get("limitIp", 0), "totalGB": rec.get("totalGB", 0), "expiryTime": rec.get("expiryTime", 0),
            "enable": rec.get("enable", True), "tgId": rec.get("tgId", 0), "subId": rec.get("subId") or "",
            "group": rec.get("group") or "", "comment": rec.get("comment") or "", "reset": rec.get("reset", 0),
        }
        for key in ("secret", "adTag", "privateKey", "publicKey", "preSharedKey"):
            if rec.get(key):
                payload[key] = rec[key]
        payload = {k: v for k, v in payload.items() if v != "" or k in ("email", "comment", "subId")}
        payload.update(changes)
        self.call("POST", "/panel/api/clients/update/" + _q(email), payload)

    def delete_client(self, email):
        self.call("POST", "/panel/api/clients/del/" + _q(email))

    def reset_traffic(self, email):
        self.call("POST", "/panel/api/clients/resetTraffic/" + _q(email))

    def create_token(self, base_name="smsbot"):
        names = {t.get("name") for t in (self.call("GET", "/panel/api/setting/apiTokens") or [])}
        name = base_name if base_name not in names else "%s-%s" % (base_name, secrets.token_hex(2))
        obj = self.call("POST", "/panel/api/setting/apiTokens/create", {"name": name}) or {}
        token = obj.get("token") or obj.get("value") or ""
        if not token:
            raise PanelError("پنل توکن نساخت؛ از تنظیمات پنل دستی بسازش.")
        return token


# ───── پیدا کردن خودکار آدرس درست پنل ─────
# کاربر هر آدرسی از پنل رو ممکنه کپی کنه: صفحهٔ داشبورد (…/مسیر/panel/)، یه صفحهٔ دیگه (…/panel/inbounds)،
# بدون http/https، یا حتی بدون پورت. API پنل از «مسیر پایه» شروع می‌شه؛ همهٔ حالت‌ها امتحان می‌شن.
COMMON_PORTS = (2053, 2087, 2083, 2096, 8443, 54321, 443)
PROBE_TIMEOUT = 6


def candidate_bases(url, guess_ports=False):
    """آدرس‌های احتمالی پنل به ترتیب احتمال (هر کدوم با / تموم می‌شه)."""
    url = (url or "").strip().split("#")[0]
    if not url:
        return []
    schemes = None
    if "://" not in url:
        schemes = ["https", "http"]  # کاربر http/https رو ننوشته
        url = "https://" + url
    p = urllib.parse.urlsplit(url)
    schemes = schemes or [p.scheme]
    segs = [s for s in p.path.split("/") if s]
    paths = []
    if "panel" in segs:  # رایج‌ترین حالت: آدرس صفحهٔ داشبورد
        paths.append(segs[:segs.index("panel")])
    paths += [segs[:n] for n in range(len(segs), -1, -1)]  # بلندترین تا ریشه
    netlocs = [p.netloc]
    if guess_ports and p.port is None:
        netlocs = ["%s:%d" % (p.hostname, port) for port in COMMON_PORTS]
    out = []
    for netloc in netlocs:
        for scheme in schemes:
            for segs_ in paths:
                u = "%s://%s/%s" % (scheme, netloc, "/".join(segs_) + "/" if segs_ else "")
                if u not in out:
                    out.append(u)
    return out


def _probe(base, host=""):
    """'ok' پنل نسخهٔ ۳، 'old' پنل قدیمی، 'forbidden' پنل جواب داد ولی رد کرد (۴۰۳)، None پنلی نیست."""
    p = Panel({"url": base, "linkHost": host})
    p.timeout = PROBE_TIMEOUT
    try:
        r = p._raw("GET", "/csrf-token")
        if isinstance(r, dict) and r.get("success"):
            return "ok"
    except _AuthExpired as e:
        if e.code == 403:
            return "forbidden"
    except PanelError:
        pass
    try:  # پنل‌های قدیمی‌تر (نسخهٔ ۲) این آدرس رو ندارن؛ صفحهٔ ورودشون رو نگاه می‌کنیم
        req = urllib.request.Request(base, headers={"User-Agent": util.USER_AGENT, **({"Host": host} if host else {})})
        with p.opener.open(req, timeout=PROBE_TIMEOUT) as resp:
            html = resp.read(20000).decode("utf-8", "replace").lower()
        if "x-ui" in html or "3x-ui" in html:
            return "old"
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException):
        pass
    return None


def find_panel(url, host=""):
    """(آدرس پایهٔ درست، وضعیت). همهٔ حالت‌ها همزمان امتحان می‌شن و اولینِ به ترتیب احتمال برمی‌گرده."""
    from concurrent.futures import ThreadPoolExecutor

    url = (url or "").strip()
    try:
        gave_port = urllib.parse.urlsplit(url if "://" in url else "https://" + url).port is not None
    except ValueError:
        gave_port = True
    best_bad = (None, None)
    for guess in ((False,) if gave_port else (False, True)):  # اگه پورت نداده، دور دوم پورت‌های رایج پنل
        cands = candidate_bases(url, guess_ports=guess)
        if not cands:
            break
        with ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(lambda c: _probe(c, host), cands))
        for c, r in zip(cands, results):
            if r == "ok":
                return c, "ok"
        best_bad = next(((c, r) for c, r in zip(cands, results) if r in ("old", "forbidden")), best_bad)
        if best_bad[0]:
            break
    return best_bad


def resolve_url(url, link_host="", strict=False):
    """آدرس درست پنل. strict: اگه پیدا نشد، با پیام روشن خطا بده؛ وگرنه همون آدرس ورودی (تمیزشده) برمی‌گرده."""
    if not (url or "").strip():
        if strict:
            raise PanelError("اول آدرس پنل رو بنویس.")
        return ""
    base, state = find_panel(url)
    if state == "forbidden" and link_host:
        base2, state2 = find_panel(url, link_host)  # پنل دامنه داره و آی‌پی رو رد می‌کنه
        if state2 == "ok":
            return base2
    if state == "ok":
        return base
    if strict:
        if state == "old":
            raise PanelError("پنل پیدا شد ولی نسخه‌ش قدیمیه؛ این برنامه با 3X-UI نسخهٔ ۳ به بعد کار می‌کنه.")
        if state == "forbidden":
            raise PanelError("پنل پیدا شد ولی درخواست رو رد کرد (۴۰۳). اگه تو پنل دامنه تنظیم کردی، آدرس رو با همون دامنه بده نه آی‌پی.")
        raise PanelError("پنل با این آدرس پیدا نشد. آدرسی که پنل رو تو مرورگر باهاش باز می‌کنی رو کامل کپی کن (با پورت).")
    cands = candidate_bases(url)
    return cands[0] if cands else ""


class _AuthExpired(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _q(s):
    return urllib.parse.quote(str(s), safe="")


def normalize(c, now=None):
    """کلاینت پنل → شکلی که صفحهٔ کانفیگ‌ها نشون می‌ده."""
    t = c.get("traffic") or {}
    used = (t.get("up") or 0) + (t.get("down") or 0)
    total = c.get("totalGB") or 0
    exp = c.get("expiryTime") or 0
    return {
        "id": c.get("id"), "email": c.get("email") or "", "account": c.get("email") or "",
        "subId": c.get("subId") or "", "comment": c.get("comment") or "",
        "totalGB": total / util.GB, "usedGB": used / util.GB,
        "daysLeft": util.days_left(exp, now), "delayedDays": round(-exp / util.DAY_MS) if exp < 0 else None,
        "enabled": bool(c.get("enable", True)), "limitIp": c.get("limitIp") or 0,
        "inboundIds": c.get("inboundIds") or [], "inboundId": (c.get("inboundIds") or [0])[0],
    }
