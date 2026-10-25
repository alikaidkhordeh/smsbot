// اتصال صفحه‌ها به سرور برنامه. (برای پیش‌نمایش بدون سرور، mock.js همین توابع رو با اطلاعات نمونه داره.)

async function req(method, path, body) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('به سرور برنامه وصل نشد؛ اینترنت رو چک کن.');
  }
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401 && path !== '/api/login') {
    App.onUnauthorized();
    throw Object.assign(new Error(j.error || 'اول وارد شو'), { toasted: true });
  }
  if (!r.ok || j.ok === false) throw new Error(j.error || `خطای ارتباط با سرور (کد ${r.status})`);
  return j.data;
}
const get = path => req('GET', path);
const post = (path, body = {}) => req('POST', path, body);

// QR از روی خود لینک (لینک‌ها ممکنه حروف فارسی داشته باشن → اول به UTF-8)
function makeQr(text) {
  const q = qrcode(0, 'L');
  q.addData(unescape(encodeURIComponent(text)));
  q.make();
  return q.createSvgTag(4, 2);
}

const api = {
  me: () => get('/api/me'),
  login: password => post('/api/login', { password }),
  logout: () => post('/api/logout'),
  changePassword: (oldPass, newPass) => post('/api/password', { old: oldPass, new: newPass }),

  status: () => get('/api/status'),
  inbounds: () => get('/api/inbounds'),
  clients: () => get('/api/clients'),
  addClient: c => post('/api/clients/add', c),
  saveClient: (email, patch) => post('/api/clients/update', { email, ...patch }),
  renewClient: (email, r) => post('/api/clients/renew', { email, ...r }),
  resetTraffic: email => post('/api/clients/reset', { email }),
  deleteClient: email => post('/api/clients/delete', { email }),
  async links(c) {
    const r = await get('/api/clients/links?email=' + encodeURIComponent(c.email));
    return { config: r.config[0] || '', all: r.config, sub: r.sub || '', qr: makeQr };
  },

  rules: () => get('/api/rules'),
  saveRules: rules => post('/api/rules', rules),
  templates: () => get('/api/templates'),
  saveTemplate: t => post('/api/templates/save', t),
  deleteTemplate: id => post('/api/templates/delete', { id }),

  history: () => get('/api/history'),
  retry: id => post('/api/history/retry', { id }),
  broadcasts: () => get('/api/broadcasts'),
  sendBroadcast: b => post('/api/broadcasts/send', b),
  cancelBroadcast: id => post('/api/broadcasts/cancel', { id }),
  sendOne: (email, text, line) => post('/api/send', { email, text, line: Number(line) }),

  settings: () => get('/api/settings'),
  saveSettings: s => post('/api/settings', s),
  testPanel: panel => post('/api/test/panel', panel ? { panel } : {}),
  connectPanel: p => post('/api/panel/connect', p),
  panelCerts: () => get('/api/panel/certs'),
  testPhone: (phone, line) => post('/api/test/phone', { phone, line }),
  backup: () => get('/api/backup'),
  restore: data => post('/api/restore', data),
  update: () => post('/api/update'),
  logs: () => get('/api/logs'),
};
