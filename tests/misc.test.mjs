import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { toCapitalDigits, capitalDigitsToNumber, parseAmount, formatAmount } from '../js/numerals.js';
import { watermarkText } from '../js/render.js';

test('國字大寫', () => {
  assert.deepEqual(toCapitalDigits(3500), ['零', '零', '參', '伍', '零', '零']);
  assert.deepEqual(toCapitalDigits(123456), ['壹', '貳', '參', '肆', '伍', '陸']);
  assert.equal(toCapitalDigits(1000000), null);
  assert.equal(capitalDigitsToNumber(['零', '零', '參', '貳', '零', '零']), 3200);
  assert.equal(capitalDigitsToNumber(['零', '零', '叁', '二', '〇', '0']), 3200);
  assert.equal(capitalDigitsToNumber(['零', '零', '？', '貳', '零', '零']), null);
});

test('身分證浮水印文字', () => {
  assert.equal(watermarkText('測試股份有限公司'), '限測試股份有限公司勞務報酬單使用');
  assert.equal(watermarkText(''), '限勞務報酬單使用');
});

test('金額', () => {
  assert.equal(parseAmount('3,500'), 3500);
  assert.equal(parseAmount(' 12 000 '), 12000);
  assert.equal(parseAmount('abc'), null);
  assert.equal(formatAmount(1234567), '1,234,567');
});

test('Service Worker 快取清單涵蓋所有 app 檔案', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css|html|woff2|png|webmanifest))'/g)].map((m) => m[1]));
  const need = [
    'index.html', 'css/app.css', 'manifest.webmanifest',
    ...readdirSync(new URL('../js/', import.meta.url)).map((f) => `js/${f}`),
    ...readdirSync(new URL('../fonts/', import.meta.url)).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`),
    ...readdirSync(new URL('../icons/', import.meta.url)).map((f) => `icons/${f}`),
    'vendor/fflate.js',
  ];
  for (const f of need) assert.ok(listed.has(f), `sw.js 缺少 ${f}`);
});

test('頁面不允許對外連線（CSP）', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(html, /https?:\/\//, 'index.html 不能引用外部網址');
});
