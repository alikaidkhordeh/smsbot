// صفحهٔ داشبورد و پنجرهٔ پیامک تکی

const TYPE_LABEL = { volume: 'هشدار حجم', expiry: 'هشدار تاریخ', ended: 'پایان اشتراک', broadcast: 'همگانی', single: 'تکی' };
const STATUS_PILL = {
  sent: '<span class="pill ok">رفته</span>',
  queued: '<span class="pill warn">در صف</span>',
  failed: '<span class="pill danger">ناموفق</span>',
};

function nearMeta(c, st) {
  const parts = [];
  if (st.lowVol) parts.push(`${icon('data', 'i-sm')} ${vol(st.left)} مونده`);
  if (st.lowDays) parts.push(`${icon('calendar', 'i-sm')} ${fa(c.daysLeft)} روز مونده`);
  return parts.map(p => `<span class="hstack" style="gap:4px">${p}</span>`).join('');
}

App.pages.dashboard = async view => {
  const [s, rules, history] = await Promise.all([api.status(), api.rules(), api.history()]);
  // پنل هنوز وصل نشده (نصب تازه) → داشبورد بدون لیست کانفیگ‌ها و یه راهنما
  const clients = s.panel.configured === false ? [] : await api.clients().catch(err => { s.panel.ok = false; s.panel.error = err.message; return []; });
  const rows = clients.map(c => ({ c, st: clientState(c, rules) }));
  const near = rows.filter(r => r.st.near);
  const active = rows.filter(r => !r.st.ended).length;
  const noPhone = clients.filter(c => !c.phone).length;
  const ago = m => (m == null ? '' : m < 1 ? 'همین الان' : `${fa(m)} دقیقه پیش`);
  const pill = (dot, label) => `<span class="pill ${dot === 'danger' ? 'danger' : dot}"><span class="dot ${dot}"></span>${label}</span>`;
  const panelSub = s.panel.configured === false ? 'هنوز وصل نشده؛ از <a href="#/settings">تنظیمات</a> آدرس و رمز پنل رو بده'
    : s.panel.ok === false ? `<span style="color:var(--danger)">${esc(s.panel.error)}</span>`
    : `${s.panel.version ? `نسخهٔ <span class="ltr">${esc(s.panel.version)}</span> · ` : ''}${s.panel.checkedAgo != null ? 'آخرین بررسی ' + ago(s.panel.checkedAgo) : 'در حال بررسی…'}`;
  const phoneSub = !s.phone.configured ? 'هنوز وصل نشده؛ از <a href="#/settings">تنظیمات</a> وصلش کن'
    : s.phone.ok === false ? `<span style="color:var(--danger)">${esc(s.phone.error)}</span>`
    : `${s.phone.device ? esc(s.phone.device) + ' · ' : ''}${s.phone.lastSeenAgo != null ? 'آخرین ارتباط ' + ago(s.phone.lastSeenAgo) : 'در حال بررسی…'}`;

  view.innerHTML = `<div class="stack">
    <div class="grid grid-2">
      <div class="card"><div class="card-head" style="margin:0">
        <span class="ico">${icon('server')}</span>
        <div><h2>پنل ${esc(s.panel.type)}</h2><p>${panelSub}</p></div>
        <span class="spacer"></span>${s.panel.configured === false ? pill('warn', 'تنظیم نشده') : pill(statusDot(s.panel), s.panel.ok === true ? 'وصله' : s.panel.ok === false ? 'قطعه' : 'بررسی')}
      </div></div>
      <div class="card"><div class="card-head" style="margin:0">
        <span class="ico">${icon('mobile')}</span>
        <div><h2>گوشی (خط شخصی)</h2><p>${phoneSub}</p></div>
        <span class="spacer"></span>${pill(s.phone.configured ? statusDot(s.phone) : 'warn', phoneLabel(s.phone))}
      </div></div>
    </div>

    <div class="grid grid-4">
      <div class="card stat"><span class="label">${icon('users', 'i-sm')}کانفیگ‌ها</span><span class="value">${fa(clients.length)}</span><span class="sub">${fa(active)} اشتراک فعال</span></div>
      <div class="card stat"><span class="label">${icon('alert', 'i-sm')}نزدیک اتمام</span><span class="value" style="color:var(--warn)">${fa(near.length)}</span><span class="sub">هشدار خودکار ${rules.enabled ? 'روشنه' : 'خاموشه'}</span></div>
      <div class="card stat"><span class="label">${icon('send', 'i-sm')}پیامک امروز</span><span class="value">${fa(s.smsToday)}</span><span class="sub">از سقف ${fa(s.dailyLimit)} پیامک${s.queued ? ` · ${fa(s.queued)} در صف` : ''}</span></div>
      <div class="card stat"><span class="label">${icon('phone', 'i-sm')}بدون شماره</span><span class="value">${fa(noPhone)}</span><span class="sub"><a href="#/clients?f=nophone">ثبت شماره‌ها</a></span></div>
    </div>

    ${s.panel.configured === false || !s.phone.configured ? `<div class="banner">${icon('settings')}<p>برای شروع، از تنظیمات ${s.panel.configured === false ? 'پنل' : ''}${s.panel.configured === false && !s.phone.configured ? ' و ' : ''}${!s.phone.configured ? 'گوشی' : ''} رو وصل کن.</p><a class="btn btn-sm btn-primary" href="#/settings">تنظیمات</a></div>` : ''}

    ${noPhone ? `<div class="banner">${icon('phone')}<p>${fa(noPhone)} کانفیگ هنوز شماره ندارن و پیامک هشدار براشون نمی‌ره.</p><a class="btn btn-sm btn-primary" href="#/clients?f=nophone">ثبت شماره</a></div>` : ''}

    <div class="card">
      <div class="card-head"><div><h2>نزدیک اتمام</h2><p>کسایی که الان به حد هشدار رسیدن</p></div><span class="spacer"></span><a class="btn btn-sm" href="#/clients?f=near">همه</a></div>
      <div class="list">${near.length ? near.map(({ c, st }) => `
        <div class="list-item">
          <span class="avatar">${esc(initial(c))}</span>
          <div class="main-col">
            <div class="title">${esc(c.account)}${c.name ? ` <span class="muted small">· ${esc(c.name)}</span>` : ''}</div>
            <div class="meta">${nearMeta(c, st)}${c.phone ? phoneHtml(c.phone) : '<span style="color:var(--warn)">بدون شماره</span>'}</div>
          </div>
          ${c.alerted ? `<span class="pill ok">${icon('check')}پیامک رفته</span>`
            : c.phone ? `<button class="btn btn-sm" data-send="${c.id}">${icon('send', 'i-sm')}ارسال</button>`
            : `<button class="btn btn-sm" data-edit="${c.id}">${icon('plus', 'i-sm')}شماره</button>`}
        </div>`).join('') : '<div class="empty">فعلاً کسی نزدیک اتمام نیست.</div>'}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>آخرین پیامک‌ها</h2></div><span class="spacer"></span><a class="btn btn-sm" href="#/history">تاریخچه</a></div>
      <div class="list">${history.slice(0, 4).map(h => `
        <div class="list-item">
          <div class="main-col">
            <div class="title">${esc(h.account)} <span class="pill">${TYPE_LABEL[h.type]}</span></div>
            <div class="meta"><span>${fa(h.at)}</span><span>خط ${fa(h.line)}</span></div>
          </div>
          ${STATUS_PILL[h.status]}
        </div>`).join('')}
      </div>
    </div>
  </div>`;

  bindClientButtons(view, clients);
};

