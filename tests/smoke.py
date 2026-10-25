"""تست کامل بعد از نصب روی لینوکس (در GitHub Actions اجرا می‌شه).

python3 tests/smoke.py APP_URL APP_PASSWORD PANEL_URL PANEL_USER PANEL_PASS
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
from smsbot.panel import Panel  # noqa: E402

app_url, app_pass, panel_url, panel_user, panel_pass = sys.argv[1:6]

# ۱. یه اینباند تستی تو پنل (برنامه خودش اینباند نمی‌سازه)
p = Panel({"url": panel_url, "auth": "login", "username": panel_user, "password": panel_pass})
p.login()
p.call("POST", "/panel/api/inbounds/add", {
    "remark": "ci", "enable": True, "listen": "127.0.0.1", "port": 44300, "protocol": "vless", "expiryTime": 0,
    "settings": {"clients": [], "decryption": "none", "fallbacks": []},
    "streamSettings": {"network": "tcp", "security": "none", "tcpSettings": {"header": {"type": "none"}}},
    "sniffing": {"enabled": False, "destOverride": []},
})

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(method, path, body=None, expect_ok=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(app_url + path, data=data, method=method,
                                 headers={"X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json"})
    try:
        with opener.open(req, timeout=30) as r:
            j = json.loads(r.read())
    except urllib.error.HTTPError as e:
        j = json.loads(e.read() or b"{}")
    if expect_ok and not j.get("ok"):
        sys.exit("FAIL %s %s: %s" % (method, path, j))
    print("ok", method, path)
    return j.get("data")


assert call("GET", "/api/me")["loggedIn"] is False
assert call("POST", "/api/login", {"password": "wrong"}, expect_ok=False) is None
call("POST", "/api/login", {"password": app_pass})
assert call("GET", "/api/me")["loggedIn"] is True

inbounds = call("GET", "/api/inbounds")
assert len(inbounds) == 1, inbounds
call("POST", "/api/clients/add", {"account": "VPN 1", "name": "test", "phone": "09121234567",
                                  "inboundId": inbounds[0]["id"], "totalGB": 2, "daysLeft": 30})
clients = call("GET", "/api/clients")
assert clients[0]["email"] == "VPN-1" and clients[0]["phone"] == "09121234567" and clients[0]["daysLeft"] == 30, clients
links = call("GET", "/api/clients/links?email=VPN-1")
assert links["config"] and "localhost" not in links["config"][0], links
call("POST", "/api/clients/renew", {"email": "VPN-1", "totalGB": 10, "days": 0, "reset": True})
assert call("GET", "/api/clients")[0]["totalGB"] == 10
call("POST", "/api/clients/update", {"email": "VPN-1", "account": "VPN1", "name": "test", "phone": "09121234567", "enabled": False})
c = call("GET", "/api/clients")[0]
assert c["email"] == "VPN1" and c["enabled"] is False and c["phone"] == "09121234567", c
call("POST", "/api/clients/delete", {"email": "VPN1"})
assert call("GET", "/api/clients") == []

time.sleep(2)
st = call("GET", "/api/status")
assert st["panel"]["ok"] is True and st["panel"]["version"], st
print("ALL OK — panel", st["panel"]["version"])
