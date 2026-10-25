// صفحه‌های هشدار خودکار، پیام همگانی و متن‌ها

const RULES_META = {
  volume: { icon: 'data', title: 'هشدار حجم', desc: 'وقتی حجم مشتری داره تموم می‌شه', sample: { ...SAMPLE, days: null } },
  expiry: { icon: 'calendar', title: 'هشدار تاریخ', desc: 'وقتی چند روز تا پایان اشتراک مونده', sample: { ...SAMPLE, left: null } },
  ended: { icon: 'alert', title: 'پیام پایان اشتراک', desc: 'وقتی حجم یا تاریخ اشتراک تموم شد', sample: SAMPLE },
};

function ruleWhen(key, r) {
  if (key === 'volume') return `<div class="inline-num">وقتی حجم باقی‌مونده
    <input class="input" name="amount" inputmode="decimal" value="${fa(r.amount)}">
    <select class="select" name="unit"><option value="GB" ${r.unit === 'GB' ? 'selected' : ''}>گیگ</option><option value="MB" ${r.unit === 'MB' ? 'selected' : ''}>مگ</option></select>
    یا کمتر شد</div>`;
  if (key === 'expiry') return `<div class="inline-num">وقتی
    <input class="input" name="days" inputmode="numeric" value="${fa(r.days)}">
    روز یا کمتر تا پایان اشتراک مونده</div>
    <span class="hint">اکانت‌هایی که تاریخ ندارن این هشدار رو نمی‌گیرن.</span>`;
  return `<p class="small muted">بلافاصله بعد از تموم شدن حجم یا تاریخ، یک بار فرستاده می‌شه.</p>`;
}

App.pages.alerts = async view => {
  const [rules, templates] = await Promise.all([api.rules(), api.templates()]);
  const tplText = id => templates.find(t => t.id === Number(id))?.text || '';

  view.innerHTML = `<div class="stack" id="rulesForm">
    <div class="card">
      <div class="setting-row">
        <div class="txt"><b>هشدار خودکار</b><small>برنامه مرتب پنل رو چک می‌کنه و به هر مشتری که به حد هشدار برسه، یک بار پیامک می‌ده. بعد از تمدید دوباره فعال می‌شه.</small></div>
        ${ui.switch('enabled', rules.enabled)}
      </div>
      <div class="divider"></div>
      <div class="setting-row">
        <div class="txt"><b>هر چند وقت پنل چک بشه؟</b></div>
        <select class="select" name="interval" style="width:auto">${[5, 10, 15, 30, 60].map(n =>
          `<option value="${n}" ${n === rules.intervalMin ? 'selected' : ''}>هر ${fa(n)} دقیقه</option>`).join('')}</select>
      </div>
    </div>

    ${Object.entries(RULES_META).map(([key, meta]) => {
      const r = rules[key];
      return `<div class="card rule-card ${r.on ? '' : 'off'}" data-rule="${key}">
        <div class="card-head"><span class="ico">${icon(meta.icon)}</span><div><h2>${meta.title}</h2><p>${meta.desc}</p></div>
          <span class="spacer"></span>${ui.switch('on', r.on)}</div>
        <div class="rule-body stack">
          <div class="field"><span class="label">چه زمانی؟</span>${ruleWhen(key, r)}</div>
          <div class="form-row two">
            <div class="field"><label>متن پیامک</label>${ui.templateSelect('tpl', templates, r.templateId)}<a class="tiny" href="#/templates">ویرایش متن‌ها</a></div>
            <div class="field"><span class="label">ارسال با</span>${ui.lineSeg('line', r.line)}</div>
          </div>
          <div class="sms-preview"><div class="from">نمونهٔ پیامکی که مشتری می‌گیره</div><div class="bubble" data-preview>${esc(fillVars(tplText(r.templateId), meta.sample))}</div></div>
        </div>
      </div>`;
    }).join('')}

    <div class="hstack wrap"><button class="btn btn-primary" id="saveRules">${icon('check')}ذخیرهٔ تغییرات</button>
      <span class="muted small">پیامک‌ها فقط در ساعت مجاز ارسال (از تنظیمات) فرستاده می‌شن.</span></div>
  </div>`;

  $$('.rule-card', view).forEach(card => {
    const meta = RULES_META[card.dataset.rule];
    $('[name="on"]', card).addEventListener('change', e => card.classList.toggle('off', !e.target.checked));
    $('[name="tpl"]', card).addEventListener('change', e => {
      $('[data-preview]', card).textContent = fillVars(tplText(e.target.value), meta.sample);
    });
  });

  $('#saveRules').onclick = async e => {
    const form = $('#rulesForm');
    const next = { enabled: $('[name="enabled"]', form).checked, intervalMin: Number($('[name="interval"]', form).value) };
    $$('.rule-card', form).forEach(card => {
      const key = card.dataset.rule;
      next[key] = { ...rules[key], on: $('[name="on"]', card).checked, templateId: Number($('[name="tpl"]', card).value), line: Number(segVal(card, 'line')) };
      if (key === 'volume') Object.assign(next[key], { amount: Number(toEn($('[name="amount"]', card).value)) || 1, unit: $('[name="unit"]', card).value });
      if (key === 'expiry') next[key].days = Number(toEn($('[name="days"]', card).value)) || 2;
    });
    await busy(e.currentTarget, () => api.saveRules(next));
    toast('تنظیمات هشدار ذخیره شد');
  };
};

