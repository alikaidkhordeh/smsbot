// صفحهٔ کانفیگ‌ها: لیست کامل کانفیگ‌های پنل (مثل خود پنل)، ساخت، ویرایش، تمدید دستی، لینک و QR، حذف
// همهٔ این کارها دستیه؛ برنامه خودش فقط پیامک هشدار می‌فرسته.

const FILTERS = [
  { v: 'all', label: 'همه', test: () => true },
  { v: 'nophone', label: 'بدون شماره', test: r => !r.c.phone },
  { v: 'near', label: 'نزدیک اتمام', test: r => r.st.near },
  { v: 'ended', label: 'تموم شده', test: r => r.st.ended },
  { v: 'off', label: 'غیرفعال', test: r => r.st.off },
];
const PAGE_SIZE = 200; // با صدها کانفیگ، صفحه سنگین نشه
const inboundLabel = i => `${i.remark} · پورت ${fa(i.port)}`;
const numOrNull = v => { const n = Number(toEn(v).trim()); return v.trim() === '' || isNaN(n) ? null : n; };
const phoneOk = p => !p || /^09\d{9}$/.test(p);
const cleanPhone = v => toEn(v).replace(/[\s-]/g, '');
const idsOf = c => (c.inboundIds && c.inboundIds.length ? c.inboundIds : [c.inboundId]).filter(Boolean);
const onAllInbounds = (c, inbounds) => inbounds.length > 1 && inbounds.every(i => idsOf(c).includes(i.id));
function inboundNames(c, inbounds) {
  if (onAllInbounds(c, inbounds)) return `همهٔ اینباندها (${fa(inbounds.length)})`;
  const names = idsOf(c).map(id => inbounds.find(i => i.id === id)).filter(Boolean).map(i => i.remark);
  return names.length ? names.join('، ') : 'بدون اینباند';
}

function clientRow({ c, st }) {
  const unlimited = st.left === Infinity;
  const pct = unlimited ? 100 : Math.min(100, (c.usedGB / c.totalGB) * 100);
  const level = st.ended ? 'danger' : st.lowVol ? 'warn' : unlimited ? 'ok' : '';
  const days = c.daysLeft == null ? '<span class="muted">بدون تاریخ</span>'
    : c.daysLeft <= 0 ? '<span style="color:var(--danger)">تموم شده</span>'
    : `<span ${st.lowDays ? 'style="color:var(--warn)"' : ''}>${fa(c.daysLeft)} روز</span>`;
  return `<div class="client-row" data-row="${c.id}">
    <div class="c-name hstack"><span class="avatar">${esc(initial(c))}</span><div style="min-width:0">
      <div class="acc">${esc(c.account)}</div>
      <div class="who">${c.name ? esc(c.name) : 'بدون اسم'}<span class="only-mobile">${c.daysLeft != null ? ' · ' + days : ''}</span></div>
    </div></div>
    <div class="c-vol">
      <div class="vol-line"><span>مونده: <b>${unlimited ? 'نامحدود' : vol(st.left)}</b></span><span>${unlimited ? `${vol(c.usedGB)} مصرف` : `از ${vol(c.totalGB)}`}</span></div>
      <div class="progress ${level}"><span style="width:${pct}%"></span></div>
    </div>
    <div class="c-days">${days}</div>
    <div class="c-phone">${c.phone ? phoneHtml(c.phone) : `<button class="no-phone" data-edit="${c.id}">${icon('plus', 'i-sm')}ثبت شماره</button>`}</div>
    <div class="c-status">${st.off ? '<span class="pill">غیرفعال</span>' : statePill(st)}</div>
    <div class="c-actions">
      <button class="icon-btn sm" data-link="${c.id}" aria-label="لینک و QR" title="لینک و QR">${icon('qr', 'i-sm')}</button>
      <button class="icon-btn sm" data-edit="${c.id}" aria-label="ویرایش و تمدید" title="ویرایش و تمدید">${icon('edit', 'i-sm')}</button>
      <button class="icon-btn sm" data-send="${c.id}" aria-label="پیامک" title="پیامک تکی" ${c.phone ? '' : 'disabled style="opacity:.4"'}>${icon('send', 'i-sm')}</button>
    </div>
  </div>`;
}

