// 產生 app 圖示：node tools/make-icons.mjs（需要 playwright）
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

const draw = (size, { rounded, safe }) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 512;
  g.scale(s, s);
  // 背景
  g.fillStyle = '#1f5f4a';
  if (rounded) {
    g.beginPath();
    g.roundRect(0, 0, 512, 512, 112);
    g.fill();
  } else {
    g.fillRect(0, 0, 512, 512);
  }
  // 安全區縮放（maskable 圖示內容放在中間 80%）
  g.translate(256, 256);
  g.scale(safe, safe);
  g.translate(-256, -256);
  // 紙
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath();
  g.roundRect(128, 92, 270, 346, 22);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(140, 78);
  g.lineTo(318, 78);
  g.lineTo(384, 144);
  g.lineTo(384, 412);
  g.quadraticCurveTo(384, 430, 366, 430);
  g.lineTo(140, 430);
  g.quadraticCurveTo(122, 430, 122, 412);
  g.lineTo(122, 96);
  g.quadraticCurveTo(122, 78, 140, 78);
  g.fill();
  g.fillStyle = '#d9e7e0';
  g.beginPath();
  g.moveTo(318, 78);
  g.lineTo(318, 128);
  g.quadraticCurveTo(318, 144, 334, 144);
  g.lineTo(384, 144);
  g.closePath();
  g.fill();
  // 文字列
  g.fillStyle = '#c9d3ce';
  for (const [y, w] of [[176, 150], [214, 196], [252, 172]]) {
    g.beginPath();
    g.roundRect(160, y, w, 14, 7);
    g.fill();
  }
  // 黃色螢光（報酬單上的黃底）
  g.fillStyle = '#ffd34d';
  g.beginPath();
  g.roundRect(150, 300, 206, 70, 12);
  g.fill();
  // 簽名
  g.strokeStyle = '#1c2420';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(170, 348);
  g.bezierCurveTo(190, 300, 205, 300, 200, 350);
  g.bezierCurveTo(196, 370, 230, 320, 244, 330);
  g.bezierCurveTo(256, 338, 250, 356, 268, 344);
  g.bezierCurveTo(286, 332, 300, 318, 336, 330);
  g.stroke();
  return c.toDataURL('image/png');
};

const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [
  ['icon-192.png', 192, { rounded: true, safe: 1 }],
  ['icon-512.png', 512, { rounded: true, safe: 1 }],
  ['apple-touch-icon.png', 180, { rounded: false, safe: 1 }],
  ['icon-maskable-512.png', 512, { rounded: false, safe: 0.8 }],
];
for (const [name, size, opts] of jobs) {
  const url = await page.evaluate(`(${draw.toString()})(${size}, ${JSON.stringify(opts)})`);
  writeFileSync(join(outDir, name), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', name);
}
await browser.close();
