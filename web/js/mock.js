// اطلاعات نمونه برای پیش‌نمایش ظاهر بدون سرور (فقط تو فایل پیش‌نمایش استفاده می‌شه).
// نسخهٔ واقعی برنامه به‌جای این فایل از api.js استفاده می‌کنه که همین توابع رو به سرور وصل می‌کنه.

const MOCK = {
  status: {
    panel: { ok: true, type: '3X-UI', version: 'v3.5.0', checkedAgo: 2, error: '' },
    phone: { ok: true, configured: true, device: 'Galaxy A54', lastSeenAgo: 1, error: '' },
    smsToday: 7, dailyLimit: 50, queued: 1,
  },

  inbounds: [
    { id: 1, remark: 'VLESS Reality', protocol: 'vless', port: 443 },
    { id: 2, remark: 'VMess WS', protocol: 'vmess', port: 8080 },
  ],

  clients: [
    { id: 1, account: 'VPN1', name: 'رضا', phone: '09121234567', totalGB: 30, usedGB: 29.15, daysLeft: null, enabled: true, alerted: 'volume' },
    { id: 2, account: 'VPN2', name: '', phone: '', totalGB: 20, usedGB: 19.4, daysLeft: null, enabled: true, alerted: null },
    { id: 3, account: 'VPN3', name: 'مریم', phone: '09351112233', totalGB: 50, usedGB: 12.3, daysLeft: 2, enabled: true, alerted: null },
    { id: 4, account: 'VPN4', name: '', phone: '', totalGB: 30, usedGB: 8, daysLeft: null, enabled: true, alerted: null },
    { id: 5, account: 'VPN5', name: 'حسین', phone: '09190001122', totalGB: 20, usedGB: 20, daysLeft: null, enabled: false, alerted: 'volume' },
    { id: 6, account: 'VPN6', name: '', phone: '', totalGB: 50, usedGB: 31, daysLeft: null, enabled: true, alerted: null },
    { id: 7, account: 'ali-karaj', name: 'علی', phone: '09123334455', totalGB: 100, usedGB: 64, daysLeft: 12, enabled: true, alerted: null },
    { id: 8, account: 'VPN7', name: 'سارا', phone: '09367778899', totalGB: 30, usedGB: 29.6, daysLeft: null, enabled: true, alerted: null },
    { id: 9, account: 'VPN8', name: '', phone: '', totalGB: 0, usedGB: 41, daysLeft: 20, enabled: true, alerted: null },
    { id: 10, account: 'VPN9', name: 'نیما', phone: '09105556677', totalGB: 20, usedGB: 3, daysLeft: 1, enabled: true, alerted: 'expiry' },
    { id: 11, account: 'VPN10', name: '', phone: '', totalGB: 30, usedGB: 30, daysLeft: null, enabled: false, alerted: null },
    { id: 12, account: 'VPN11', name: 'امیر', phone: '09012223344', totalGB: 50, usedGB: 22, daysLeft: null, enabled: true, alerted: null },
    { id: 13, account: 'family-tehran', name: 'خانوادهٔ محمدی', phone: '09124445566', totalGB: 200, usedGB: 150, daysLeft: 25, enabled: true, alerted: null },
    { id: 14, account: 'VPN12', name: '', phone: '', totalGB: 20, usedGB: 15.5, daysLeft: null, enabled: true, alerted: null },
  ],

  rules: {
    enabled: true,
    intervalMin: 10,
    volume: { on: true, amount: 1, unit: 'GB', templateId: 1, line: 1 },
    expiry: { on: true, days: 2, templateId: 2, line: 1 },
    ended: { on: false, templateId: 3, line: 1 },
  },

  templates: [
    { id: 1, title: 'هشدار حجم', text: 'سلام {اسم}، فقط {حجم} از حجم سرویست مونده. برای تمدید پیام بده.' },
    { id: 2, title: 'هشدار تاریخ', text: 'سلام {اسم}، فقط {روز} روز تا پایان اشتراکت مونده. برای تمدید پیام بده.' },
    { id: 3, title: 'پایان اشتراک', text: 'سلام {اسم}، اشتراکت تموم شد. برای تمدید همین‌جا پیام بده.' },
    { id: 4, title: 'تخفیف تمدید', text: 'سلام! تا آخر هفته تمدید سرویس با ۲۰٪ تخفیف. برای تمدید پیام بده.' },
  ],

  history: [
    { id: 1, at: 'امروز ۱۰:۴۲', account: 'VPN1', phone: '09121234567', type: 'volume', line: 1, status: 'sent', text: 'سلام رضا، فقط ۸۵۰ مگ از حجم سرویست مونده. برای تمدید پیام بده.', error: '' },
    { id: 2, at: 'امروز ۰۹:۱۵', account: 'VPN9', phone: '09105556677', type: 'expiry', line: 1, status: 'sent', text: 'سلام نیما، فقط ۱ روز تا پایان اشتراکت مونده. برای تمدید پیام بده.', error: '' },
    { id: 3, at: 'امروز ۰۹:۰۰', account: 'VPN7', phone: '09367778899', type: 'volume', line: 1, status: 'queued', text: 'سلام سارا، فقط ۴۱۰ مگ از حجم سرویست مونده. برای تمدید پیام بده.', error: '' },
    { id: 4, at: 'دیروز ۱۸:۲۰', account: 'VPN3', phone: '09351112233', type: 'broadcast', line: 2, status: 'sent', text: 'سلام! تا آخر هفته تمدید سرویس با ۲۰٪ تخفیف. برای تمدید پیام بده.', error: '' },
    { id: 5, at: 'دیروز ۱۶:۰۵', account: 'VPN5', phone: '09190001122', type: 'volume', line: 1, status: 'sent', text: 'سلام حسین، فقط ۹۲۰ مگ از حجم سرویست مونده. برای تمدید پیام بده.', error: '' },
    { id: 6, at: 'دیروز ۱۲:۳۰', account: 'ali-karaj', phone: '09123334455', type: 'single', line: 2, status: 'sent', text: 'علی جان سرور جدیدت فعال شد، لینک رو تو تلگرام فرستادم.', error: '' },
    { id: 7, at: '۲ روز پیش', account: 'VPN11', phone: '09012223344', type: 'single', line: 1, status: 'failed', text: 'سلام امیر، اشتراکت تمدید شد. ممنون از اعتمادت.', error: 'گوشی آنلاین نبود' },
  ],

  broadcasts: [
    { id: 1, title: 'تخفیف تمدید', at: 'دیروز ۱۸:۲۰', total: 42, sent: 40, failed: 2, line: 2, status: 'done' },
    { id: 2, title: 'اطلاعیهٔ تغییر سرور', at: 'فردا ۲۰:۰۰', total: 38, sent: 0, failed: 0, line: 1, status: 'scheduled' },
  ],

  settings: {
    panel: { type: '3x-ui', url: 'http://127.0.0.1:2053/panel-path/', linkHost: 'sv1.example.com', auth: 'token', token: '', has_token: true, username: '', password: '', has_password: false },
    phone: { mode: 'cloud', url: 'https://api.sms-gate.app/3rdparty/v1', username: 'K7QX2M', password: '', has_password: true, line1: 'همراه اول', line2: 'ایرانسل', defaultLine: 1 },
    sending: { from: '09:00', to: '22:00', gapSec: 20, dailyLimit: 50 },
    app: { address: 'sms.example.com', port: 8090, cert: '', key: '' },
    version: '0.2.0',
  },
};

