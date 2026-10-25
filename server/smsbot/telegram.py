"""ارسال پیام و فایل به ربات تلگرام علی (برای پشتیبان خودکار).

بهتره یه ربات جدید فقط برای پشتیبان ساخته بشه (@BotFather)، نه رباتی که برنامهٔ دیگه‌ای باهاش کار می‌کنه.
"""
import json
import secrets
import urllib.error
import urllib.request

from . import util


class TelegramError(Exception):
    pass


def _explain(code, desc):
    d = (desc or "").lower()
    if code in (401, 404) or "unauthorized" in d:
        return "توکن ربات تلگرام اشتباهه."
    if "chat not found" in d:
        return "این شناسهٔ چت پیدا نشد؛ اول تو تلگرام به ربات «/start» بفرست."
    if "blocked by the user" in d:
        return "ربات رو بلاک کردی؛ تو تلگرام آنبلاکش کن."
    if "webhook" in d or "terminated by other getupdates" in d:
        return "یه برنامهٔ دیگه هم با همین ربات کار می‌کنه؛ شناسهٔ چت رو دستی بنویس یا یه ربات جدید بساز."
    if "too large" in d:
        return "فایل پشتیبان برای تلگرام بزرگه."
    return "تلگرام خطا داد: " + (desc or str(code))


def _multipart(boundary, fields, files):
    b = boundary.encode()
    out = []
    for k, v in fields.items():
        out += [b"--" + b, ('Content-Disposition: form-data; name="%s"' % k).encode(), b"", str(v).encode()]
    for k, (name, content) in files.items():
        out += [b"--" + b, ('Content-Disposition: form-data; name="%s"; filename="%s"' % (k, name)).encode(),
                b"Content-Type: application/octet-stream", b"", content]
    out += [b"--" + b + b"--", b""]
    return b"\r\n".join(out)


class Telegram:
    def __init__(self, token):
        self.token = (token or "").strip()

    def _call(self, method, data=None, files=None):
        if not self.token:
            raise TelegramError("توکن ربات تلگرام وارد نشده.")
        headers = {"User-Agent": util.USER_AGENT}
        if files:
            boundary = "smsbot" + secrets.token_hex(12)
            body = _multipart(boundary, data or {}, files)
            headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
        else:
            body = json.dumps(data or {}, ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request("https://api.telegram.org/bot%s/%s" % (self.token, method), data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                res = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                res = json.loads(e.read().decode())
            except ValueError:
                res = {}
            raise TelegramError(_explain(e.code, res.get("description", "")))
        except (urllib.error.URLError, OSError) as e:
            raise TelegramError("به تلگرام وصل نشد (%s)." % getattr(e, "reason", e))
        if not res.get("ok"):
            raise TelegramError(_explain(0, res.get("description", "")))
        return res.get("result")

    def send_message(self, chat_id, text):
        return self._call("sendMessage", {"chat_id": chat_id, "text": text})

    def send_document(self, chat_id, filename, content, caption=""):
        return self._call("sendDocument", {"chat_id": str(chat_id), "caption": caption}, {"document": (filename, content)})

    def detect_chats(self):
        """چت‌هایی که اخیراً به ربات پیام دادن (بعد از فرستادن /start به ربات)."""
        chats = {}
        for u in self._call("getUpdates", {"limit": 50}) or []:
            msg = u.get("message") or u.get("channel_post") or u.get("my_chat_member") or {}
            chat = msg.get("chat") or {}
            if chat.get("id"):
                name = chat.get("title") or " ".join(x for x in (chat.get("first_name"), chat.get("last_name")) if x)
                chats[chat["id"]] = name or chat.get("username") or str(chat["id"])
        return [{"id": str(k), "name": v} for k, v in chats.items()]
