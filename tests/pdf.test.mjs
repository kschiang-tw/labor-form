import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzlibSync } from '../vendor/fflate.js';
import { buildPdf, encodeRgb, jpegInfo } from '../js/pdf.js';

// 最小的 1×1 JPEG（灰色）
const TINY_JPEG = Uint8Array.from(Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACv/2Q==',
  'base64',
));

test('jpegInfo 讀得到尺寸', () => {
  assert.deepEqual(jpegInfo(TINY_JPEG), { width: 1, height: 1, components: 1 });
});

test('encodeRgb 可以還原成原本的像素', () => {
  const w = 5;
  const h = 4;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 255;
  const raw = unzlibSync(encodeRgb(rgba, w, h));
  assert.equal(raw.length, (w * 3 + 1) * h);
  // 反向套用 PNG 濾波
  const out = new Uint8Array(w * 3 * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w * 3 + 1)];
    for (let i = 0; i < w * 3; i++) {
      const v = raw[y * (w * 3 + 1) + 1 + i];
      const left = i >= 3 ? out[y * w * 3 + i - 3] : 0;
      const up = y > 0 ? out[(y - 1) * w * 3 + i] : 0;
      out[y * w * 3 + i] = (v + (f === 1 ? left : f === 2 ? up : 0)) & 255;
    }
  }
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 3; c++) assert.equal(out[p * 3 + c], rgba[p * 4 + c]);
  }
});

test('buildPdf：頁數、xref 位移、照片只存一次', () => {
  const page = { kind: 'rgb', width: 2, height: 2, bytes: encodeRgb(new Uint8Array(16).fill(255), 2, 2) };
  const bytes = buildPdf({
    pageWidth: 595.28,
    pageHeight: 841.89,
    title: '202609_勞務報酬單',
    images: { p0: page, p1: page, front: { kind: 'jpeg', bytes: TINY_JPEG } },
    pages: [
      [{ image: 'p0', x: 0, y: 0, w: 595.28, h: 841.89 }, { image: 'front', x: 20, y: 620, w: 250, h: 150 }],
      [{ image: 'p1', x: 0, y: 0, w: 595.28, h: 841.89 }, { image: 'front', x: 20, y: 620, w: 250, h: 150 }],
    ],
  });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Type \/Pages \/Kids \[[^\]]+\] \/Count 2/);
  assert.equal(text.match(/\/Filter \/DCTDecode/g).length, 1, 'JPEG 只嵌一次');
  // 每個 xref 位移都要指到「n 0 obj」
  const xrefAt = +/startxref\n(\d+)/.exec(text)[1];
  const xref = text.slice(xrefAt).split('\n');
  const count = +xref[1].split(' ')[1];
  for (let i = 1; i < count; i++) {
    const off = +xref[2 + i].slice(0, 10);
    assert.ok(text.startsWith(`${i} 0 obj`, off), `物件 ${i} 的位移正確`);
  }
  // 照片位置：PDF 座標原點在左下角
  assert.match(text, /q 250 0 0 150 20 71\.89 cm/);
});