const wait = (ms = 120) => new Promise(r => setTimeout(r, ms));
const clone = o => JSON.parse(JSON.stringify(o));
const fakeId = (n, len) => Array.from({ length: len }, (_, i) => ((n * 7919 + i * 104729) % 36).toString(36)).join('');
MOCK.clients.forEach(c => Object.assign(c, { email: c.account, inboundId: c.id % 3 === 0 ? 2 : 1, limitIp: 0, uuid: fakeId(c.id, 32), subId: fakeId(c.id + 50, 16) }));
const byEmail = email => MOCK.clients.find(c => c.email === email);

// QR نمونه (نسخهٔ واقعی QR درست از روی لینک می‌سازه)
function fakeQr(seed) {
  const n = 29;
  let s = [...seed].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const finder = (x, y) => x < 7 && y < 7 && (x === 0 || y === 0 || x === 6 || y === 6 || (x > 1 && x < 5 && y > 1 && y < 5));
  const inFinder = (x, y) => [[0, 0], [n - 7, 0], [0, n - 7]].find(([fx, fy]) => x >= fx - 1 && x < fx + 8 && y >= fy - 1 && y < fy + 8);
  let rects = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const f = inFinder(x, y);
    if (f ? finder(x - f[0], y - f[1]) : rnd() > 0.52) rects += `<rect x="${x + 2}" y="${y + 2}" width="1" height="1"/>`;
  }
  return `<svg viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-label="QR"><rect width="100%" height="100%" fill="#fff"/><g fill="#111">${rects}</g></svg>`;
}

