"""اتصال به اپ SMS Gateway for Android روی گوشی علی (سرور ابری اپ یا سرور شخصی).

پیامک از سیم‌کارت خود گوشی فرستاده می‌شه. مستندات: https://docs.sms-gate.app
"""
import base64
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from . import util

CLOUD_URL = "https://api.sms-gate.app/3rdparty/v1"
# وضعیت‌های اپ → وضعیت‌های برنامه
STATE_MAP = {"Pending": "sending", "Processed": "sending", "Sent": "sent", "Delivered": "delivered",
             "Failed": "failed", "Cancelled": "failed", "Cancelling": "sending"}


class GatewayError(Exception):
    pass


class Gateway:
    def __init__(self, cfg):
        url = CLOUD_URL if cfg.get("mode", "cloud") == "cloud" else (cfg.get("url") or "").strip()
        self.base = url.rstrip("/")
        self.user = (cfg.get("username") or "").strip()
        self.password = cfg.get("password") or ""
        self.ctx = ssl.create_default_context()

    @property
    def configured(self):
        return bool(self.base and self.user and self.password)

    def _call(self, method, path, body=None):
        if not self.configured:
            raise GatewayError("اتصال گوشی تنظیم نشده؛ نام کاربری و رمز اپ رو تو تنظیمات وارد کن.")
        auth = base64.b64encode(("%s:%s" % (self.user, self.password)).encode()).decode()
        # بدون User-Agent، کلادفلرِ جلوی سرور اپ درخواست پایتون رو با خطای 1010 (۴۰۳) رد می‌کنه
        headers = {"Authorization": "Basic " + auth, "Accept": "application/json", "User-Agent": util.USER_AGENT}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=25, context=self.ctx) as resp:
                raw = resp.read().decode() or "{}"
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read().decode()).get("message", "")
            except (ValueError, AttributeError):
                pass
            if e.code == 401:
                raise GatewayError("نام کاربری یا رمز اپ گوشی اشتباهه (همونی که تو اپ زیر Cloud server نوشته).")
            if e.code == 403:
                raise GatewayError("سرور اپ گوشی درخواست رو رد کرد (۴۰۳). " + detail)
            if e.code == 503:
                raise GatewayError("صف اپ پره یا گوشی آنلاین نیست. " + detail)
            raise GatewayError("خطای اپ گوشی (%s) %s" % (e.code, detail))
        except (urllib.error.URLError, OSError) as e:
            raise GatewayError("به سرور اپ گوشی وصل نشد (%s)." % getattr(e, "reason", e))
        try:
            return json.loads(raw)
        except ValueError:
            return {}

    def send(self, phone, text, sim=None):
        body = {"textMessage": {"text": text}, "phoneNumbers": [util.e164(phone)], "withDeliveryReport": True}
        if sim in (1, 2, 3):
            body["simNumber"] = sim
        r = self._call("POST", "/messages", body)
        mid = r.get("id")
        if not mid:
            raise GatewayError("اپ گوشی شناسهٔ پیامک رو برنگردوند.")
        return mid

    def state(self, mid):
        """(وضعیت برنامه، خطا، وضعیت خام اپ). Pending یعنی هنوز رو سرور اپه و گوشی نگرفته؛ Processed یعنی گوشی گرفت."""
        r = self._call("GET", "/messages/" + urllib.parse.quote(mid, safe=""))
        rec = (r.get("recipients") or [{}])[0]
        raw = r.get("state") or rec.get("state") or ""
        return STATE_MAP.get(raw, "sending"), rec.get("error") or "", raw

    def devices(self):
        out = []
        for d in self._call("GET", "/devices") or []:
            seen = d.get("lastSeen") or ""
            ago = None
            try:
                # پایتون قدیمی (۳.۸ تا ۳.۱۰) کسر ثانیهٔ بیش از ۶ رقم و Z رو نمی‌فهمه
                iso = re.sub(r"(\.\d{6})\d+", r"\1", seen.replace("Z", "+00:00"))
                ago = max(0, int((util.tehran_now() - datetime.fromisoformat(iso)).total_seconds() // 60))
            except (ValueError, TypeError):
                pass
            out.append({"id": d.get("id"), "name": d.get("name") or "", "lastSeenAgo": ago})
        return out
