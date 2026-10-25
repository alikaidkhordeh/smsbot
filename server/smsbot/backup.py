"""پشتیبان کامل (کل دیتابیس: اتصال پنل و گوشی، شماره‌ها، متن‌ها، تنظیمات)، بازگردانی، و خروجی اکسل شماره‌ها.

اگه سرور از دست بره: برنامه رو روی سرور جدید نصب کن، وارد شو و همین فایل .db رو «بازگردانی» کن.
"""
import io
import os
import sqlite3
import tempfile
import zipfile
from xml.sax.saxutils import escape

from . import util
from .panel import PanelError, normalize

SQLITE_MAGIC = b"SQLite format 3\x00"
REQUIRED_TABLES = {"settings", "contacts", "templates", "messages"}
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def stamp():
    return util.tehran_now().strftime("%Y-%m-%d_%H%M")


# ───── پشتیبان کامل ─────
def db_bytes(db):
    """کپی سالم و یکجای دیتابیس (حتی وقتی برنامه داره کار می‌کنه)."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        dst = sqlite3.connect(path)
        with db.lock:
            db.conn.backup(dst)
        dst.close()
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.remove(path)


def restore_db(db, data):
    """محتوای فایل پشتیبان رو جایگزین دیتابیس فعلی می‌کنه. ValueError اگه فایل مال این برنامه نباشه."""
    if not data.startswith(SQLITE_MAGIC):
        raise ValueError("این فایل پشتیبان کامل برنامه نیست؛ فایل .db که از «دانلود پشتیبان» یا تلگرام گرفتی رو بده.")
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        with open(path, "wb") as f:
            f.write(data)
        src = sqlite3.connect(path)
        try:
            tables = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if not REQUIRED_TABLES <= tables:
                raise ValueError("این فایل پشتیبان پنل پیامک نیست.")
            with db.lock:
                src.backup(db.conn)
        finally:
            src.close()
        db.migrate()  # پشتیبان از نسخه‌های قدیمی‌تر: ستون‌ها و جدول‌های جدید اضافه بشن
    finally:
        os.remove(path)


# ───── شماره‌های مشتری‌ها ─────
HEADER = ["کانفیگ", "اسم مشتری", "شماره موبایل", "حجم کل (گیگ)", "باقی‌مونده (گیگ)", "روز مونده", "وضعیت"]


def contact_rows(db, engine):
    """ردیف‌های اکسل: هر کانفیگی که شماره داره. اگه پنل در دسترس نباشه، فقط شماره‌های ذخیره‌شده تو خود برنامه."""
    contacts = db.contacts()
    clients, panel_ok = {}, False
    p = engine.panel()
    try:
        if p.configured:
            clients = {c["email"]: c for c in map(normalize, p.clients())}
            panel_ok = True
    except PanelError:
        pass

    def num(x):
        return ("%g" % round(x, 2)) if x is not None else ""

    rows, seen = [], set()
    for email, c in clients.items():
        ct = contacts.get(email) or {}
        phone = util.phone_for(contacts, email, c["comment"])
        if not phone:
            continue
        left = max(0.0, c["totalGB"] - c["usedGB"]) if c["totalGB"] > 0 else None
        ended = (left is not None and left <= 0) or c["daysLeft"] == 0
        status = "تموم شده" if ended else ("فعال" if c["enabled"] else "غیرفعال")
        rows.append([email, ct.get("name", ""), phone, num(c["totalGB"]) if c["totalGB"] > 0 else "نامحدود",
                     num(left) if left is not None else "نامحدود", "" if c["daysLeft"] is None else str(c["daysLeft"]), status])
        seen.add(email)
    for email, ct in contacts.items():
        if email not in seen and ct.get("phone"):
            status = "تو پنل نیست" if panel_ok else ("پنل در دسترس نبود" if p.configured else "")
            rows.append([email, ct.get("name", ""), ct["phone"], "", "", "", status])
    return [HEADER] + rows


def xlsx(rows, sheet="مشتری‌ها"):
    """فایل اکسل ساده بدون هیچ کتابخونه: همه متنی (صفر اول شماره نمی‌پره)، راست‌چین، ردیف اول پررنگ."""
    def col(i):
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    lines = []
    for ri, row in enumerate(rows, 1):
        cells = "".join(
            '<c r="%s%d" t="inlineStr"%s><is><t xml:space="preserve">%s</t></is></c>'
            % (col(ci), ri, ' s="1"' if ri == 1 else "", escape(str(v))) for ci, v in enumerate(row))
        lines.append('<row r="%d">%s</row>' % (ri, cells))
    width = max((len(r) for r in rows), default=1)
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>'
        '<cols><col min="1" max="%d" width="20" customWidth="1"/></cols>'
        '<sheetData>%s</sheetData></worksheet>' % (width, "".join(lines)))
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            '</Types>'),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>'),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets></workbook>' % escape(sheet)),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '</Relationships>'),
        "xl/styles.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
            '</styleSheet>'),
        "xl/worksheets/sheet1.xml": sheet_xml,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()
