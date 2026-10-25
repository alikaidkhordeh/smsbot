// صفحه‌های تاریخچه و تنظیمات

App.pages.history = async view => {
  const items = await api.history();
  const STATUS = [
    { v: 'all', label: 'همه' }, { v: 'sent', label: 'رفته' }, { v: 'queued', label: 'در صف' }, { v: 'failed', label: 'ناموفق' },
  ];
  const H_ICON = { sent: ['ok', 'check'], queued: ['warn', 'clock'], failed: ['danger', 'x'] };
  const TYPES = { ...TYPE_LABEL, test: 'آزمایشی' };

  view.innerHTML = `<div class="stack">
    <div class="hstack wrap">
      <div class="chips" id="hStatus" data-value="all" style="flex:1">${STATUS.map(s =>
        `<button class="chip ${s.v === 'all' ? 'on' : ''}" data-v="${s.v}">${s.label} <span class="n">${fa(s.v === 'all' ? items.length : items.filter(i => i.status === s.v).length)}</span></button>`).join('')}</div>
      <select class="select" id="hType" style="width:auto"><option value="">همهٔ انواع</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </div>
    <div class="card"><div id="hList"></div></div>
  </div>`;

  const draw = () => {
    const st = $('#hStatus').dataset.value, type = $('#hType').value;
    const shown = items.filter(i => (st === 'all' || i.status === st) && (!type || i.type === type));
    $('#hList').innerHTML = shown.length ? shown.map(h => `
      <div class="history-item">
        <span class="h-ico ${H_ICON[h.status][0]}">${icon(H_ICON[h.status][1])}</span>
        <div class="h-top"><b>${esc(h.account || '—')}</b>${h.phone ? `<span class="small muted">${phoneHtml(h.phone)}</span>` : ''}
          <span class="pill">${TYPES[h.type] || h.type}</span><span class="tiny muted">خط ${fa(h.line)} · ${fa(h.at)}${h.delivered ? ' · تحویل شد' : ''}</span>
          <span class="spacer"></span>${STATUS_PILL[h.status]}${h.status === 'failed' ? `<button class="btn btn-sm" data-retry="${h.id}">ارسال دوباره</button>` : ''}</div>
        <div class="h-text">${esc(h.text)}${h.error ? `<div class="small" style="color:var(--danger)">علت: ${esc(h.error)}</div>` : ''}</div>
      </div>`).join('') : '<div class="empty">پیامکی با این فیلتر نیست.</div>';
  };
  draw();
  $('#hStatus').addEventListener('change', draw);
  $('#hType').addEventListener('change', draw);
  $('#hList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-retry]');
    if (!btn) return;
    await busy(btn, () => api.retry(Number(btn.dataset.retry)));
    toast('دوباره رفت تو صف ارسال');
    App.go();
  });
};