async function openSendOne(c) {
  const templates = await api.templates();
  const st = clientState(c, await api.rules());
  const vars = { name: c.name, account: c.account, left: st.left === Infinity ? null : st.left, days: c.daysLeft };
  const m = openModal(`${modalHead('پیامک به ' + esc(c.account))}
    <div class="stack">
      <div class="hstack small"><span class="muted">گیرنده:</span>${phoneHtml(c.phone)}${c.name ? `<span class="muted">· ${esc(c.name)}</span>` : ''}</div>
      <div class="field"><label>متن آماده</label>
        <select class="select" id="oneTpl"><option value="">متن دلخواه…</option>${templates.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></div>
      <div class="field"><label for="oneText">متن پیامک</label>
        <textarea class="textarea" id="oneText" placeholder="متن پیامک رو بنویس…"></textarea>
        ${ui.varChips('oneText')}${ui.counter('oneText', '')}</div>
      <div class="field"><span class="label">ارسال با</span>${ui.lineSeg('oneLine', 1)}</div>
      <div class="sms-preview"><div class="from">پیش‌نمایش برای این مشتری</div><div class="bubble" id="oneBubble">…</div></div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" id="oneSend">${icon('send')}ارسال</button><button class="btn" data-action="close">انصراف</button></div>`);
  const ta = $('#oneText', m);
  const preview = () => { $('#oneBubble', m).textContent = fillVars(ta.value, vars) || '…'; };
  $('#oneTpl', m).onchange = e => {
    const t = templates.find(x => x.id === Number(e.target.value));
    ta.value = t ? t.text : '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  ta.addEventListener('input', preview);
  $('#oneSend', m).onclick = async e => {
    if (!ta.value.trim()) return toast('اول متن پیامک رو بنویس', 'alert');
    await busy(e.currentTarget, () => api.sendOne(c.email, ta.value, segVal(m, 'oneLine')));
    closeModal();
    toast('پیامک به گوشی فرستاده شد');
  };
}
