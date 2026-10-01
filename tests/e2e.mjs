// 端對端測試：用真的瀏覽器跑一次完整流程（全部假資料）。
//   npm run e2e
// 也可以在自己電腦上用真的檔案試（輸出在 tests/output/，不會進版控）：
//   E2E_DOCX=a.docx,b.docx E2E_SIGNATURE=sign.png E2E_ID_FRONT=front.jpg E2E_ID_BACK=back.jpg npm run e2e
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildDocx, FAKE } from './fixtures.mjs';
import { APP_VERSION } from '../js/version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.E2E_OUT ?? join(root, 'tests', 'output');
mkdirSync(outDir, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, p);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// 沒設 UTF-8 語系時 Chromium 會把中文下載檔名換成 "download"
const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const foreign = [];
page.on('request', (r) => {
  if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) foreign.push(r.url());
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const step = (s) => console.log(`• ${s}`);

try {
  step('開啟 app');
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#offline').textContent.includes('可離線'), null, { timeout: 30000 });

  step('頁尾版號與「關於」');
  assert.equal((await page.textContent('#about-btn')).replace(/\s+/g, ' ').trim(), `v${APP_VERSION} · 勞務報酬單 © 2026 kschiang-tw`);
  await page.click('#about-btn');
  await page.waitForSelector('#dlg-about[open]');
  assert.ok((await page.textContent('#dlg-about')).includes(`v${APP_VERSION}`));
  await page.screenshot({ path: join(outDir, 'about.png') });
  await page.click('#dlg-about [data-close]');
  await page.waitForSelector('#dlg-about', { state: 'hidden' });

  // 假的簽名與身分證圖片（在瀏覽器裡畫）
  const fakeImage = (kind) => page.evaluate((kind) => {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    if (kind === 'sign') {
      c.width = 900; c.height = 300;
      g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 900, 300);
      g.strokeStyle = '#1a2a6c'; g.lineWidth = 14; g.lineCap = 'round';
      g.beginPath(); g.moveTo(80, 200); g.bezierCurveTo(200, 20, 260, 280, 380, 150); g.bezierCurveTo(480, 40, 600, 260, 820, 120); g.stroke();
      return c.toDataURL('image/png');
    }
    c.width = 1300; c.height = 820;
    g.fillStyle = '#d9d2c3'; g.fillRect(0, 0, 1300, 820);
    g.fillStyle = kind === 'front' ? '#e8eef7' : '#f3ece0'; g.fillRect(50, 40, 1200, 740);
    g.fillStyle = '#333'; g.font = 'bold 90px sans-serif'; g.fillText(kind === 'front' ? 'FAKE ID FRONT' : 'FAKE ID BACK', 160, 430);
    return c.toDataURL('image/jpeg', 0.9);
  }, kind).then((u) => Buffer.from(u.split(',')[1], 'base64'));

  const file = (envPath, fallback, name, mimeType) =>
    envPath ? { name: basename(envPath), mimeType, buffer: readFileSync(envPath) } : { name, mimeType, buffer: fallback };

  step('我的資料：通訊地址');
  await page.click('#tab-btn-me');
  await page.fill('#address', process.env.E2E_ADDRESS ?? '999 測試市測試區測試路 9 號 9 樓');
  await page.waitForFunction(() => document.querySelector('#address-state').textContent.includes('已儲存'));

  step('我的資料：匯入簽名圖片');
  await page.setInputFiles('#sig-file', file(process.env.E2E_SIGNATURE, await fakeImage('sign'), 'sign.png', 'image/png'));
  await page.waitForSelector('#dlg-sigimg[open]');
  await page.click('#sigimg-save');
  await page.waitForSelector('#dlg-sigimg', { state: 'hidden' });

  for (const [key, kind, env] of [['idFront', 'front', process.env.E2E_ID_FRONT], ['idBack', 'back', process.env.E2E_ID_BACK]]) {
    step(`我的資料：身分證${kind === 'front' ? '正面' : '反面'}`);
    await page.setInputFiles(`[data-id-input="${key}"]`, file(env, await fakeImage(kind), `${kind}.jpg`, 'image/jpeg'));
    await page.waitForSelector('#dlg-crop[open]');
    await page.waitForTimeout(200);
    await page.click('#crop-save');
    await page.waitForSelector('#dlg-crop', { state: 'hidden' });
  }
  await page.waitForFunction(() => document.querySelector('#me-dot').hidden);
  await page.screenshot({ path: join(outDir, 'settings.png'), fullPage: true });

  step('產生 PDF：選 Word 檔');
  await page.click('#tab-btn-make');
  const docs = process.env.E2E_DOCX
    ? process.env.E2E_DOCX.split(',').map((p) => ({ name: basename(p), mimeType: 'application/octet-stream', buffer: readFileSync(p) }))
    : [
      { name: '9-12勞務報酬單.docx', mimeType: 'application/octet-stream', buffer: Buffer.from(buildDocx({ ...FAKE, day: '12', work: '2026/9/12測試股份有限公司夜間導覽' })) },
      { name: '9-5勞務報酬單.docx', mimeType: 'application/octet-stream', buffer: Buffer.from(buildDocx()) },
    ];
  await page.setInputFiles('#docx-input', docs);
  await page.waitForFunction((n) => document.querySelectorAll('.form-card').length === n, docs.length);
  if (!process.env.E2E_DOCX) {
    const days = await page.$$eval('.fc-date .d', (els) => els.map((e) => e.textContent));
    assert.deepEqual(days, ['5', '12'], '依日期排序');
    assert.equal(await page.inputValue('#pdf-name'), `202609_勞務報酬單_${FAKE.name}`);
  }

  step('預覽');
  await page.click('.form-card [data-act="preview"]');
  await page.waitForSelector('#dlg-preview[open] #preview-img[src^="blob:"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'preview.png') });
  await page.click('#dlg-preview [data-close]');

  step('產生 PDF');
  const t0 = Date.now();
  await page.click('#make-pdf');
  await page.waitForSelector('#result:not([hidden])', { timeout: 120000 });
  console.log(`  ${docs.length} 頁花了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒，${await page.textContent('#result-info')}`);
  await page.screenshot({ path: join(outDir, 'result.png'), fullPage: true });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-pdf')]);
  console.log(`  下載檔名：${download.suggestedFilename()}`);
  const pdfPath = join(outDir, download.suggestedFilename());
  await download.saveAs(pdfPath);
  const pdf = readFileSync(pdfPath).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.equal(+/\/Count (\d+)/.exec(pdf)[1], docs.length);
  console.log(`  已存到 ${pdfPath}`);

  step('身分證浮水印已經畫進照片裡');
  const raw = readFileSync(pdfPath);
  const jpegs = [...pdf.matchAll(/\/DCTDecode \/Length (\d+) >>\nstream\n/g)].map((m) => raw.subarray(m.index + m[0].length, m.index + m[0].length + +m[1]));
  if (!process.env.E2E_DOCX) assert.equal(jpegs.length, 2, '兩頁同一家公司：正反面照片各只存一次');
  // 拿 PDF 裡的照片跟這台裝置存的原始照片比對：浮水印的筆畫會讓一部分像素明顯不同
  const changed = await page.evaluate(async (b64s) => {
    const db = await new Promise((r) => { const q = indexedDB.open('labor-form', 1); q.onsuccess = () => r(q.result); });
    const get = (k) => new Promise((r) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); });
    const decode = async (bytes) => {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height);
    };
    const out = [];
    for (const [i, key] of [[0, 'idFront'], [1, 'idBack']]) {
      if (!b64s[i]) continue;
      const orig = await decode((await get(key)).bytes);
      const pdf = await decode(Uint8Array.from(atob(b64s[i]), (c) => c.charCodeAt(0)));
      if (orig.width !== pdf.width || orig.height !== pdf.height) { out.push(-1); continue; }
      let n = 0;
      for (let j = 0; j < orig.data.length; j += 4) {
        const d = Math.abs(orig.data[j] - pdf.data[j]) + Math.abs(orig.data[j + 1] - pdf.data[j + 1]) + Math.abs(orig.data[j + 2] - pdf.data[j + 2]);
        if (d > 60) n++;
      }
      out.push(n / (orig.data.length / 4));
    }
    return out;
  }, jpegs.map((j) => Buffer.from(j).toString('base64')));
  for (const ratio of changed) {
    console.log(`  照片上被浮水印改變的像素：${(ratio * 100).toFixed(1)}%`);
    assert.ok(ratio > 0.02, '照片裡要有浮水印');
  }

  step('離線：斷網後重新開啟');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#docx-input', { state: 'attached' });
  assert.equal(await page.evaluate(async () => (await document.fonts.load('500 10px NotoTC', '測')).length), 1, '離線時字型也載得到');
  await page.waitForFunction(() => document.querySelector('#address').value !== '');
  assert.equal(await page.inputValue('#address'), process.env.E2E_ADDRESS ?? '999 測試市測試區測試路 9 號 9 樓', '重開後資料還在');
  assert.equal(await page.textContent('#setup-missing'), '', '簽名和身分證也還在');
  assert.equal(await page.isVisible('#me-dot'), false);
  assert.equal(await page.isVisible('#setup-notice'), false);
  await context.setOffline(false);

  assert.deepEqual(foreign, [], '不能連到任何外部網址');
  assert.deepEqual(errors, [], '頁面不能有錯誤');
  console.log('✓ 全部通過');
} catch (err) {
  await page.screenshot({ path: join(outDir, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('✗ 失敗：', err);
  if (errors.length) console.error('頁面錯誤：', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
