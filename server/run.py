#!/usr/bin/env python3
"""اجرای پنل پیامک: python3 server/run.py  (راهنما: python3 server/run.py --help)"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from smsbot.main import main  # noqa: E402

if __name__ == "__main__":
    main()