const api = {
  async me() { return { loggedIn: true, hasPassword: true, version: '0.2.0' }; },
  async login() { await wait(400); return true; },
  async logout() { return true; },
  async changePassword() { await wait(400); return true; },

  async status() { await wait(); return clone(MOCK.status); },
  async inbounds() { await wait(); return clone(MOCK.inbounds); },
  async clients() { await wait(); return clone(MOCK.clients); },
  async addClient(c) {
    await wait(500);
    const account = c.account.trim().split(/\s+/).join('-');
    if (MOCK.clients.some(x => x.email.toLowerCase() === account.toLowerCase())) throw new Error('این اسم کانفیگ قبلاً تو پنل هست؛ یه اسم دیگه بذار.');
    const id = Math.max(...MOCK.clients.map(x => x.id)) + 1;
    const created = { id, email: account, usedGB: 0, enabled: true, alerted: null, uuid: fakeId(id, 32), subId: fakeId(id + 50, 16), ...c, account };
    MOCK.clients.unshift(created);
    return clone(created);
  },
  async saveClient(email, patch) {
    await wait();
    const c = byEmail(email);
    Object.assign(c, patch);
    if (patch.account) c.email = patch.account;
  },
  async renewClient(email, { totalGB, days, reset }) {
    await wait(500);
    Object.assign(byEmail(email), { totalGB, daysLeft: days || null, enabled: true, alerted: null }, reset ? { usedGB: 0 } : {});
  },
  async resetTraffic(email) { await wait(400); Object.assign(byEmail(email), { usedGB: 0, alerted: null }); },
  async deleteClient(email) { await wait(500); MOCK.clients = MOCK.clients.filter(x => x.email !== email); },
  async links(c) {
    await wait();
    const inb = MOCK.inbounds.find(i => i.id === c.inboundId);
    const config = inb.protocol === 'vless'
      ? `vless://${c.uuid}@sv1.example.com:${inb.port}?type=tcp&security=reality&fp=chrome#${encodeURIComponent(c.account)}`
      : `vmess://${btoa(unescape(encodeURIComponent(JSON.stringify({ v: '2', ps: c.account, add: 'sv1.example.com', port: inb.port, id: c.uuid, net: 'ws' }))))}`;
    return { config, all: [config], sub: `https://sv1.example.com:2096/sub/${c.subId}`, qr: fakeQr };
  },

  async rules() { await wait(); return clone(MOCK.rules); },
  async saveRules(rules) { await wait(); MOCK.rules = clone(rules); },
  async templates() { await wait(); return clone(MOCK.templates); },
  async saveTemplate(t) {
    await wait();
    if (t.id) Object.assign(MOCK.templates.find(x => x.id === t.id), t);
    else MOCK.templates.push({ ...t, id: Math.max(0, ...MOCK.templates.map(x => x.id)) + 1 });
  },
  async deleteTemplate(id) { await wait(); MOCK.templates = MOCK.templates.filter(t => t.id !== id); },

  async history() { await wait(); return clone(MOCK.history); },
  async retry(id) { await wait(); MOCK.history.find(h => h.id === id).status = 'queued'; },
  async broadcasts() { await wait(); return clone(MOCK.broadcasts); },
  async sendBroadcast(b) {
    await wait(400);
    MOCK.broadcasts.unshift({ id: Date.now(), title: b.title, at: b.sendAt ? 'زمان‌بندی‌شده' : 'همین الان', total: b.emails.length, sent: 0, failed: 0, line: b.line, status: b.sendAt ? 'scheduled' : 'sending' });
    return { count: b.emails.length };
  },
  async cancelBroadcast(id) { await wait(); MOCK.broadcasts.find(b => b.id === id).status = 'cancelled'; },
  async sendOne() { await wait(500); MOCK.status.smsToday++; },

  async settings() { await wait(); return clone(MOCK.settings); },
  async saveSettings(s) { await wait(); Object.assign(MOCK.settings, clone(s)); return { restart: false }; },
  async testPanel() { await wait(1100); return { ok: true, version: 'v3.5.0', clients: MOCK.clients.length, linkHost: 'sv1.example.com' }; },
  async connectPanel() { await wait(1300); return { ok: true, version: 'v3.5.0', clients: MOCK.clients.length, auth: 'token' }; },
  async panelCerts() { await wait(); return { cert: '/root/cert/sv1.example.com/fullchain.pem', key: '/root/cert/sv1.example.com/privkey.pem', domain: 'sv1.example.com' }; },
  async testPhone() { await wait(1300); return true; },
  async backup() { await wait(); return { app: 'smsbot', contacts: MOCK.clients.filter(c => c.phone).map(c => ({ email: c.email, name: c.name, phone: c.phone })) }; },
  async restore(data) { await wait(); return { contacts: (data.contacts || []).length }; },
  async update() { await wait(1500); return { updated: false, version: '0.2.0' }; },
  async logs() { await wait(); return ['10-25 09:00:01 INFO alert queued: volume VPN7', '10-25 09:00:21 INFO listening']; },
};