// ───── پیام همگانی ─────
App.pages.broadcast = async view => {
  const [clients, rules, templates, broadcasts, settings] = await Promise.all([api.clients(), api.rules(), api.templates(), api.broadcasts(), api.settings()]);
  const rows = clients.filter(c => c.phone).map(c => ({ c, st: clientState(c, rules) }));
  const groups = [
    { v: 'all', label: 'همهٔ مشتری‌هایی که شماره دارن', hint: 'برای اطلاعیه‌های عمومی', list: rows },
    { v: 'active', label: 'فقط اشتراک‌های فعال', hint: 'مثلاً خبر تغییر سرور', list: rows.filter(r => !r.st.ended && !r.st.off) },
    { v: 'ended', label: 'فقط اشتراک‌های تموم‌شده', hint: 'برای دعوت به تمدید و تخفیف', list: rows.filter(r => r.st.ended) },
    { v: 'pick', label: 'انتخاب دستی', hint: 'خودت از لیست انتخاب کن', list: [] },
  ];
  let picked = new Set();
  const count = () => (groups.find(g => g.v === $('#grp').dataset.value).v === 'pick' ? picked.size : groups.find(g => g.v === $('#grp').dataset.value).list.length);

  view.innerHTML = `<div class="stack">
    <div class="card">
      <div class="card-head"><span class="ico">${icon('mega')}</span><div><h2>پیام جدید</h2><p>از خط خودت و با فاصله بین پیامک‌ها فرستاده می‌شه.</p></div></div>
      <div class="stack">
        <div class="field"><span class="label">۱. به کی بفرستیم؟</span>
          <div class="choice-list" id="grp" data-value="all">${groups.map(g => `
            <button type="button" class="choice ${g.v === 'all' ? 'on' : ''}" data-v="${g.v}"><span class="radio"></span>
              <span><b>${g.label}</b><small>${g.hint}</small></span><span class="num" ${g.v === 'pick' ? 'id="pickNum"' : ''}>${g.v === 'pick' ? '' : fa(g.list.length)}</span></button>`).join('')}
          </div></div>
        <div class="field"><label for="bText">۲. متن پیام</label>
          <select class="select" id="bTpl"><option value="">از متن‌های آماده انتخاب کن…</option>${templates.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select>
          <textarea class="textarea" id="bText" placeholder="متن پیام همگانی…"></textarea>
          ${ui.varChips('bText')}${ui.counter('bText', '')}</div>
        <div class="form-row two">
          <div class="field"><span class="label">۳. با کدوم خط؟</span>${ui.lineSeg('bLine', settings.phone.defaultLine)}</div>
          <div class="field"><span class="label">۴. کی بفرستیم؟</span>
            ${ui.seg('bWhen', [{ v: 'now', label: 'همین الان' }, { v: 'later', label: 'زمان‌بندی' }], 'now')}
            <div class="hstack" id="bAt" hidden>
              <select class="select" id="bDay"><option>امروز</option><option>فردا</option><option>پس‌فردا</option></select>
              <input class="input" id="bTime" type="time" value="20:00" style="width:130px">
            </div></div>
        </div>
        <div class="banner" id="bSummary"></div>
        <div><button class="btn btn-primary" id="bSend">${icon('send')}ارسال پیام</button></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>پیام‌های همگانی قبلی</h2></div></div>
      <div class="list">${broadcasts.map(b => {
        const pct = b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0;
        const pill = b.status === 'done' ? '<span class="pill ok">تموم شد</span>'
          : b.status === 'cancelled' ? '<span class="pill">لغو شد</span>'
          : b.status === 'scheduled' ? '<span class="pill info">زمان‌بندی‌شده</span>' : '<span class="pill warn">در حال ارسال</span>';
        return `<div class="list-item"><div class="main-col">
          <div class="title">${esc(b.title)}</div>
          <div class="meta"><span>${fa(b.at)}</span><span>خط ${fa(b.line)}</span><span>${fa(b.total)} نفر</span>${b.status === 'done' ? `<span>${fa(b.sent)} رفته</span>${b.failed ? `<span style="color:var(--danger)">${fa(b.failed)} ناموفق</span>` : ''}` : ''}</div>
          ${b.status !== 'scheduled' ? `<div class="progress ok mt-s"><span style="width:${pct}%"></span></div>` : ''}
        </div>${pill}${b.status === 'scheduled' || b.status === 'sending' ? `<button class="btn btn-sm btn-ghost" data-cancel="${b.id}">لغو</button>` : ''}</div>`;
      }).join('')}</div>
    </div>
  </div>`;

  const summary = () => {
    const n = count();
    const parts = Math.max(1, smsInfo(fillVars($('#bText').value, SAMPLE)).parts);
    const minutes = Math.ceil((n * settings.sending.gapSec) / 60);
    const over = n * parts > settings.sending.dailyLimit;
    $('#bSummary').innerHTML = `${icon('clock')}<p>${fa(n)} نفر × ${fa(parts)} پیامک = <b>${fa(n * parts)} پیامک</b> · حدود ${fa(minutes)} دقیقه طول می‌کشه (هر ${fa(settings.sending.gapSec)} ثانیه یکی)${over ? ` · <span style="color:var(--warn)">بیشتر از سقف روزانه (${fa(settings.sending.dailyLimit)})؛ بقیه فردا فرستاده می‌شه</span>` : ''}</p>`;
  };
  summary();

  $('#grp').addEventListener('change', () => {
    if ($('#grp').dataset.value === 'pick') openPicker(rows, picked, set => { picked = set; $('#pickNum').textContent = fa(set.size); summary(); });
    summary();
  });
  $('#bText').addEventListener('input', summary);
  $('#bTpl').onchange = e => {
    const t = templates.find(x => x.id === Number(e.target.value));
    $('#bText').value = t ? t.text : '';
    $('#bText').dispatchEvent(new Event('input', { bubbles: true }));
  };
  $('.seg[data-name="bWhen"]').addEventListener('change', e => { $('#bAt').hidden = e.currentTarget.dataset.value !== 'later'; });
  $$('[data-cancel]', view).forEach(b => b.onclick = async () => {
    if (!await confirmBox({ title: 'لغو پیام همگانی', text: 'پیامک‌هایی که هنوز نرفتن، فرستاده نمی‌شن. مطمئنی؟', ok: 'لغو کن', danger: true })) return;
    await busy(null, () => api.cancelBroadcast(Number(b.dataset.cancel)));
    toast('پیام لغو شد');
    App.go();
  });

  $('#bSend').onclick = async e => {
    const text = $('#bText').value.trim();
    const n = count();
    if (!text) return toast('اول متن پیام رو بنویس', 'alert');
    if (!n) return toast('هیچ گیرنده‌ای انتخاب نشده', 'alert');
    const later = segVal(view, 'bWhen') === 'later';
    const when = later ? `${$('#bDay').value} ${fa($('#bTime').value)}` : '';
    const sendAt = later ? tehranTimestamp($('#bDay').selectedIndex, $('#bTime').value) : 0;
    if (later && sendAt < Date.now()) return toast('این ساعت گذشته؛ یه زمان بعد از الان انتخاب کن', 'alert');
    const ok = await confirmBox({
      title: 'ارسال پیام همگانی',
      text: `${fa(n)} پیامک از <b>خط ${fa(segVal(view, 'bLine'))}</b> ${later ? 'در زمان ' + when : 'همین الان'} فرستاده بشه؟`,
      ok: 'بله، بفرست',
    });
    if (!ok) return;
    const group = $('#grp').dataset.value;
    const emails = group === 'pick'
      ? rows.filter(r => picked.has(r.c.id)).map(r => r.c.email)
      : groups.find(g => g.v === group).list.map(r => r.c.email);
    const title = templates.find(t => t.id === Number($('#bTpl').value))?.title || text.slice(0, 24) + '…';
    const r = await busy(e.currentTarget, () => api.sendBroadcast({ title, text, emails, line: Number(segVal(view, 'bLine')), sendAt }));
    toast(later ? `${fa(r.count)} پیامک زمان‌بندی شد` : `${fa(r.count)} پیامک رفت تو صف ارسال`);
    App.go();
  };
};

