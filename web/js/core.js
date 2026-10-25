// هستهٔ برنامه: ابزارها، منو، مسیریابی صفحه‌ها، مودال، پیام کوتاه و حالت تیره

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = v => String(v ?? '').replace(/\d/g, d => FA_DIGITS[d]);
const toEn = s => String(s ?? '').replace(/[۰-۹]/g, d => FA_DIGITS.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const icon = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;

// حجم به گیگ → «۸۵۰ مگ» یا «۱٫۵ گیگ»
function vol(gb) {
  if (gb === Infinity) return 'نامحدود';
  if (gb >= 1) return fa(String(Math.round(gb * 10) / 10).replace('.', '٫')) + ' گیگ';
  return fa(Math.round(gb * 1024)) + ' مگ';
}
const phoneHtml = p => `<span class="ltr">${fa(String(p).replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3'))}</span>`;
const initial = c => (c.name || c.account).trim().charAt(0).toUpperCase();

// وضعیت هر مشتری بر اساس قانون‌های هشدار
const thresholdGB = r => (r.volume.unit === 'MB' ? r.volume.amount / 1024 : r.volume.amount);
function clientState(c, rules) {
  const left = c.totalGB > 0 ? Math.max(0, c.totalGB - c.usedGB) : Infinity;
  const ended = left <= 0 || c.daysLeft === 0;
  const off = !c.enabled && !ended; // دستی غیرفعال شده
  const lowVol = left !== Infinity && left > 0 && left <= thresholdGB(rules);
  const lowDays = c.daysLeft != null && c.daysLeft > 0 && c.daysLeft <= rules.expiry.days;
  return { left, ended, off, lowVol, lowDays, near: !ended && !off && (lowVol || lowDays) };
}
function statePill(st) {
  if (st.ended) return `<span class="pill danger">تموم شده</span>`;
  if (st.lowVol && st.lowDays) return `<span class="pill warn">حجم و تاریخ</span>`;
  if (st.lowVol) return `<span class="pill warn">حجم کم</span>`;
  if (st.lowDays) return `<span class="pill warn">تاریخ نزدیک</span>`;
  return `<span class="pill ok">فعال</span>`;
}

// متن پیامک
const VARS = ['{اسم}', '{اکانت}', '{حجم}', '{روز}'];
const SAMPLE = { name: 'رضا', account: 'VPN 1', left: 0.85, days: 2 };
function fillVars(text, v) {
  return text
    .replace(/\{اسم\}/g, v.name || '')
    .replace(/\{اکانت\}/g, v.account || '')
    .replace(/\{حجم\}/g, v.left != null ? vol(v.left) : '')
    .replace(/\{روز\}/g, v.days != null ? fa(v.days) : '')
    .replace(/ +([،,.!؟])/g, '$1')
    .replace(/ {2,}/g, ' ');
}
function smsInfo(text) {
  const len = [...text].length;
  const unicode = /[^\x00-\x7F]/.test(text);
  const one = unicode ? 70 : 160, multi = unicode ? 67 : 153;
  const parts = len === 0 ? 0 : len <= one ? 1 : Math.ceil(len / multi);
  return { len, parts, one };
}
function counterText(text) {
  const s = smsInfo(fillVars(text, SAMPLE));
  const warn = s.parts > 1 ? ` <span style="color:var(--warn)">(بیشتر از ${fa(s.one)} حرف = چند پیامک)</span>` : '';
  return `<span>${fa(s.len)} حرف</span><span>${fa(s.parts)} پیامک${warn}</span>`;
}

// اجزای تکراری فرم‌ها
const ui = {
  switch: (name, on) => `<label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span class="track"></span></label>`,
  seg: (name, opts, val) => `<div class="seg" data-name="${name}" data-value="${esc(val)}">${opts.map(o =>
    `<button type="button" data-v="${esc(o.v)}" class="${String(o.v) === String(val) ? 'on' : ''}">${o.icon ? icon(o.icon) : ''}${o.label}</button>`).join('')}</div>`,
  lineSeg: (name, val) => ui.seg(name, [1, 2].map(n => ({ v: n, icon: 'sim', label: `خط ${fa(n)}${App.lines[n - 1] ? ' · ' + esc(App.lines[n - 1]) : ''}` })), val),
  varChips: target => `<div class="var-chips" data-target="${target}">${VARS.map(v => `<button type="button" data-var="${v}">${v}</button>`).join('')}</div>`,
  counter: (id, text) => `<div class="counter" data-counter-for="${id}">${counterText(text)}</div>`,
  templateSelect: (name, templates, val) => `<select class="select" name="${name}">${templates.map(t =>
    `<option value="${t.id}" ${t.id === Number(val) ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select>`,
};
const segVal = (root, name) => $(`.seg[data-name="${name}"]`, root)?.dataset.value;

// ───── مودال، شیت و پیام کوتاه ─────
function openModal(html) {
  $('#overlay').hidden = false;
  const m = $('#modal');
  m.innerHTML = html;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  return m;
}
function openSheet(html) {
  $('#overlay').hidden = false;
  const s = $('#sheet');
  s.innerHTML = '<div class="grab"></div>' + html;
  s.hidden = false;
  return s;
}
function closeModal() {
  $('#modal').hidden = true;
  $('#sheet').hidden = true;
  $('#overlay').hidden = true;
  document.body.style.overflow = '';
}
const modalHead = title => `<div class="modal-head"><h3>${title}</h3><button class="icon-btn sm" data-action="close" aria-label="بستن">${icon('x')}</button></div>`;
function confirmBox({ title, text, ok = 'تأیید', danger = false }) {
  return new Promise(resolve => {
    const m = openModal(`${modalHead(title)}<p class="muted">${text}</p>
      <div class="modal-foot"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${ok}</button><button class="btn" data-no>انصراف</button></div>`);
    $('[data-yes]', m).onclick = () => { closeModal(); resolve(true); };
    $('[data-no]', m).onclick = () => { closeModal(); resolve(false); };
  });
}
function toast(msg, ico = 'check') {
  const t = document.createElement('div');
  t.className = 'toast' + (ico === 'alert' ? ' bad' : '');
  t.innerHTML = icon(ico) + `<span>${esc(msg)}</span>`;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ico === 'alert' ? 5000 : 2600);
}
// دکمه رو تا تموم شدن کار «صبر کن» نشون می‌ده؛ اگه خطا شد پیامش رو نشون می‌ده و کار بعدی رو متوقف می‌کنه
async function busy(btn, fn) {
  const html = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = icon('refresh', 'spin') + '<span>صبر کن…</span>';
  }
  try {
    return await fn();
  } catch (err) {
    if (!err.toasted) toast(err.message, 'alert');
    err.toasted = true;
    throw err;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = html; }
  }
}

// کپی: روی http (بدون https) مرورگر clipboard رو نمی‌ده، پس روش قدیمی هم داریم
async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error();
    }
    toast('کپی شد');
  } catch {
    toast('کپی نشد؛ لینک رو دستی انتخاب کن', 'alert');
  }
}

// ───── نصب به‌صورت برنامه (بدون نوار آدرس، با آیکون روی صفحهٔ گوشی) ─────
// فقط روی https کار می‌کنه (مثلاً پشت کلادفلر)؛ روی http مرورگر اجازهٔ نصب نمی‌ده.
const Install = {
  prompt: null,
  init() {
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
    addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      Install.prompt = e;
      Install.refresh();
    });
    addEventListener('appinstalled', () => {
      Install.prompt = null;
      Install.refresh();
      toast('برنامه نصب شد؛ از صفحهٔ گوشی بازش کن');
    });
    Install.refresh();
  },
  get standalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
  get ios() { return /iphone|ipad|ipod/i.test(navigator.userAgent); },
  available() { return !Install.standalone && (!!Install.prompt || (Install.ios && window.isSecureContext)); },
  refresh() { $$('[data-action="install"]').forEach(b => { b.hidden = !Install.available(); }); },
  async run() {
    closeModal();
    if (Install.prompt) {
      Install.prompt.prompt();
      await Install.prompt.userChoice;
      Install.prompt = null;
      return Install.refresh();
    }
    openModal(`${modalHead('نصب روی آیفون')}<p>تو Safari دکمهٔ «اشتراک‌گذاری» (مربع با فلش رو به بالا) رو بزن و «Add to Home Screen» رو انتخاب کن.</p>`);
  },
};

// ───── حالت تیره و روشن ─────
const Theme = {
  saved() { try { return localStorage.getItem('smsbot-theme'); } catch { return null; } },
  isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  },
  apply(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = this.isDark();
    $$('[data-action="theme"] use').forEach(u => u.setAttribute('href', dark ? '#i-sun' : '#i-moon'));
    $('meta[name="theme-color"]').content = dark ? '#0e1015' : '#f4f5f8';
  },
  toggle() {
    const t = this.isDark() ? 'light' : 'dark';
    this.apply(t);
    try { localStorage.setItem('smsbot-theme', t); } catch {}
  },
};

// ───── صفحه‌ها و منو ─────
const PAGES = [
  { id: 'dashboard', title: 'داشبورد', sub: 'وضعیت امروز در یک نگاه', icon: 'home', tab: true },
  { id: 'clients', title: 'کانفیگ‌ها', sub: 'ساخت، تمدید و مدیریت کانفیگ‌ها و شمارهٔ مشتری‌ها', icon: 'users', tab: true },
  { id: 'alerts', title: 'هشدارهای خودکار', short: 'هشدارها', sub: 'پیامک خودکار قبل از تموم شدن اشتراک', icon: 'bell', tab: true },
  { id: 'broadcast', title: 'پیام همگانی', short: 'همگانی', sub: 'یک پیام برای گروهی از مشتری‌ها', icon: 'mega', tab: true },
  { id: 'templates', title: 'متن‌ها', sub: 'متن‌های آماده برای هشدار و پیام همگانی', icon: 'text' },
  { id: 'history', title: 'تاریخچه', sub: 'همهٔ پیامک‌های فرستاده‌شده', icon: 'history' },
  { id: 'settings', title: 'تنظیمات', sub: 'اتصال پنل و گوشی، قوانین ارسال و امنیت', icon: 'settings' },
];

function renderNav() {
  $('#sideNav').innerHTML = PAGES.map(p =>
    `<a class="nav-link" href="#/${p.id}" data-page="${p.id}">${icon(p.icon)}<span>${p.title}</span></a>`).join('');
  $('#bottomNav').innerHTML = PAGES.filter(p => p.tab).map(p =>
    `<a href="#/${p.id}" data-page="${p.id}">${icon(p.icon)}<span>${p.short || p.title}</span></a>`).join('')
    + `<button type="button" data-action="more" data-page="more">${icon('more')}<span>بیشتر</span></button>`;
}
function highlightNav(id) {
  $$('#sideNav [data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === id));
  const isTab = PAGES.find(p => p.id === id)?.tab;
  $$('#bottomNav [data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === (isTab ? id : 'more')));
}
function openMore() {
  const s = openSheet(`<div class="stack-sm">
    ${PAGES.filter(p => !p.tab).map(p => `<a class="nav-link" href="#/${p.id}">${icon(p.icon)}<span>${p.title}</span></a>`).join('')}
    <div class="divider" style="margin:6px 0"></div>
    ${Install.available() ? `<button class="nav-link" data-action="install">${icon('download')}<span>نصب به‌صورت برنامه</span></button>` : ''}
    <button class="nav-link" data-action="theme">${icon(Theme.isDark() ? 'sun' : 'moon')}<span>تغییر حالت تیره و روشن</span></button>
    <button class="nav-link" data-action="logout">${icon('logout')}<span>خروج</span></button>
  </div>`);
  $$('a', s).forEach(a => a.addEventListener('click', closeModal));
}

// وضعیت پنل و گوشی: ok=true وصل، false قطع، null هنوز بررسی نشده / تنظیم نشده
function statusDot(x) {
  return x.ok === true ? 'ok' : x.ok === false ? 'danger' : 'warn';
}
function phoneLabel(ph) {
  if (!ph.configured) return 'تنظیم نشده';
  return ph.ok === true ? 'وصله' : ph.ok === false ? 'قطعه' : 'در حال بررسی';
}
async function renderTopStatus() {
  try {
    const s = await api.status();
    $('#topStatus').innerHTML = `
      <span class="status-chip" title="${esc(s.panel.error)}"><span class="dot ${s.panel.configured === false ? 'warn' : statusDot(s.panel)}"></span>پنل ${s.panel.configured === false ? 'تنظیم نشده' : s.panel.ok === true ? 'وصله' : s.panel.ok === false ? 'قطعه' : 'در حال بررسی'}</span>
      <span class="status-chip" title="${esc(s.phone.error)}"><span class="dot ${s.phone.configured ? statusDot(s.phone) : 'warn'}"></span>گوشی ${phoneLabel(s.phone)}</span>`;
  } catch { /* اگه سرور در دسترس نبود، همون قبلی بمونه */ }
}

// صفحهٔ ورود؛ وقتی ورود موفق شد، Promise تموم می‌شه
function renderLogin(info = {}) {
  const el = $('#login');
  el.innerHTML = `<form class="card stack" id="loginForm">
    <div style="text-align:center">
      <span class="brand-mark">${icon('msg', 'i-lg')}</span>
      <h2 style="font-size:19px">پنل پیامک</h2>
      <p class="muted small">${info.hasPassword === false ? 'رمز برنامه هنوز تعیین نشده؛ با دستور نصب روی سرور رمز بساز.' : 'برای ورود رمز برنامه رو وارد کن'}</p>
    </div>
    <div class="field"><label for="loginPass">رمز ورود</label>
      <div class="input-group">${icon('lock')}<input class="input" id="loginPass" type="password" autocomplete="current-password" placeholder="••••••••" autofocus></div></div>
    <p class="small err" id="loginErr"></p>
    <button class="btn btn-primary btn-block" type="submit">ورود</button>
  </form>`;
  el.hidden = false;
  return new Promise(resolve => {
    $('#loginForm').onsubmit = async e => {
      e.preventDefault();
      $('#loginErr').textContent = '';
      try {
        await busy($('button', e.target), () => api.login($('#loginPass').value));
      } catch (err) {
        $('#loginErr').textContent = err.message;
        return;
      }
      el.hidden = true;
      resolve();
    };
  });
}

// ───── راه‌اندازی ─────
const App = {
  pages: {},
  lines: ['', ''],

  async go() {
    const id = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
    const page = PAGES.find(p => p.id === id) || PAGES[0];
    closeModal();
    $('#pageTitle').textContent = page.title;
    $('#pageSub').textContent = page.sub;
    document.title = page.title + ' · پنل پیامک';
    highlightNav(page.id);
    const view = $('#view');
    try {
      await App.pages[page.id](view);
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="empty card">${icon('alert', 'i-lg')}<p class="mt-s">${esc(e.message)}</p>
        <button class="btn btn-sm mt" data-action="retry">${icon('refresh', 'i-sm')}دوباره امتحان کن</button></div>`;
    }
    window.scrollTo(0, 0);
  },

  async start() {
    renderNav();
    Theme.apply(Theme.saved());
    bindGlobalEvents();
    Install.init();
    const me = await api.me().catch(() => ({ loggedIn: false }));
    if (!me.loggedIn) await renderLogin(me);
    await App.loadLines();
    renderTopStatus();
    setInterval(renderTopStatus, 60_000);
    addEventListener('hashchange', App.go);
    App.go();
  },

  async loadLines() {
    try {
      const s = await api.settings();
      App.lines = [s.phone.line1, s.phone.line2];
    } catch { /* خطا بعداً تو خود صفحه نشون داده می‌شه */ }
  },

  // نشست تموم شده (مثلاً رمز عوض شده) → صفحهٔ ورود، بعد همون صفحه
  onUnauthorized() {
    if (!$('#login').hidden) return;
    closeModal();
    renderLogin().then(() => App.go());
  },
};