// ───── تنظیمات ─────
App.pages.settings = async view => {
  const s = await api.settings();
  const p = s.panel, ph = s.phone, snd = s.sending, app = s.app;
  const savedPh = (has, text = '•••••••• (ذخیره شده)') => (has ? text : '');
  // هنوز وصل نشده → اول فرم نام کاربری و رمز (راحت‌ترین راه)
  const authTab = p.has_token ? 'token' : 'login';

  view.innerHTML = `<div class="stack" id="setForm">
    <div class="card">
      <div class="card-head"><span class="ico">${icon('server')}</span><div><h2>اتصال به پنل</h2><p>برنامه از اینجا کانفیگ‌ها رو می‌خونه و می‌سازه</p></div></div>
      <div class="stack">
        <div class="form-row two">
          <div class="field"><label for="pType">نوع پنل</label>
            <select class="select" id="pType"><option value="3x-ui">3X-UI (نسخهٔ ۳ به بعد)</option><option disabled>پاسارگاد (به‌زودی)</option></select></div>
          <div class="field"><label for="pUrl">آدرس کامل پنل</label><input class="input ltr" id="pUrl" value="${esc(p.url)}" spellcheck="false" placeholder="https://panel.example.com:2053/abc123/">
            <span class="hint">همون آدرسی که پنل رو تو مرورگر باهاش باز می‌کنی (با http یا https، پورت و مسیر). اگه برنامه روی خود سرور پنله: http://127.0.0.1:پورت/مسیر/</span></div>
        </div>
        <div class="field"><label for="pHost">آدرس سرور برای لینک‌ها <span class="muted">(اختیاری)</span></label>
          <input class="input ltr" id="pHost" value="${esc(p.linkHost)}" spellcheck="false" placeholder="sv1.example.com">
          <span class="hint">دامنه یا آی‌پی‌ای که تو لینک کانفیگ‌ها میاد. خالی بذاری، همون آدرس پنل استفاده می‌شه (مثل خود پنل).</span></div>
        <div class="field"><span class="label">روش اتصال</span>${ui.seg('pAuth', [{ v: 'login', label: 'نام کاربری و رمز پنل' }, { v: 'token', label: 'توکن API' }], authTab)}</div>
        <div class="stack" id="pTokenBox" ${authTab === 'login' ? 'hidden' : ''}>
          <div class="field"><label for="pToken">توکن API</label>
            <input class="input ltr" id="pToken" type="password" placeholder="${savedPh(p.has_token)}" autocomplete="off">
            <span class="hint">از پنل: تنظیمات ← امنیت ← API Token. خالی بذاری، همون قبلی می‌مونه.</span></div>
        </div>
        <div class="stack" id="pLoginBox" ${authTab === 'login' ? '' : 'hidden'}>
          <p class="small muted">یک بار با نام کاربری و رمز پنل وارد می‌شم و یه توکن مخصوص این برنامه می‌سازم؛ رمز پنل ذخیره نمی‌شه.</p>
          <div class="form-row two">
            <div class="field"><label for="pUser">نام کاربری پنل</label><input class="input ltr" id="pUser" autocomplete="off"></div>
            <div class="field"><label for="pPass">رمز پنل</label><input class="input ltr" id="pPass" type="password" autocomplete="new-password"></div>
          </div>
          <div class="field"><label for="p2fa">کد ورود دومرحله‌ای <span class="muted">(فقط اگه روشنه)</span></label><input class="input ltr" id="p2fa" inputmode="numeric" style="max-width:180px"></div>
          <div><button class="btn btn-primary" id="pConnect">${icon('lock')}وصل شو و توکن بساز</button></div>
        </div>
        <div class="hstack wrap"><button class="btn" id="pTest">${icon('refresh')}تست اتصال</button><div id="pResult"></div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="ico">${icon('mobile')}</span><div><h2>اتصال گوشی</h2><p>پیامک‌ها از سیم‌کارت خود گوشیت فرستاده می‌شن</p></div></div>
      <div class="stack">
        <div class="sms-preview small" style="border-style:solid">
          <b>راه‌اندازی یک‌باره:</b> اپ <b>SMS Gateway for Android</b> رو از سایت sms-gate.app روی گوشی نصب کن ← اجازهٔ پیامک بده ← تو صفحهٔ اول «Cloud Server» رو روشن کن ← نام کاربری و رمزی که نشون می‌ده رو اینجا وارد کن. بهینه‌سازی باتری اپ رو هم خاموش کن.
        </div>
        <div class="field"><span class="label">روش اتصال</span>${ui.seg('phMode', [{ v: 'cloud', label: 'سرور ابری اپ' }, { v: 'private', label: 'سرور شخصی' }], ph.mode)}</div>
        <div class="field" id="phUrlBox" ${ph.mode === 'private' ? '' : 'hidden'}><label for="phUrl">آدرس سرور شخصی</label>
          <input class="input ltr" id="phUrl" value="${esc(ph.mode === 'private' ? ph.url : '')}" placeholder="https://sms.example.com/api/3rdparty/v1" spellcheck="false"></div>
        <div class="form-row two">
          <div class="field"><label for="phUser">نام کاربری (از اپ)</label><input class="input ltr" id="phUser" value="${esc(ph.username)}" autocomplete="off"></div>
          <div class="field"><label for="phPass">رمز (از اپ)</label><input class="input ltr" id="phPass" type="password" placeholder="${savedPh(ph.has_password)}" autocomplete="new-password"></div>
        </div>
        <div class="form-row two">
          <div class="field"><label for="line1">اسم خط ۱</label><input class="input" id="line1" value="${esc(ph.line1)}" placeholder="مثلاً همراه اول"></div>
          <div class="field"><label for="line2">اسم خط ۲</label><input class="input" id="line2" value="${esc(ph.line2)}" placeholder="مثلاً ایرانسل"></div>
        </div>
        <div class="field"><span class="label">خط پیش‌فرض</span>${ui.lineSeg('phDefault', ph.defaultLine)}</div>
        <div class="divider" style="margin:4px 0"></div>
        <div class="field"><label for="phTest">پیامک آزمایشی <span class="muted">(اول تنظیمات رو ذخیره کن)</span></label>
          <div class="hstack wrap"><input class="input ltr" id="phTest" inputmode="tel" placeholder="09xxxxxxxxx" style="max-width:220px">
            <button class="btn" id="phTestBtn">${icon('send')}ارسال آزمایشی</button><div id="phResult"></div></div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="ico">${icon('clock')}</span><div><h2>قوانین ارسال</h2><p>برای پیامک‌های خودکار و همگانی (به وقت تهران)</p></div></div>
      <div class="stack">
        <div class="field"><span class="label">ساعت مجاز ارسال</span>
          <div class="inline-num">از <input class="input" id="sFrom" type="time" value="${esc(snd.from)}" style="width:120px"> تا <input class="input" id="sTo" type="time" value="${esc(snd.to)}" style="width:120px"></div>
          <span class="hint">بیرون از این ساعت پیامک‌ها صبر می‌کنن و اول وقت بعدی فرستاده می‌شن. پیامک تکی و آزمایشی همون لحظه می‌رن.</span></div>
        <div class="form-row two">
          <div class="field"><label>فاصلهٔ بین پیامک‌ها</label><div class="inline-num"><input class="input" id="sGap" inputmode="numeric" value="${fa(snd.gapSec)}"> ثانیه</div>
            <span class="hint">فاصله باعث می‌شه اپراتور خطت رو به‌خاطر ارسال زیاد محدود نکنه.</span></div>
          <div class="field"><label>سقف روزانه</label><div class="inline-num"><input class="input" id="sLimit" inputmode="numeric" value="${fa(snd.dailyLimit)}"> پیامک در روز</div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="ico">${icon('globe')}</span><div><h2>آدرس برنامه</h2><p>اگه دامنه یا پورت عوض شد، از همین‌جا</p></div></div>
      <div class="stack">
        <div class="form-row two">
          <div class="field"><label for="aAddr">دامنهٔ برنامه <span class="muted">(اختیاری)</span></label><input class="input ltr" id="aAddr" value="${esc(app.address)}" spellcheck="false" placeholder="sms.example.com"></div>
          <div class="field"><label for="aPort">پورت</label><input class="input ltr" id="aPort" inputmode="numeric" value="${esc(app.port)}"></div>
        </div>
        <div class="form-row two">
          <div class="field"><label for="aCert">مسیر گواهی SSL <span class="muted">(برای https)</span></label><input class="input ltr" id="aCert" value="${esc(app.cert)}" spellcheck="false" placeholder="/root/cert/.../fullchain.pem"></div>
          <div class="field"><label for="aKey">مسیر کلید گواهی</label><input class="input ltr" id="aKey" value="${esc(app.key)}" spellcheck="false" placeholder="/root/cert/.../privkey.pem"></div>
        </div>
        <div class="hstack wrap"><button class="btn btn-sm" id="aUseCert">${icon('lock', 'i-sm')}استفاده از گواهی پنل</button>
          <span class="small muted">با تغییر پورت یا گواهی، برنامه خودش دوباره راه‌اندازی می‌شه.</span></div>
        <div class="sms-preview small" style="border-style:solid">
          <b>نصب روی گوشی مثل برنامه (بدون نوار آدرس):</b> برنامه باید با <b>https</b> باز بشه. راحت‌ترین راه کلادفلره:
          یه رکورد DNS برای دامنه (مثلاً sms.yourdomain.com) به آی‌پی همین سرور با ابر نارنجی، حالت SSL «Flexible»
          و پورت برنامه یکی از پورت‌های ۸۴۴۳، ۲۰۸۳، ۲۰۸۷، ۲۰۵۳، ۲۰۹۶ یا ۴۴۳ (نصب‌کننده خودش یکی‌شون رو گذاشته).
          بعد آدرس https رو تو Chrome گوشی باز کن ← منوی ⋮ ← «نصب برنامه» (یا گزینهٔ «نصب به‌صورت برنامه» تو منوی همین برنامه).
        </div>
      </div>
    </div>

    <div><button class="btn btn-primary" id="saveSet">${icon('check')}ذخیرهٔ تنظیمات</button></div>

    <div class="card">
      <div class="card-head"><span class="ico">${icon('lock')}</span><div><h2>رمز ورود برنامه</h2></div></div>
      <div class="form-row two">
        <div class="field"><label for="aOld">رمز فعلی</label><input class="input ltr" id="aOld" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="aNew">رمز جدید</label><input class="input ltr" id="aNew" type="password" autocomplete="new-password"></div>
      </div>
      <div class="mt"><button class="btn" id="aPassBtn">${icon('check')}تغییر رمز</button></div>
    </div>

    <div class="card">
      <div class="card-head"><span class="ico">${icon('download')}</span><div><h2>پشتیبان و آپدیت</h2><p>شماره‌ها فقط تو این برنامه‌ان؛ هر از گاهی پشتیبان بگیر</p></div></div>
      <div class="hstack wrap">
        <button class="btn" id="bkDown">${icon('download')}دانلود پشتیبان</button>
        <button class="btn" id="bkUp">${icon('refresh')}بازگردانی از پشتیبان</button>
        <input type="file" id="bkFile" accept="application/json,.json" hidden>
        <span class="spacer"></span>
        <span class="small muted">نسخهٔ برنامه: <span class="ltr">${esc(s.version)}</span></span>
        <button class="btn btn-sm" id="updBtn">${icon('download', 'i-sm')}بررسی و نصب آپدیت</button>
      </div>
    </div>
  </div>`;

  const showBox = (el, ok, html) => { el.innerHTML = `<div class="result ${ok ? 'ok' : 'danger'}">${icon(ok ? 'check' : 'alert')}${html}</div>`; };
  const panelForm = () => ({
    type: $('#pType').value, url: $('#pUrl').value.trim(), linkHost: $('#pHost').value.trim(),
    auth: segVal(view, 'pAuth') === 'login' ? p.auth : 'token', token: $('#pToken').value.trim(),
  });

  $('.seg[data-name="pAuth"]').addEventListener('change', e => {
    const login = e.currentTarget.dataset.value === 'login';
    $('#pTokenBox').hidden = login;
    $('#pLoginBox').hidden = !login;
  });
  $('.seg[data-name="phMode"]').addEventListener('change', e => { $('#phUrlBox').hidden = e.currentTarget.dataset.value !== 'private'; });

  $('#pTest').onclick = async e => {
    $('#pResult').innerHTML = '';
    try {
      const r = await busy(e.currentTarget, () => api.testPanel(panelForm()));
      showBox($('#pResult'), true, `وصل شد${r.version ? ` · نسخهٔ <span class="ltr">${esc(r.version)}</span>` : ''} · ${fa(r.clients)} کانفیگ`);
      if (!$('#pHost').value && r.linkHost) $('#pHost').value = r.linkHost;
    } catch (err) {
      showBox($('#pResult'), false, esc(err.message));
    }
  };
  $('#pConnect').onclick = async e => {
    $('#pResult').innerHTML = '';
    try {
      const r = await busy(e.currentTarget, () => api.connectPanel({
        url: $('#pUrl').value.trim(), username: $('#pUser').value.trim(), password: $('#pPass').value, twoFactorCode: $('#p2fa').value.trim(),
      }));
      showBox($('#pResult'), true, `وصل شد · ${fa(r.clients)} کانفیگ · ${r.auth === 'token' ? 'توکن مخصوص برنامه ساخته شد' : 'با نام کاربری و رمز'}`);
      toast('به پنل وصل شد');
      renderTopStatus();
    } catch (err) {
      showBox($('#pResult'), false, esc(err.message));
    }
  };

  $('#phTestBtn').onclick = async e => {
    const n = toEn($('#phTest').value).replace(/\s/g, '');
    if (!/^09\d{9}$/.test(n)) return toast('شمارهٔ درست وارد کن', 'alert');
    $('#phResult').innerHTML = '';
    try {
      await busy(e.currentTarget, () => api.testPhone(n, Number(segVal(view, 'phDefault'))));
      showBox($('#phResult'), true, 'به گوشی رسید؛ چند ثانیه دیگه پیامک می‌رسه');
    } catch (err) {
      showBox($('#phResult'), false, esc(err.message));
    }
  };

  $('#aUseCert').onclick = async e => {
    const r = await busy(e.currentTarget, () => api.panelCerts());
    if (!r.cert) return toast('پنل گواهی SSL نداره', 'alert');
    $('#aCert').value = r.cert;
    $('#aKey').value = r.key;
    if (!$('#aAddr').value && r.domain) $('#aAddr').value = r.domain;
    toast('مسیر گواهی پنل گذاشته شد؛ ذخیره رو بزن');
  };

  $('#saveSet').onclick = async e => {
    const next = {
      panel: panelForm(),
      phone: {
        mode: segVal(view, 'phMode'), url: segVal(view, 'phMode') === 'private' ? $('#phUrl').value.trim() : 'https://api.sms-gate.app/3rdparty/v1',
        username: $('#phUser').value.trim(), password: $('#phPass').value,
        line1: $('#line1').value.trim(), line2: $('#line2').value.trim(), defaultLine: Number(segVal(view, 'phDefault')),
      },
      sending: { from: $('#sFrom').value, to: $('#sTo').value, gapSec: Number(toEn($('#sGap').value)) || 20, dailyLimit: Number(toEn($('#sLimit').value)) || 50 },
      app: { address: $('#aAddr').value.trim(), port: Number(toEn($('#aPort').value)) || app.port, cert: $('#aCert').value.trim(), key: $('#aKey').value.trim() },
    };
    const r = await busy(e.currentTarget, () => api.saveSettings(next));
    App.lines = [next.phone.line1, next.phone.line2];
    renderTopStatus();
    if (!r.restart) return toast('تنظیمات ذخیره شد');
    const https = next.app.cert && next.app.key;
    const url = `${https ? 'https' : 'http'}://${next.app.address || location.hostname}:${next.app.port}/`;
    toast('ذخیره شد؛ برنامه داره با آدرس جدید راه‌اندازی می‌شه…');
    setTimeout(() => { location.href = url; }, 5000);
  };

  $('#aPassBtn').onclick = async e => {
    if ($('#aNew').value.length < 6) return toast('رمز جدید حداقل ۶ حرف باشه', 'alert');
    await busy(e.currentTarget, () => api.changePassword($('#aOld').value, $('#aNew').value));
    $('#aOld').value = $('#aNew').value = '';
    toast('رمز عوض شد');
  };

  $('#bkDown').onclick = async e => {
    const data = await busy(e.currentTarget, () => api.backup());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `smsbot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#bkUp').onclick = () => $('#bkFile').click();
  $('#bkFile').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('فایل پشتیبان خراب یا نامعتبره', 'alert'); }
    if (!await confirmBox({ title: 'بازگردانی از پشتیبان', text: 'شماره‌ها، متن‌ها و قوانین هشدار از فایل برمی‌گردن. ادامه بدم؟' })) return;
    const r = await busy(null, () => api.restore(data));
    toast(`${fa(r.contacts)} شماره برگشت`);
  };

  $('#updBtn').onclick = async e => {
    const r = await busy(e.currentTarget, () => api.update());
    if (!r.updated) return toast('برنامه به‌روزه');
    toast('آپدیت نصب شد؛ برنامه چند ثانیه دیگه دوباره بالا میاد');
    setTimeout(() => location.reload(), 7000);
  };
};