// روز (۰ امروز، ۱ فردا، …) و ساعت به وقت تهران → زمان دقیق (میلی‌ثانیه)، مستقل از ساعت گوشی
function tehranTimestamp(dayOffset, hhmm) {
  const [h, mi] = hhmm.split(':').map(Number);
  const off = 210 * 60000;
  const t = new Date(Date.now() + off);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + dayOffset, h, mi) - off;
}

function openPicker(rows, picked, done) {
  const m = openModal(`${modalHead('انتخاب گیرنده‌ها')}
    <div class="input-group">${icon('search')}<input class="input" id="pq" placeholder="جستجو"></div>
    <div class="list mt" id="plist" style="max-height:50vh;overflow:auto">${rows.map(({ c }) => `
      <label class="list-item" style="cursor:pointer"><input type="checkbox" value="${c.id}" ${picked.has(c.id) ? 'checked' : ''} style="width:18px;height:18px">
        <div class="main-col"><div class="title">${esc(c.account)} ${c.name ? `<span class="muted small">· ${esc(c.name)}</span>` : ''}</div><div class="meta">${phoneHtml(c.phone)}</div></div></label>`).join('')}
    </div>
    <div class="modal-foot"><button class="btn btn-primary" id="pDone">تأیید</button><button class="btn" data-action="close">انصراف</button></div>`);
  $('#pq', m).oninput = e => {
    const q = toEn(e.target.value).toLowerCase();
    $$('#plist label', m).forEach(l => { l.hidden = !toEn(l.textContent).toLowerCase().includes(q); });
  };
  $('#pDone', m).onclick = () => {
    done(new Set($$('#plist input:checked', m).map(i => Number(i.value))));
    closeModal();
  };
}

