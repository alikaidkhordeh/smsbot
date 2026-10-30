// صفحه‌های تاریخچه و تنظیمات

App.pages.history = async view => {
  const items = await api.history();
  const STATUS = [
    { v: 'all', label: 'همه' }, { v: 'sent', label: 'رفته' }, { v: 'queued', label: 'در صف' },
    { v: 'failed', label: 'ناموفق' }, { v: 'skipped', label: 'فرستاده‌نشده' },
  ];
  const H_ICON = { sent: ['ok', 'check'], queued: ['warn', 'clock'], failed: ['danger', 'x'], skipped: ['muted', 'x'] };
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
        <div class="h-text">${esc(h.text)}
          ${h.status === 'queued' && h.wait ? `<div class="small" style="color:var(--warn)">⏳ ${esc(h.wait)}</div>` : ''}
          ${h.error ? `<div class="small" style="color:${h.status === 'skipped' ? 'var(--muted)' : 'var(--danger)'}">${h.status === 'skipped' ? '' : 'علت: '}${esc(h.error)}</div>` : ''}</div>
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
  const bk = s.backup || { telegram: false, chatId: '', time: '03:00' };
  const rp = s.reports || { hourly: true, daily: true, dailyTime: '22:00', health: true };
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
            <span class="hint">هر آدرسی از پنل رو که تو مرورگر باز می‌کنی کپی کن (مثلاً صفحهٔ داشبورد)؛ مسیر درست، http یا https و حتی پورت رو خودش پیدا می‌کنه.</span></div>
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
      <div class="card-head"><span class="ico">${icon('download')}</span><div><h2>پشتیبان</h2><p>شماره‌ها و همهٔ تنظیمات فقط روی همین سرورن؛ پشتیبان داشته باش</p></div></div>
      <div class="stack">
        <div class="hstack wrap">
          <button class="btn" id="bkDown">${icon('download')}دانلود پشتیبان کامل</button>
          <button class="btn" id="bkUp">${icon('refresh')}بازگردانی از پشتیبان</button>
          <button class="btn" id="xlsDown">${icon('text')}خروجی اکسل شماره‌ها</button>
          <input type="file" id="bkFile" accept=".db,.json,application/octet-stream,application/json" hidden>
        </div>
        <p class="hint small muted">پشتیبان کامل همه‌چیز رو داره: اتصال پنل و گوشی، شماره‌ها، متن‌ها و تنظیمات. اگه سرور عوض شد: برنامه رو روی سرور جدید نصب کن، وارد شو و همین فایل رو «بازگردانی» کن؛ بعدش با رمز قبلی وارد می‌شی. اکسل شماره‌ها حتی وقتی پنل در دسترس نیست هم خروجی می‌ده.</p>

        <div class="divider" style="margin:4px 0"></div>
        <div class="setting-row"><div class="txt"><b>ربات تلگرام: پشتیبان خودکار و گزارش‌ها</b><small>فایل پشتیبان، گزارش پیامک‌ها و هشدار قطعی پنل یا گوشی به ربات تلگرامت فرستاده می‌شه.</small></div></div>
        <div class="stack" id="tgBox">
          <div class="sms-preview small" style="border-style:solid">
            <b>ساخت ربات (یک‌باره):</b> تو تلگرام به <b>@BotFather</b> پیام بده ← <span class="ltr">/newbot</span> ← یه اسم بده ← توکنی که می‌ده رو اینجا بذار. بعد ربات جدیدت رو باز کن و <span class="ltr">/start</span> بفرست و «پیدا کردن خودکار» رو بزن. بهتره یه ربات جدید فقط برای پشتیبان بسازی، نه رباتی که برنامهٔ دیگه‌ای باهاش کار می‌کنه.
          </div>
          <div class="form-row two">
            <div class="field"><label for="tgToken">توکن ربات</label><input class="input ltr" id="tgToken" type="password" placeholder="${savedPh(bk.has_token)}" autocomplete="off"></div>
            <div class="field"><label for="tgChat">شناسهٔ چت</label>
              <div class="hstack"><input class="input ltr" id="tgChat" value="${esc(bk.chatId)}" inputmode="numeric" placeholder="123456789" style="flex:1">
                <button class="btn btn-sm" id="tgDetect" type="button">پیدا کردن خودکار</button></div></div>
          </div>
          <div class="field"><span class="label">چی بفرسته؟ (ساعت‌ها به وقت تهران)</span>
            <div class="stack-sm tg-opts">
              <div class="hstack wrap"><label class="check"><input type="checkbox" id="tgOn" ${bk.telegram ? 'checked' : ''}>💾 پشتیبان کامل + اکسل شماره‌ها، هر روز ساعت</label>
                <input class="input" id="tgTime" type="time" value="${esc(bk.time)}" style="width:130px"></div>
              <label class="check"><input type="checkbox" id="rpHourly" ${rp.hourly ? 'checked' : ''}>🔔 گزارش ساعتی (فقط اگه تو اون ساعت پیامکی رفت، نرفت، یا کسی بدون شماره به حد هشدار رسید)</label>
              <div class="hstack wrap"><label class="check"><input type="checkbox" id="rpDaily" ${rp.daily ? 'checked' : ''}>📊 خلاصهٔ روزانه، ساعت</label>
                <input class="input" id="rpTime" type="time" value="${esc(rp.dailyTime)}" style="width:130px"></div>
              <label class="check"><input type="checkbox" id="rpHealth" ${rp.health ? 'checked' : ''}>🔴 هشدار فوری وقتی پنل یا گوشی قطع می‌شه (و وقتی دوباره وصل می‌شه)</label>
            </div></div>
          <div class="small muted">آخرین پشتیبان: ${bk.lastSent ? esc(bk.lastSentText) : 'هنوز فرستاده نشده'}${bk.lastError ? ` · <span style="color:var(--danger)">${esc(bk.lastError)}</span>` : ''}</div>
          <div class="hstack wrap">
            <button class="btn btn-primary" id="tgSave" type="button">${icon('check')}ذخیره</button>
            <button class="btn" id="tgTest" type="button">${icon('send')}پیام آزمایشی</button>
            <button class="btn" id="tgReport" type="button">${icon('history')}گزارش آزمایشی</button>
            <button class="btn" id="tgSend" type="button">${icon('download')}ارسال پشتیبان الان</button>
          </div>
          <div id="tgResult"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="ico">${icon('refresh')}</span><div><h2>آپدیت</h2></div></div>
      <div class="hstack wrap">
        <span class="small muted">نسخهٔ برنامه: <span class="ltr">${esc(s.version)}</span></span>
        <span class="spacer"></span>
        <button class="btn btn-sm" id="updBtn">${icon('download', 'i-sm')}بررسی و نصب آپدیت</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="ico">${icon('history')}</span><div><h2>گزارش برنامه</h2><p>اگه چیزی کار نکرد، اینجا علتش نوشته شده؛ می‌تونی کپی کنی و بفرستی</p></div></div>
      <div class="hstack wrap"><button class="btn btn-sm" id="logBtn">${icon('refresh', 'i-sm')}نمایش گزارش</button>
        <button class="btn btn-sm" id="logCopy" hidden>${icon('copy', 'i-sm')}کپی گزارش</button></div>
      <pre class="log-box" id="logBox" hidden></pre>
    </div>
  </div>`;

  $('#logBtn').onclick = async e => {
    const lines = await busy(e.currentTarget, () => api.logs());
    const box = $('#logBox');
    box.textContent = lines.length ? lines.slice().reverse().join('\n') : 'هنوز گزارشی نیست.';
    box.hidden = false;
    $('#logCopy').hidden = !lines.length;
    $('#logCopy').onclick = () => copyText(box.textContent);
  };

  const showBox = (el, ok, html) => { el.innerHTML = `<div class="result ${ok ? 'ok' : 'danger'}">${icon(ok ? 'check' : 'alert')}${html}</div>`; };
  const panelForm = () => ({
    type: $('#pType').value, url: $('#pUrl').value.trim(), linkHost: $('#pHost').value.trim(),
    auth: segVal(view, 'pAuth') === 'login' ? p.auth : 'token', token: $('#pToken').value.trim(),
  });

  // «تست اتصال» با اطلاعات ذخیره‌شده/توکن کار می‌کنه؛ تو حالت «نام کاربری و رمز» خود دکمهٔ «وصل شو» تست هم می‌کنه
  const syncTestBtn = () => { $('#pTest').hidden = segVal(view, 'pAuth') === 'login' && !p.has_token; };
  syncTestBtn();
  $('.seg[data-name="pAuth"]').addEventListener('change', e => {
    const login = e.currentTarget.dataset.value === 'login';
    $('#pTokenBox').hidden = login;
    $('#pLoginBox').hidden = !login;
    syncTestBtn();
  });
  $('.seg[data-name="phMode"]').addEventListener('change', e => { $('#phUrlBox').hidden = e.currentTarget.dataset.value !== 'private'; });

  $('#pTest').onclick = async e => {
    $('#pResult').innerHTML = '';
    try {
      const r = await busy(e.currentTarget, () => api.testPanel(panelForm()));
      showBox($('#pResult'), true, `وصل شد${r.version ? ` · نسخهٔ <span class="ltr">${esc(r.version)}</span>` : ''} · ${fa(r.clients)} کانفیگ`);
      if (r.url) $('#pUrl').value = r.url;
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
      toast(`به پنل وصل شد · ${fa(r.clients)} کانفیگ · ${r.auth === 'token' ? 'توکن مخصوص برنامه ساخته شد' : 'با نام کاربری و رمز'}`);
      renderTopStatus();
      App.go();  // آدرس تمیزشده و روش اتصال جدید رو نشون بده
    } catch (err) {
      showBox($('#pResult'), false, esc(err.message));
    }
  };

  $('#phTestBtn').onclick = async e => {
    const n = normalizePhone($('#phTest').value);
    if (!n || !phoneOk(n)) return toast(phoneError(n), 'alert');
    const box = $('#phResult');
    box.innerHTML = '';
    let sent;
    try {
      sent = await busy(e.currentTarget, () => api.testPhone(n, Number(segVal(view, 'phDefault'))));
    } catch (err) {
      return showBox(box, false, esc(err.message));
    }
    // پیامک اول به سرور اپ می‌ره، بعد گوشی برش می‌داره و از سیم‌کارت می‌فرسته؛ مرحله‌به‌مرحله دنبالش می‌کنیم
    const STEP = {
      Pending: 'رسید به سرور اپ؛ منتظرم گوشی برش داره…',
      Processed: 'گوشی گرفت و داره از سیم‌کارت می‌فرسته…',
    };
    box.innerHTML = `<div class="result" style="background:var(--info-soft);color:var(--info)">${icon('clock')}رسید به سرور اپ؛ منتظرم گوشی برش داره…</div>`;
    for (let i = 0; i < 20; i++) {
      await wait(3000);
      if (!document.body.contains(box)) return;
      let st;
      try { st = await api.messageState(sent.id); } catch { continue; }
      if (st.status === 'delivered') return showBox(box, true, 'به گیرنده رسید');
      if (st.status === 'sent') return showBox(box, true, 'از سیم‌کارت گوشی فرستاده شد');
      if (st.status === 'failed') return showBox(box, false, 'گوشی نتونست بفرسته: ' + esc(st.error || 'علت نامعلوم'));
      if (STEP[st.raw]) box.querySelector('.result').lastChild.textContent = STEP[st.raw];
    }
    box.innerHTML = `<div class="result danger" style="align-items:flex-start">${icon('alert')}<div>
      گوشی پیامک رو از سرور اپ برنداشت. تو اپ گوشی:<br>
      ۱. دکمهٔ <b>START SERVICE</b> پایین صفحه رو بزن (باید یه اعلان ثابت بیاد).<br>
      ۲. Settings ← Cloud Server ← <b>Notification channel</b> رو بذار <b>SSE Only</b>، اپ رو کامل ببند و دوباره باز کن.<br>
      ۳. بهینه‌سازی باتری اپ رو خاموش کن.<br>
      وضعیت این پیامک تو «تاریخچه» خودکار به‌روز می‌شه.</div></div>`;
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

  $('#bkDown').onclick = e => busy(e.currentTarget, () => api.downloadBackup());
  $('#xlsDown').onclick = e => busy(e.currentTarget, () => api.exportContacts());
  $('#bkUp').onclick = () => $('#bkFile').click();
  $('#bkFile').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.json')) {  // پشتیبان قدیمی (فقط شماره‌ها و متن‌ها)
      let data;
      try { data = JSON.parse(await file.text()); } catch { return toast('فایل پشتیبان خراب یا نامعتبره', 'alert'); }
      if (!await confirmBox({ title: 'بازگردانی از پشتیبان', text: 'شماره‌ها، متن‌ها و قوانین هشدار از فایل برمی‌گردن. ادامه بدم؟' })) return;
      const r = await busy(null, () => api.restore(data));
      return toast(`${fa(r.contacts)} شماره برگشت`);
    }
    if (!await confirmBox({ title: 'بازگردانی پشتیبان کامل', text: 'همهٔ اطلاعات فعلی برنامه (اتصال پنل و گوشی، شماره‌ها، متن‌ها، تنظیمات و رمز ورود) با محتوای این فایل عوض می‌شه. ادامه بدم؟', ok: 'بازگردانی کن', danger: true })) return;
    await busy(null, () => api.restoreDb(file));
    toast('بازگردانی شد؛ اگه رمز فایل پشتیبان فرق داشت، با همون وارد شو');
    setTimeout(() => location.reload(), 2000);
  };

  // پشتیبان خودکار تلگرام
  const tgBox = (ok, html) => showBox($('#tgResult'), ok, html);
  const tgForm = () => ({ telegram: $('#tgOn').checked, token: $('#tgToken').value.trim(), chatId: toEn($('#tgChat').value).trim(), time: $('#tgTime').value });
  const rpForm = () => ({ hourly: $('#rpHourly').checked, daily: $('#rpDaily').checked, dailyTime: $('#rpTime').value, health: $('#rpHealth').checked });
  const saveTg = () => api.saveSettings({ backup: tgForm(), reports: rpForm() });
  $('#tgSave').onclick = async e => {
    await busy(e.currentTarget, saveTg);
    toast('تنظیمات ربات تلگرام ذخیره شد');
  };
  $('#tgReport').onclick = async e => {
    try {
      await busy(e.currentTarget, async () => { await saveTg(); return api.telegramReport(); });
      tgBox(true, 'خلاصهٔ امروز تو تلگرام فرستاده شد');
    } catch (err) { tgBox(false, esc(err.message)); }
  };
  $('#tgDetect').onclick = async e => {
    try {
      const chats = await busy(e.currentTarget, () => api.telegramDetect($('#tgToken').value.trim()));
      $('#tgChat').value = chats[chats.length - 1].id;
      tgBox(true, `پیدا شد: ${esc(chats[chats.length - 1].name)} (<span class="ltr">${esc(chats[chats.length - 1].id)}</span>)؛ ذخیره رو بزن`);
    } catch (err) { tgBox(false, esc(err.message)); }
  };
  $('#tgTest').onclick = async e => {
    try {
      await busy(e.currentTarget, () => api.telegramTest($('#tgToken').value.trim(), toEn($('#tgChat').value).trim()));
      tgBox(true, 'پیام آزمایشی تو تلگرام فرستاده شد');
    } catch (err) { tgBox(false, esc(err.message)); }
  };
  $('#tgSend').onclick = async e => {
    try {
      await busy(e.currentTarget, async () => { await saveTg(); return api.telegramSend(); });
      tgBox(true, 'فایل پشتیبان و اکسل شماره‌ها به تلگرام فرستاده شد');
    } catch (err) { tgBox(false, esc(err.message)); }
  };

  $('#updBtn').onclick = async e => {
    const r = await busy(e.currentTarget, () => api.update());
    if (!r.updated) return toast('برنامه به‌روزه');
    toast('آپدیت نصب شد؛ برنامه چند ثانیه دیگه دوباره بالا میاد');
    setTimeout(() => location.reload(), 7000);
  };
};
