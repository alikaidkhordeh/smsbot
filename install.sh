#!/usr/bin/env bash
# smsbot installer — SMS alerts & config management for 3X-UI (runs on the same server as the panel)
#
#   install / update : bash <(curl -Ls https://raw.githubusercontent.com/alikaidkhordeh/smsbot/main/install.sh)
#   with a domain    : SMSBOT_DOMAIN=sms.example.com bash <(curl -Ls https://raw.githubusercontent.com/alikaidkhordeh/smsbot/main/install.sh)
#   new password     : bash <(curl -Ls https://raw.githubusercontent.com/alikaidkhordeh/smsbot/main/install.sh) reset-password
#   uninstall        : bash <(curl -Ls https://raw.githubusercontent.com/alikaidkhordeh/smsbot/main/install.sh) uninstall
set -euo pipefail

REPO="https://github.com/alikaidkhordeh/smsbot.git"
BRANCH="${SMSBOT_BRANCH:-main}"
DIR="/opt/smsbot"
DATA="$DIR/data"
SERVICE="smsbot"
# پورت‌هایی که کلادفلر (ابر نارنجی) با https پشتیبانی می‌کنه؛ اولین پورت آزاد انتخاب می‌شه
CF_PORTS="8443 2083 2087 2053 2096 443"
PORT="${SMSBOT_PORT:-}"
DOMAIN="${SMSBOT_DOMAIN:-}"
XUI_DB="${XUI_DB:-/etc/x-ui/x-ui.db}"
XUI_BIN="${XUI_BIN:-/usr/local/x-ui/x-ui}"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
die() { red "Error: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo -i)"
ACTION="${1:-install}"

run_app() { python3 "$DIR/server/run.py" --data "$DATA" "$@"; }
new_password() { python3 -c 'import secrets,string; a=string.ascii_letters+string.digits; print("".join(secrets.choice(a) for _ in range(12)))'; }

if [ "$ACTION" = "uninstall" ]; then
  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
  green "smsbot removed. Data (phone numbers, settings) kept in $DATA — delete it yourself if you want: rm -rf $DIR"
  exit 0
fi

if [ "$ACTION" = "reset-password" ]; then
  [ -d "$DIR" ] || die "smsbot is not installed"
  PASS="$(new_password)"
  run_app --set-password "$PASS" >/dev/null
  systemctl restart "$SERVICE"
  green "New password: $PASS"
  exit 0
fi

# ───── 1. packages ─────
green "[1/6] Installing requirements (git, python3)..."
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq git python3 curl ca-certificates openssl >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q git python3 curl openssl >/dev/null
elif command -v yum >/dev/null; then
  yum install -y -q git python3 curl openssl >/dev/null
fi
command -v python3 >/dev/null || die "python3 not found"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' || die "python 3.8 or newer is needed"

# ───── 2. code ─────
green "[2/6] Downloading smsbot..."
FIRST=1
[ -f "$DATA/smsbot.db" ] && FIRST=0
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  rm -rf "$DIR.tmp"
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR.tmp"
  mkdir -p "$DIR"
  cp -a "$DIR.tmp/." "$DIR/"
  rm -rf "$DIR.tmp"
fi
mkdir -p "$DATA"
chmod 700 "$DATA"
# گواهی خودامضا: همون پورت https هم جواب می‌ده (کلادفلر در حالت Full قبولش می‌کنه)
if [ ! -f "$DATA/tls/cert.pem" ] && command -v openssl >/dev/null; then
  mkdir -p "$DATA/tls"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=${DOMAIN:-smsbot}" \
    -keyout "$DATA/tls/key.pem" -out "$DATA/tls/cert.pem" >/dev/null 2>&1 || rm -rf "$DATA/tls"
  [ -f "$DATA/tls/key.pem" ] && chmod 600 "$DATA/tls/key.pem"
fi

# ───── 3. read panel settings ─────
green "[3/6] Reading 3X-UI settings..."
PANEL_URL="" LINK_HOST="" CERT="" KEY="" TOKEN="" LOCAL_PANEL=0
if [ -f "$XUI_DB" ]; then
  LOCAL_PANEL=1
  eval "$(python3 - "$XUI_DB" <<'PY'
import shlex, sqlite3, sys
c = sqlite3.connect("file:%s?mode=ro" % sys.argv[1], uri=True)
s = dict(c.execute("SELECT key, value FROM settings").fetchall())
port = s.get("webPort") or "2053"
base = "/" + (s.get("webBasePath") or "/").strip("/") + "/"
base = "/" if base == "//" else base
listen = s.get("webListen") or ""
host = listen if listen and listen not in ("0.0.0.0", "::", "[::]") else "127.0.0.1"
cert, key = s.get("webCertFile") or "", s.get("webKeyFile") or ""
scheme = "https" if cert and key else "http"
out = {
    "PANEL_URL": "%s://%s:%s%s" % (scheme, host, port, base),
    "LINK_HOST": s.get("webDomain") or s.get("subDomain") or "",
    "CERT": cert, "KEY": key,
}
for k, v in out.items():
    print("%s=%s" % (k, shlex.quote(v)))
PY
)"
  echo "  panel on this server: $PANEL_URL"
  # پنل روی همین سرور و بدون دامنه → لینک‌ها با آی‌پی عمومی همین سرور
  [ -z "$LINK_HOST" ] && LINK_HOST="$(curl -s4 --max-time 6 https://api.ipify.org || true)"