// ───── متن‌ها ─────
App.pages.templates = async view => {
  const [templates, rules] = await Promise.all([api.templates(), api.rules()]);
  const usedBy = id => Object.entries(RULES_META).filter(([k]) => rules[k].templateId === id).map(([, m]) => m.title);

  view.innerHTML = `<div class="stack">
    <div class="banner">${icon('text')}<p>متن‌ها رو یک بار اینجا بنویس و توی هشدارها و پیام همگانی ازشون استفاده کن. جاهای خالی مثل <b>{اسم}</b> و <b>{حجم}</b> موقع ارسال با اطلاعات هر مشتری پر می‌شن.</p></div>
    <div><button class="btn btn-primary" id="newTpl">${icon('plus')}متن جدید</button></div>
    <div class="grid grid-2">${templates.map(t => {
      const used = usedBy(t.id);
      return `<div class="card stack-sm">
        <div class="hstack"><h3 style="font-size:15.5px;flex:1">${esc(t.title)}</h3>
          <button class="icon-btn sm" data-edit-tpl="${t.id}" aria-label="ویرایش">${icon('edit', 'i-sm')}</button>
          <button class="icon-btn sm" data-del-tpl="${t.id}" aria-label="حذف">${icon('trash', 'i-sm')}</button></div>
        <p style="color:var(--text-2);font-size:14px">${esc(t.text)}</p>
        <div class="hstack wrap">${used.map(u => `<span class="pill primary">${icon('bell')}${u}</span>`).join('')}
          <span class="spacer"></span><span class="tiny muted">${fa(smsInfo(fillVars(t.text, SAMPLE)).len)} حرف · ${fa(smsInfo(fillVars(t.text, SAMPLE)).parts)} پیامک</span></div>
      </div>`;
    }).join('')}</div>
  </div>`;

  $('#newTpl').onclick = () => openTemplateEdit({ title: '', text: '' });
  view.firstElementChild.addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-tpl]');
    const del = e.target.closest('[data-del-tpl]');
    if (ed) openTemplateEdit(templates.find(t => t.id === Number(ed.dataset.editTpl)));
    if (del) {
      const id = Number(del.dataset.delTpl);
      if (usedBy(id).length) return toast('این متن تو هشدارها استفاده شده؛ اول اونجا عوضش کن', 'alert');
      if (await confirmBox({ title: 'حذف متن', text: 'این متن حذف بشه؟', ok: 'حذف', danger: true })) {
        await api.deleteTemplate(id);
        toast('حذف شد');
        App.go();
      }
    }
  });
};