App.pages.clients = async view => {
  const [clients, rules, inbounds] = await Promise.all([api.clients(), api.rules(), api.inbounds()]);
  const ctx = { clients, rules, inbounds };
  const rows = clients.map(c => ({ c, st: clientState(c, rules) }));
  const start = new URLSearchParams(location.hash.split('?')[1]).get('f') || 'all';
  let limit = PAGE_SIZE;

  view.innerHTML = `<div class="stack">
    <div class="hstack wrap">
      <div class="input-group" style="flex:1;min-width:220px">${icon('search')}<input class="input" id="q" type="search" placeholder="جستجوی کانفیگ، اسم یا شماره"></div>
      <select class="select" id="inb" style="width:auto"><option value="">همهٔ اینباندها</option>${inbounds.map(i => `<option value="${i.id}">${esc(inboundLabel(i))}</option>`).join('')}</select>
      <button class="btn btn-primary" id="addBtn">${icon('plus')}<span>کانفیگ جدید</span></button>
      <button class="icon-btn" id="syncBtn" title="به‌روزرسانی از پنل" aria-label="به‌روزرسانی از پنل">${icon('refresh')}</button>
    </div>
    <div class="chips" id="filters" data-value="${start}">${FILTERS.map(f =>
      `<button class="chip ${f.v === start ? 'on' : ''}" data-v="${f.v}">${f.label} <span class="n">${fa(rows.filter(f.test).length)}</span></button>`).join('')}</div>
    <div class="stack" id="list"></div>
  </div>`;

  const groupHead = (title, sub) => `<div class="group-head">${icon('server', 'i-sm')}<b>${esc(title)}</b><span class="muted">${sub}</span></div>`;
  const draw = () => {
    const f = FILTERS.find(x => x.v === $('#filters').dataset.value);
    const q = toEn($('#q').value.trim()).toLowerCase();
    const inbId = Number($('#inb').value) || null;
    const shown = rows.filter(f.test)
      .filter(({ c }) => !inbId || idsOf(c).includes(inbId))
      .filter(({ c }) => !q || [c.account, c.name, c.phone].some(x => toEn(x).toLowerCase().includes(q)));
    const page = shown.slice(0, limit);

    // گروه‌ها: کانفیگ‌هایی که رو همهٔ اینباندها هستن، بعد هر اینباند، بعد بدون اینباند
    const groups = [];
    const all = page.filter(r => onAllInbounds(r.c, inbounds));
    if (all.length) groups.push({ head: groupHead('همهٔ اینباندها', `${fa(inbounds.length)} اینباند · ${fa(all.length)} کانفیگ`), list: all });
    const rest = page.filter(r => !onAllInbounds(r.c, inbounds));
    for (const i of inbounds) {
      const list = rest.filter(r => idsOf(r.c)[0] === i.id);
      if (list.length) groups.push({ head: groupHead(i.remark, `${esc(i.protocol.toUpperCase())} · پورت ${fa(i.port)} · ${fa(list.length)} کانفیگ`), list });
    }
    const known = new Set(inbounds.map(i => i.id));
    const orphans = rest.filter(r => !known.has(idsOf(r.c)[0]));
    if (orphans.length) groups.push({ head: groupHead('بدون اینباند', `${fa(orphans.length)} کانفیگ`), list: orphans });

    $('#list').innerHTML = groups.length ? groups.map(g => `
      <div>${g.head}
        <div class="clients-list">
          <div class="client-head"><span>کانفیگ</span><span>حجم</span><span>تاریخ</span><span>شماره</span><span>وضعیت</span><span></span></div>
          ${g.list.map(clientRow).join('')}
        </div>
      </div>`).join('') + (shown.length > page.length
        ? `<button class="btn btn-block" id="moreBtn">نمایش بیشتر (${fa(page.length)} از ${fa(shown.length)})</button>` : '')
      : '<div class="empty card">کانفیگی با این مشخصات پیدا نشد.</div>';
    const more = $('#moreBtn');
    if (more) more.onclick = () => { limit += PAGE_SIZE; draw(); };
  };
  const redraw = () => { limit = PAGE_SIZE; draw(); };
  draw();
  $('#filters').addEventListener('change', redraw);
  $('#q').addEventListener('input', redraw);
  $('#inb').addEventListener('change', redraw);
  $('#addBtn').onclick = () => openAddConfig(ctx);
  $('#syncBtn').onclick = e => busy(e.currentTarget, async () => { await App.go(); toast('اطلاعات از پنل به‌روز شد'); });
  bindClientButtons(view, clients, ctx);
};

