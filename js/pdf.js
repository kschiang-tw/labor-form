// 極簡 PDF 產生器：每頁 = 一張無損的版面圖（Flate）+ 疊上去的 JPEG 照片。
// 同一張照片在整份 PDF 只存一次。
import { zlibSync } from '../vendor/fflate.js';

const enc = new TextEncoder();

/** 讀 JPEG 的寬、高、色彩通道數 */
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('不是 JPEG');
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + len;
  }
  throw new Error('JPEG 格式不完整');
}

/**
 * RGBA 像素 → PNG 預測濾波 + zlib（PDF 的 FlateDecode /Predictor 15）
 * @param {Uint8ClampedArray|Uint8Array} rgba
 */
export function encodeRgb(rgba, width, height, level = 6) {
  const rowLen = width * 3;
  const stride = rowLen + 1;
  const out = new Uint8Array(stride * height);
  const prev = new Uint8Array(rowLen);
  const cur = new Uint8Array(rowLen);
  const sub = new Uint8Array(rowLen);
  const up = new Uint8Array(rowLen);
  for (let y = 0; y < height; y++) {
    let si = y * width * 4;
    for (let i = 0; i < rowLen; i += 3, si += 4) {
      cur[i] = rgba[si];
      cur[i + 1] = rgba[si + 1];
      cur[i + 2] = rgba[si + 2];
    }
    let sNone = 0;
    let sSub = 0;
    let sUp = 0;
    for (let i = 0; i < rowLen; i++) {
      const c = cur[i];
      const vs = (c - (i >= 3 ? cur[i - 3] : 0)) & 255;
      const vu = (c - prev[i]) & 255;
      sub[i] = vs;
      up[i] = vu;
      sNone += c < 128 ? c : 256 - c;
      sSub += vs < 128 ? vs : 256 - vs;
      sUp += vu < 128 ? vu : 256 - vu;
    }
    const o = y * stride;
    if (sUp <= sSub && sUp <= sNone) {
      out[o] = 2;
      out.set(up, o + 1);
    } else if (sSub <= sNone) {
      out[o] = 1;
      out.set(sub, o + 1);
    } else {
      out[o] = 0;
      out.set(cur, o + 1);
    }
    prev.set(cur);
  }
  return zlibSync(out, { level });
}

function num(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

function pdfTextString(s) {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `(D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}'${p(a % 60)}')`;
}

/**
 * @param {{
 *   pageWidth: number, pageHeight: number, title?: string,
 *   images: Record<string, {kind: 'jpeg', bytes: Uint8Array} | {kind: 'rgb', bytes: Uint8Array, width: number, height: number}>,
 *   pages: Array<Array<{image: string, x: number, y: number, w: number, h: number}>>
 * }} spec  x/y 以頁面左上角為原點（pt）
 * @returns {Uint8Array}
 */
export function buildPdf(spec) {
  const { pageWidth: PW, pageHeight: PH } = spec;
  const objects = []; // index = id - 1
  const alloc = () => objects.push(null);

  const catalogId = alloc();
  const pagesId = alloc();
  const infoId = alloc();

  const imageIds = {};
  for (const [key, img] of Object.entries(spec.images)) {
    const id = alloc();
    imageIds[key] = id;
    let dict;
    if (img.kind === 'jpeg') {
      const info = jpegInfo(img.bytes);
      const cs = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      dict = `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`;
    } else {
      dict = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${img.width} >> /Length ${img.bytes.length} >>`;
    }
    objects[id - 1] = { dict, stream: img.bytes };
  }

  const pageIds = [];
  spec.pages.forEach((layers) => {
    const pageId = alloc();
    const contentId = alloc();
    pageIds.push(pageId);
    const used = [...new Set(layers.map((l) => l.image))];
    const xobj = used.map((k) => `/I${imageIds[k]} ${imageIds[k]} 0 R`).join(' ');
    const ops = layers
      .map((l) => `q ${num(l.w)} 0 0 ${num(l.h)} ${num(l.x)} ${num(PH - l.y - l.h)} cm /I${imageIds[l.image]} Do Q`)
      .join('\n');
    const content = enc.encode(ops + '\n');
    objects[contentId - 1] = { dict: `<< /Length ${content.length} >>`, stream: content };
    objects[pageId - 1] = {
      dict: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(PW)} ${num(PH)}] /Resources << /XObject << ${xobj} >> >> /Contents ${contentId} 0 R >>`,
    };
  });

  objects[catalogId - 1] = { dict: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` };
  objects[pagesId - 1] = { dict: `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>` };
  const now = new Date();
  objects[infoId - 1] = {
    dict: `<< /Title ${pdfTextString(spec.title ?? '勞務報酬單')} /Producer (Labor Remuneration Form PWA) /CreationDate ${pdfDate(now)} >>`,
  };

  // 序列化
  const chunks = [];
  let offset = 0;
  const push = (b) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    offset += bytes.length;
  };
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(offset);
    push(`${i + 1} 0 obj\n${o.dict}\n`);
    if (o.stream) {
      push('stream\n');
      push(o.stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  });
  const xrefAt = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
