// ساخت یک فایل HTML تکی از پوشهٔ web (با استایل، اسکریپت و فونت داخلش) برای فرستادن پیش‌نمایش
// اجرا: node tools/bundle-preview.mjs  ← خروجی: work/smsbot-preview.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const read = p => readFileSync(join(web, p), 'utf8');

let css = read('app.css').replace(/url\("fonts\/([^"]+)"\) format\("truetype"\)/g, (_, f) =>
  `url(data:font/ttf;base64,${readFileSync(join(web, 'fonts', f)).toString('base64')}) format("truetype")`);

let html = read('index.html')
  // پیش‌نمایش بدون سرور: به‌جای api.js اطلاعات نمونه (mock.js)
  .replace('<script src="js/api.js"></script>', '<script src="js/mock.js"></script>')
  .replace('<script src="vendor/qrcode.js"></script>\n', '')
  .replace('id="previewNote" hidden', 'id="previewNote"')
  .replace('<link rel="stylesheet" href="app.css">', () => `<style>\n${css}\n</style>`)
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${read(src)}\n</script>`);

mkdirSync(join(root, 'work'), { recursive: true });
writeFileSync(join(root, 'work', 'smsbot-preview.html'), html);
console.log('ok', Math.round(html.length / 1024) + ' KB');