function bindClientButtons(view, clients, ctx) {
  // روی محتوای همین صفحه (نه خود #view) تا با هر بار رفتن به صفحه، شنونده تکراری نشه
  view.firstElementChild.addEventListener('click', e => {
    const find = attr => {
      const el = e.target.closest(`[${attr}]`);
      return el && clients.find(c => c.id === Number(el.getAttribute(attr)));
    };
    const send = e.target.closest('[data-send]');
    if (send) return send.disabled || openSendOne(find('data-send'));
    if (e.target.closest('[data-link]')) return openConfig(find('data-link'), 'link', ctx);
    if (e.target.closest('[data-edit]')) return openConfig(find('data-edit'), 'info', ctx);
    if (e.target.closest('[data-row]')) return openConfig(find('data-row'), 'info', ctx);
  });
}

// ───── پنجرهٔ هر کانفیگ: مشخصات / تمدید / لینک و QR ─────
async function openConfig(c, tab = 'info', ctx = null) {
  // اطلاعات صفحه رو اگه داریم دوباره نمی‌گیریم تا پنجره همون لحظه باز بشه (و دوبار کلیک دوبار باز نکنه)
  const { rules, inbounds } = ctx || { rules: await api.rules(), inbounds: await api.inbounds() };
  const st = clientState(c, rules);
  const tabs = ui.seg('cfgTab', [{ v: 'info', label: 'مشخصات' }, { v: 'renew', label: 'تمدید' }, { v: 'link', label: 'لینک و QR' }], tab).replace('class="seg"', 'class="seg full"');
  const hide = name => (name === tab ? '' : 'hidden');

  const m = openModal(`${modalHead(esc(c.account))}
    <div class="stack">
      ${tabs}

      <form class="stack" data-panel="info" id="infoForm" ${hide('info')}>
        <div class="form-row two">
          <div class="field"><label for="cAcc">اسم کانفیگ</label><input class="input" id="cAcc" value="${esc(c.account)}" spellcheck="false"><span class="hint">همین اسم تو پنل نشون داده می‌شه؛ بدون فاصله.</span></div>
          <div class="field"><label for="cName">اسم مشتری <span class="muted">(اختیاری)</span></label><input class="input" id="cName" value="${esc(c.name)}" placeholder="مثلاً رضا"></div>
        </div>
        <div class="field"><label for="cPhone">شمارهٔ موبایل</label><input class="input ltr" id="cPhone" inputmode="tel" value="${esc(c.phone)}" placeholder="09xxxxxxxxx"></div>
        <div class="form-row two">
          <div class="field"><span class="label">اینباند</span><div class="input readonly">${esc(inboundNames(c, inbounds))}</div></div>
          <div class="field"><label for="cLimit">تعداد دستگاه</label><input class="input" id="cLimit" inputmode="numeric" value="${fa(c.limitIp)}"><span class="hint">۰ یعنی بدون محدودیت</span></div>
        </div>
        <div class="setting-row"><div class="txt"><b>کانفیگ فعال باشه</b><small>اگه خاموشش کنی، مشتری تا روشن کردن دوباره وصل نمی‌شه.</small></div>${ui.switch('cEnabled', c.enabled)}</div>
        <p class="small err" id="cErr"></p>
        <div class="hstack wrap"><button class="btn btn-primary" type="submit">${icon('check')}ذخیره</button><span class="spacer"></span>
          <button class="btn btn-ghost btn-danger" type="button" id="cDel">${icon('trash')}حذف کانفیگ</button></div>
      </form>

      <div class="stack" data-panel="renew" ${hide('renew')}>
        <dl class="kv soft-box">
          <dt>حجم کل</dt><dd>${c.totalGB > 0 ? vol(c.totalGB) : 'نامحدود'}</dd>
          <dt>مصرف‌شده</dt><dd>${vol(c.usedGB)}</dd>
          <dt>باقی‌مونده</dt><dd>${st.left === Infinity ? 'نامحدود' : vol(st.left)}</dd>
          <dt>تاریخ</dt><dd>${c.daysLeft == null ? 'بدون تاریخ' : fa(c.daysLeft) + ' روز مونده'}</dd>
        </dl>
        <div class="form-row two">
          <div class="field"><label for="rVol">حجم جدید</label><div class="inline-num"><input class="input" id="rVol" inputmode="decimal" value="${c.totalGB > 0 ? fa(c.totalGB) : ''}" placeholder="—"> گیگ</div><span class="hint">خالی یعنی نامحدود</span></div>
          <div class="field"><label for="rDays">مدت</label><div class="inline-num"><input class="input" id="rDays" inputmode="numeric" placeholder="—"> روز از امروز</div><span class="hint">خالی یعنی بدون تاریخ</span></div>
        </div>
        <label class="check"><input type="checkbox" id="rReset" checked>مصرف قبلی صفر بشه</label>
        <p class="hint small muted">پیامکی برای مشتری فرستاده نمی‌شه؛ فقط کانفیگ تو پنل تمدید می‌شه و هشدار دورهٔ بعد دوباره فعال می‌شه.</p>
        <div class="hstack wrap"><button class="btn btn-primary" id="rGo">${icon('refresh')}تمدید کن</button><button class="btn" id="rZero">فقط صفر کردن مصرف</button></div>
      </div>

      <div class="stack" data-panel="link" ${hide('link')}>
        <div class="empty" id="linkBox">در حال گرفتن لینک از پنل…</div>
      </div>
    </div>`);

  // لینک‌ها فقط وقتی بخش «لینک و QR» باز شد از پنل گرفته می‌شن
  let linksLoaded = false;
  const copyField = (label, value) => `<div class="field"><span class="label">${label}</span>
    <div class="copy-row"><code class="ltr">${esc(value)}</code><button class="icon-btn sm" data-copy="${esc(value)}" aria-label="کپی">${icon('copy', 'i-sm')}</button></div></div>`;
  const loadLinks = async () => {
    if (linksLoaded) return;
    linksLoaded = true;
    const box = $('#linkBox', m);
    try {
      const L = await api.links(c);
      if (!L.config && !L.sub) {
        box.textContent = 'این کانفیگ لینک قابل اشتراک نداره (یا ساب تو پنل خاموشه).';
        return;
      }
      const first = L.sub ? 'sub' : 'config';
      box.outerHTML = `
        ${L.config && L.sub ? ui.seg('qrFor', [{ v: 'sub', label: 'QR لینک ساب' }, { v: 'config', label: 'QR لینک کانفیگ' }], first).replace('class="seg"', 'class="seg full"') : ''}
        <div class="qr-box" id="qrBox">${L.qr(first === 'config' ? L.config : L.sub)}</div>
        ${L.sub ? copyField('لینک ساب (Subscription)', L.sub) : '<p class="hint small muted">ساب تو پنل خاموشه؛ فقط لینک کانفیگ هست.</p>'}
        ${L.all.map((x, i) => copyField('لینک کانفیگ' + (L.all.length > 1 ? ' ' + fa(i + 1) : ''), x)).join('')}
        <p class="hint small muted">لینک رو تو تلگرام یا واتس‌اپ برای مشتری بفرست؛ با پیامک نفرست.</p>`;
      $('.seg[data-name="qrFor"]', m)?.addEventListener('change', e => {
        $('#qrBox', m).innerHTML = L.qr(e.currentTarget.dataset.value === 'sub' ? L.sub : L.config);
      });
    } catch (err) {
      linksLoaded = false;
      box.textContent = err.message;
    }
  };
  if (tab === 'link') loadLinks();

  $('.seg[data-name="cfgTab"]', m).addEventListener('change', e => {
    const v = e.currentTarget.dataset.value;
    $$('[data-panel]', m).forEach(p => { p.hidden = p.dataset.panel !== v; });
    if (v === 'link') loadLinks();
  });

  $('#infoForm', m).onsubmit = async e => {
    e.preventDefault();
    const account = $('#cAcc', m).value.trim(), phone = cleanPhone($('#cPhone', m).value);
    if (!account) return ($('#cErr', m).textContent = 'اسم کانفیگ نمی‌تونه خالی باشه.');
    if (!phoneOk(phone)) return ($('#cErr', m).textContent = 'شماره باید ۱۱ رقم باشه و با ۰۹ شروع بشه.');
    await busy(e.submitter, () => api.saveClient(c.email, {
      account, phone, name: $('#cName', m).value.trim(),
      limitIp: numOrNull($('#cLimit', m).value) || 0, enabled: $('[name="cEnabled"]', m).checked,
    }));
    toast('ذخیره شد');
    App.go();
  };

  $('#cDel', m).onclick = async () => {
    const ok = await confirmBox({ title: 'حذف کانفیگ', text: `کانفیگ <b>${esc(c.account)}</b> از پنل حذف بشه؟ مشتری قطع می‌شه و این کار برگشت نداره.`, ok: 'حذف کن', danger: true });
    if (!ok) return;
    await busy(null, () => api.deleteClient(c.email));
    toast('کانفیگ حذف شد');
    App.go();
  };

  $('#rGo', m).onclick = async e => {
    const totalGB = numOrNull($('#rVol', m).value) || 0, days = numOrNull($('#rDays', m).value);
    await busy(e.currentTarget, () => api.renewClient(c.email, { totalGB, days, reset: $('#rReset', m).checked }));
    toast('تمدید شد');
    App.go();
  };
  $('#rZero', m).onclick = async e => {
    await busy(e.currentTarget, () => api.resetTraffic(c.email));
    toast('مصرف صفر شد');
    App.go();
  };
}