else
  echo "  no 3X-UI on this server — you will connect your panel from the app (Settings → Panel)."
fi
if [ "$FIRST" = 1 ] && [ -x "$XUI_BIN" ]; then
  TOKEN="$("$XUI_BIN" setting -getApiToken 2>/dev/null | awk '/apiToken:/{print $2}' | tail -n1 || true)"
  [ -n "$TOKEN" ] && echo "  API token created for smsbot" || yellow "  could not create an API token automatically — connect from the settings page."
fi

# ───── 4. configure ─────
green "[4/6] Configuring..."
port_busy() { python3 -c 'import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)' "$1"; }
if [ "$FIRST" = 1 ]; then
  systemctl stop "$SERVICE" 2>/dev/null || true
  if [ -n "$PORT" ]; then
    port_busy "$PORT" && die "port $PORT is busy — choose another: SMSBOT_PORT=xxxx"
  else
    for p in $CF_PORTS; do port_busy "$p" || { PORT="$p"; break; }; done
    if [ -z "$PORT" ]; then PORT=8090; while port_busy "$PORT"; do PORT=$((PORT + 1)); done; fi
  fi
  ARGS=(--set-port "$PORT")
  [ -n "$PANEL_URL" ] && ARGS+=(--panel-url "$PANEL_URL")
  [ -n "$TOKEN" ] && ARGS+=(--panel-token "$TOKEN")
  [ -n "$LINK_HOST" ] && ARGS+=(--link-host "$LINK_HOST")
  if [ -n "$CERT" ] && [ -r "$CERT" ] && [ -r "$KEY" ]; then ARGS+=(--app-cert "$CERT" --app-key "$KEY"); fi
  [ -n "$DOMAIN" ] && ARGS+=(--app-domain "$DOMAIN")
  PASS="$(new_password)"
  ARGS+=(--set-password "$PASS")
  run_app "${ARGS[@]}" >/dev/null
else
  [ -n "$DOMAIN" ] && run_app --app-domain "$DOMAIN" >/dev/null
  PORT="$(python3 - "$DATA/smsbot.db" <<'PY'
import json, sqlite3, sys
r = sqlite3.connect(sys.argv[1]).execute("SELECT value FROM settings WHERE key = 'app'").fetchone()
print(json.loads(r[0]).get("port", 8090) if r else 8090)
PY
)"
fi

# ───── 5. service ─────
green "[5/6] Creating the always-on service..."
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=smsbot - SMS alerts and config management for 3X-UI
After=network-online.target x-ui.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
Environment=SMSBOT_DATA=$DATA
ExecStart=$(command -v python3) $DIR/server/run.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd -q --permanent --add-port="$PORT/tcp" && firewall-cmd -q --reload
fi

# ───── 6. done ─────
green "[6/6] Checking..."
sleep 3
systemctl is-active -q "$SERVICE" || { journalctl -u "$SERVICE" -n 30 --no-pager; die "service did not start"; }

SERVER_IP="$(curl -s4 --max-time 6 https://api.ipify.org || hostname -I | awk '{print $1}')"
[ -z "$DOMAIN" ] && DOMAIN="$(python3 - "$DATA/smsbot.db" <<'PY'
import json, sqlite3, sys
r = sqlite3.connect(sys.argv[1]).execute("SELECT value FROM settings WHERE key = 'app'").fetchone()
print(json.loads(r[0]).get("address", "") if r else "")
PY
)"
CF_PORT=0
case " $CF_PORTS " in *" $PORT "*) CF_PORT=1 ;; esac

echo
green "================================================"
green "  smsbot is running"
green "  Address : http://$SERVER_IP:$PORT"
if [ -n "$DOMAIN" ] && [ "$CF_PORT" = 1 ]; then
  if [ "$PORT" = 443 ]; then green "  Domain  : https://$DOMAIN"; else green "  Domain  : https://$DOMAIN:$PORT"; fi
fi
if [ "$FIRST" = 1 ]; then
  green "  Password: $PASS"
  yellow "  Save this password. You can change it inside the app (Settings)."
else
  green "  Updated. Your password and settings are unchanged."
fi
green "================================================"
if [ "$LOCAL_PANEL" = 0 ] && [ "$FIRST" = 1 ]; then
  echo
  yellow "Next: open the address, log in, go to Settings → Panel, enter your panel address,"
  yellow "      username and password, and press Connect."
fi
if [ "$CF_PORT" = 1 ]; then
  D="${DOMAIN:-sms.yourdomain.com}"
  echo
  echo "Cloudflare (for https://$D:$PORT and installing it as an app on your phone):"
  echo "  1) DNS: A record  $D -> $SERVER_IP  with Proxy status = Proxied (orange cloud)"
  echo "  2) SSL/TLS mode: Flexible or Full both work (not 'Full (strict)')"
  echo "  3) optional, to drop :$PORT from the address: Rules > Origin Rules > Hostname equals $D"
  echo "     > Destination Port: rewrite to $PORT   (then open https://$D)"
fi