function bindGlobalEvents() {
  document.addEventListener('click', e => {
    const t = e.target;
    const action = t.closest('[data-action]')?.dataset.action;
    if (action === 'theme') return Theme.toggle();
    if (action === 'close') return closeModal();
    if (action === 'more') return openMore();
    if (action === 'retry') return App.go();
    if (action === 'install') return Install.run();
    if (action === 'logout') {
      closeModal();
      return api.logout().catch(() => {}).then(() => renderLogin()).then(() => App.go());
    }

    const copyBtn = t.closest('[data-copy]');
    if (copyBtn) return copyText(copyBtn.dataset.copy);

    const segBtn = t.closest('.seg button');
    if (segBtn) {
      const seg = segBtn.parentElement;
      $$('button', seg).forEach(b => b.classList.toggle('on', b === segBtn));
      seg.dataset.value = segBtn.dataset.v;
      seg.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const choice = t.closest('.choice-list .choice');
    if (choice) {
      const list = choice.parentElement;
      $$('.choice', list).forEach(c => c.classList.toggle('on', c === choice));
      list.dataset.value = choice.dataset.v;
      list.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const chip = t.closest('.chips .chip');
    if (chip) {
      const chips = chip.parentElement;
      $$('.chip', chips).forEach(c => c.classList.toggle('on', c === chip));
      chips.dataset.value = chip.dataset.v;
      chips.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const varBtn = t.closest('.var-chips [data-var]');
    if (varBtn) {
      const ta = document.getElementById(varBtn.parentElement.dataset.target);
      const pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + varBtn.dataset.var + ta.value.slice(ta.selectionEnd ?? pos);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + varBtn.dataset.var.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  document.addEventListener('input', e => {
    const id = e.target.id;
    if (!id) return;
    const c = document.querySelector(`[data-counter-for="${id}"]`);
    if (c) c.innerHTML = counterText(e.target.value);
  });

  // هر خطایی که جایی نشون داده نشده، به‌صورت پیام کوتاه
  addEventListener('unhandledrejection', e => {
    if (!e.reason?.toasted) toast(e.reason?.message || 'خطای ناشناخته', 'alert');
    e.preventDefault();
  });

  $('#overlay').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => Theme.apply(Theme.saved()));
}