// ───── ساخت کانفیگ جدید ─────
function savedInbounds(inbounds) {
  try {
    const ids = JSON.parse(localStorage.getItem('smsbot-inbounds') || 'null');
    if (Array.isArray(ids) && ids.some(id => inbounds.find(i => i.id === id))) return ids;
  } catch { /* اولین بار: همه */ }
  return inbounds.map(i => i.id);
}

function openAddConfig({ clients, inbounds }) {
  // اسم پیشنهادی: ادامهٔ شماره‌گذاری خود علی (مثلاً storvpn5 → storvpn6)
  let best = { n: 0, prefix: 'VPN' };
  for (const c of clients) {
    const mm = c.account.match(/^([A-Za-z]+[-_]?)(\d+)$/);
    if (mm && Number(mm[2]) > best.n) best = { n: Number(mm[2]), prefix: mm[1] };
  }
  const chosen = savedInbounds(inbounds);

  const m = openModal(`${modalHead('کانفیگ جدید')}
    <form class="stack" id="addForm">
      <div class="field"><span class="label">اینباندها</span>
        <div class="inb-list">
          <label class="check strong"><input type="checkbox" id="aInbAll">همهٔ اینباندها <span class="muted small">(یه لینک ساب برای همه)</span></label>
          <div class="inb-items">${inbounds.map(i => `<label class="check"><input type="checkbox" name="aInb" value="${i.id}" ${chosen.includes(i.id) ? 'checked' : ''}>${esc(inboundLabel(i))}</label>`).join('')}</div>
        </div></div>
      <div class="form-row two">
        <div class="field"><label for="aAcc">اسم کانفیگ</label><input class="input" id="aAcc" value="${esc(best.prefix + (best.n + 1))}" spellcheck="false">
          <span class="hint">بدون فاصله؛ / و \\ هم مجاز نیست.</span></div>
        <div class="field"><label for="aName">اسم مشتری <span class="muted">(اختیاری)</span></label><input class="input" id="aName" placeholder="مثلاً رضا"></div>
      </div>
      <div class="field"><label for="aPhone">شمارهٔ موبایل</label><input class="input ltr" id="aPhone" inputmode="tel" placeholder="09xxxxxxxxx">
        <span class="hint">برای پیامک هشدار؛ می‌تونی بعداً هم اضافه کنی.</span></div>
      <div class="form-row two">
        <div class="field"><label for="aVol">حجم</label><div class="inline-num"><input class="input" id="aVol" inputmode="decimal" placeholder="—"> گیگ</div><span class="hint">خالی یعنی نامحدود</span></div>
        <div class="field"><label for="aDays">مدت</label><div class="inline-num"><input class="input" id="aDays" inputmode="numeric" placeholder="—"> روز</div><span class="hint">خالی یعنی بدون تاریخ</span></div>
      </div>
      <details class="more"><summary>تنظیمات بیشتر</summary>
        <div class="field mt-s"><label for="aLimit">تعداد دستگاه</label><input class="input" id="aLimit" inputmode="numeric" value="۰" style="max-width:120px"><span class="hint">۰ یعنی بدون محدودیت</span></div>
      </details>
      <p class="small err" id="aErr"></p>
      <div class="modal-foot" style="margin-top:0"><button class="btn btn-primary" type="submit">${icon('plus')}ساختن کانفیگ</button><button class="btn" type="button" data-action="close">انصراف</button></div>
    </form>`);

  const boxes = $$('[name="aInb"]', m);
  const all = $('#aInbAll', m);
  const syncAll = () => {
    const n = boxes.filter(b => b.checked).length;
    all.checked = n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  };
  syncAll();
  all.onchange = () => { boxes.forEach(b => { b.checked = all.checked; }); };
  boxes.forEach(b => { b.onchange = syncAll; });

  $('#addForm', m).onsubmit = async e => {
    e.preventDefault();
    const err = $('#aErr', m);
    const account = $('#aAcc', m).value.trim(), phone = cleanPhone($('#aPhone', m).value);
    const inboundIds = boxes.filter(b => b.checked).map(b => Number(b.value));
    if (!inboundIds.length) return (err.textContent = 'حداقل یه اینباند انتخاب کن.');
    if (!account) return (err.textContent = 'اسم کانفیگ رو بنویس.');
    if (!phoneOk(phone)) return (err.textContent = 'شماره باید ۱۱ رقم باشه و با ۰۹ شروع بشه.');
    try { localStorage.setItem('smsbot-inbounds', JSON.stringify(inboundIds)); } catch { /* اختیاری */ }
    try {
      const created = await busy(e.submitter, () => api.addClient({
        account, phone, name: $('#aName', m).value.trim(), inboundIds,
        totalGB: numOrNull($('#aVol', m).value) || 0,
        daysLeft: numOrNull($('#aDays', m).value),
        limitIp: numOrNull($('#aLimit', m).value) || 0,
      }));
      toast('کانفیگ ساخته شد');
      await App.go();
      openConfig(created, 'link');
    } catch (ex) {
      err.textContent = ex.message;
    }
  };
  setTimeout(() => $('#aAcc', m).select(), 50);
}
