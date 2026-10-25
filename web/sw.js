// سرویس‌ورکر برای نصب به‌صورت برنامه. همه‌چیز همیشه از سرور گرفته می‌شه (اطلاعات زنده‌ست، چیزی ذخیره نمی‌شه)؛
// فقط اگه اینترنت قطع بود، به‌جای صفحهٔ خطای مرورگر یه پیام ساده نشون می‌ده.
const OFFLINE = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>پنل پیامک</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f4f5f8;color:#161a22;font-family:Vazirmatn,Tahoma,sans-serif">
<div style="text-align:center;padding:24px"><h2 style="font-weight:500">اینترنت وصل نیست</h2>
<p style="color:#7a8190">بعد از وصل شدن اینترنت دوباره امتحان کن.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 22px;border:0;border-radius:11px;background:#3b5bdb;color:#fff">دوباره</button></div>
</body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
