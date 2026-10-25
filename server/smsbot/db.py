"""دیتابیس SQLite برنامه: تنظیمات، شماره‌ها، متن‌ها، صف پیامک‌ها و وضعیت هشدارها."""
import copy
import json
import os
import sqlite3
import threading

from . import util

DEFAULT_SETTINGS = {
    "panel": {"type": "3x-ui", "url": "", "auth": "token", "token": "",
              "username": "", "password": "", "linkHost": ""},
    "phone": {"mode": "cloud", "url": "https://api.sms-gate.app/3rdparty/v1", "username": "", "password": "",
              "line1": "خط ۱", "line2": "خط ۲", "defaultLine": 1},
    "sending": {"from": "09:00", "to": "22:00", "gapSec": 20, "dailyLimit": 50},
    "rules": {
        "enabled": True,
        "intervalMin": 10,
        "volume": {"on": True, "amount": 1, "unit": "GB", "templateId": 1, "line": 1},
        "expiry": {"on": True, "days": 2, "templateId": 2, "line": 1},
        "ended": {"on": False, "templateId": 3, "line": 1},
    },
    "app": {"address": "", "port": 8090, "cert": "", "key": ""},
    # پشتیبان خودکار به ربات تلگرام علی (هر روز سر ساعت، به وقت تهران)
    "backup": {"telegram": False, "token": "", "chatId": "", "time": "03:00", "lastSent": 0, "lastError": ""},
    "auth": {"salt": "", "hash": ""},
}

DEFAULT_TEMPLATES = [
    ("هشدار حجم", "سلام {اسم}، فقط {حجم} از حجم سرویست مونده. برای تمدید پیام بده."),
    ("هشدار تاریخ", "سلام {اسم}، فقط {روز} روز تا پایان اشتراکت مونده. برای تمدید پیام بده."),
    ("پایان اشتراک", "سلام {اسم}، اشتراکت تموم شد. برای تمدید همین‌جا پیام بده."),
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contacts (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alert_state (email TEXT NOT NULL, rule TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (email, rule));
CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT NOT NULL,
  line INTEGER NOT NULL, total INTEGER NOT NULL, created_at INTEGER NOT NULL, send_after INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
  send_after INTEGER NOT NULL DEFAULT 0, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL, text TEXT NOT NULL,
  type TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'queued',
  gateway_id TEXT, error TEXT, sent_at INTEGER, broadcast_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, send_after);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
"""


def _merge(base, extra):
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


class DB:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.executescript(SCHEMA)
            if not self.conn.execute("SELECT 1 FROM templates LIMIT 1").fetchone():
                self.conn.executemany("INSERT INTO templates (title, text) VALUES (?, ?)", DEFAULT_TEMPLATES)
            self.conn.commit()

    # ───── پایه ─────
    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        rows = self.q(sql, args)
        return rows[0] if rows else None

    def run(self, sql, args=()):
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur.lastrowid

    # ───── تنظیمات ─────
    def settings(self):
        stored = {r["key"]: json.loads(r["value"]) for r in self.q("SELECT key, value FROM settings")}
        return _merge(DEFAULT_SETTINGS, stored)

    def save_section(self, key, value):
        self.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, util.dumps(value)))

    # ───── شماره‌ها ─────
    def contacts(self):
        return {r["email"]: r for r in self.q("SELECT * FROM contacts")}

    def save_contact(self, email, name, phone):
        self.run("INSERT INTO contacts (email, name, phone, updated_at) VALUES (?, ?, ?, ?) "
                 "ON CONFLICT(email) DO UPDATE SET name = excluded.name, phone = excluded.phone, updated_at = excluded.updated_at",
                 (email, name, phone, util.now_ms()))

    def rename_contact(self, old, new):
        with self.lock:
            self.conn.execute("DELETE FROM contacts WHERE email = ?", (new,))
            self.conn.execute("UPDATE contacts SET email = ? WHERE email = ?", (new, old))
            self.conn.execute("UPDATE alert_state SET email = ? WHERE email = ?", (new, old))
            self.conn.commit()

    def delete_contact(self, email):
        self.run("DELETE FROM contacts WHERE email = ?", (email,))
        self.run("DELETE FROM alert_state WHERE email = ?", (email,))

    # ───── وضعیت هشدارها (هر قانون برای هر کانفیگ یک بار در هر دوره) ─────
    def alert_states(self):
        out = {}
        for r in self.q("SELECT email, rule FROM alert_state"):
            out.setdefault(r["email"], set()).add(r["rule"])
        return out

    def mark_alert(self, email, rule):
        self.run("INSERT OR REPLACE INTO alert_state (email, rule, at) VALUES (?, ?, ?)", (email, rule, util.now_ms()))

    def clear_alert(self, email, rule=None):
        if rule:
            self.run("DELETE FROM alert_state WHERE email = ? AND rule = ?", (email, rule))
        else:
            self.run("DELETE FROM alert_state WHERE email = ?", (email,))

    # ───── صف پیامک ─────
    def enqueue(self, phone, text, kind, line, email="", send_after=0, broadcast_id=None, status="queued"):
        return self.run("INSERT INTO messages (created_at, send_after, email, phone, text, type, line, status, broadcast_id) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (util.now_ms(), send_after, email, phone, text, kind, line, status, broadcast_id))

    def update_message(self, mid, **fields):
        cols = ", ".join(k + " = ?" for k in fields)
        self.run("UPDATE messages SET " + cols + " WHERE id = ?", (*fields.values(), mid))

    def sent_today(self):
        return self.one("SELECT COUNT(*) AS n FROM messages WHERE sent_at >= ? AND status IN ('sending', 'sent', 'delivered')",
                        (util.tehran_day_start_ms(),))["n"]

    # ───── نشست‌های ورود ─────
    def add_session(self, token):
        now = util.now_ms()
        self.run("INSERT INTO sessions (token, created_at, last_seen) VALUES (?, ?, ?)", (token, now, now))

    def touch_session(self, token, max_idle_ms):
        row = self.one("SELECT last_seen FROM sessions WHERE token = ?", (token,))
        if not row:
            return False
        if util.now_ms() - row["last_seen"] > max_idle_ms:
            self.run("DELETE FROM sessions WHERE token = ?", (token,))
            return False
        self.run("UPDATE sessions SET last_seen = ? WHERE token = ?", (util.now_ms(), token))
        return True

    def drop_session(self, token=None):
        if token:
            self.run("DELETE FROM sessions WHERE token = ?", (token,))
        else:
            self.run("DELETE FROM sessions")