function openTemplateEdit(t) {
  const m = openModal(`${modalHead(t.id ? 'ویرایش متن' : 'متن جدید')}
    <div class="stack">
      <div class="field"><label for="tTitle">اسم متن</label><input class="input" id="tTitle" value="${esc(t.title)}" placeholder="مثلاً تخفیف یلدا"></div>
      <div class="field"><label for="tText">متن پیامک</label>
        <textarea class="textarea" id="tText">${esc(t.text)}</textarea>${ui.varChips('tText')}${ui.counter('tText', t.text)}</div>
      <div class="sms-preview"><div class="from">پیش‌نمایش با اطلاعات نمونه</div><div class="bubble" id="tBubble">${esc(fillVars(t.text, SAMPLE)) || '…'}</div></div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" id="tSave">${icon('check')}ذخیره</button><button class="btn" data-action="close">انصراف</button></div>`);
  $('#tText', m).addEventListener('input', e => { $('#tBubble', m).textContent = fillVars(e.target.value, SAMPLE) || '…'; });
  $('#tSave', m).onclick = async () => {
    const title = $('#tTitle', m).value.trim(), text = $('#tText', m).value.trim();
    if (!title || !text) return toast('اسم و متن رو کامل کن', 'alert');
    await api.saveTemplate({ ...t, title, text });
    closeModal();
    toast('ذخیره شد');
    App.go();
  };
}
