"""نقطهٔ شروع برنامه.

  python3 server/run.py                      اجرا (پورت از تنظیمات، پیش‌فرض ۸۰۹۰)
  python3 server/run.py --set-password XXX    تعیین رمز ورود (نصب‌کننده همین رو صدا می‌زنه)
  python3 server/run.py --port 9000           اجرا روی پورت دیگه (فقط همین بار)
"""
import argparse
import logging
import os
import sys

from .db import DB
from .engine import Engine
from .web import ROOT, App, serve, set_password


def main(argv=None):
    ap = argparse.ArgumentParser(prog="smsbot")
    ap.add_argument("--data", default=os.environ.get("SMSBOT_DATA") or os.path.join(ROOT, "data"),
                    help="پوشهٔ دیتابیس")
    ap.add_argument("--host", default=os.environ.get("SMSBOT_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--set-password", metavar="PASSWORD")
    ap.add_argument("--set-port", type=int, metavar="PORT")
    # نصب‌کننده با این‌ها برنامه رو خودکار به پنل وصل می‌کنه
    ap.add_argument("--panel-url")
    ap.add_argument("--panel-token")
    ap.add_argument("--link-host")
    ap.add_argument("--app-cert")
    ap.add_argument("--app-key")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    db = DB(os.path.join(args.data, "smsbot.db"))

    configure = (args.set_password, args.set_port, args.panel_url, args.panel_token, args.link_host, args.app_cert)
    if any(configure):
        s = db.settings()
        if args.set_password:
            if len(args.set_password) < 6:
                sys.exit("رمز حداقل ۶ حرف باشه.")
            set_password(db, args.set_password)
            db.drop_session()
        if args.set_port:
            s["app"]["port"] = args.set_port
        if args.app_cert and args.app_key:
            s["app"].update(cert=args.app_cert, key=args.app_key)
        if args.panel_url:
            s["panel"]["url"] = args.panel_url
        if args.panel_token:
            s["panel"].update(auth="token", token=args.panel_token, username="", password="")
        if args.link_host:
            s["panel"]["linkHost"] = args.link_host
        db.save_section("app", s["app"])
        db.save_section("panel", s["panel"])
        print("ok")
        return

    if not db.settings()["auth"].get("hash"):
        logging.warning("رمز ورود تعیین نشده؛ با --set-password بسازش.")
    engine = Engine(db)
    engine.start()
    app_cfg = db.settings()["app"]
    serve(App(db, engine), args.host, args.port or int(app_cfg.get("port") or 8090), app_cfg.get("cert"), app_cfg.get("key"))
