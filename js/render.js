// 在 canvas 上重繪「勞務報酬單」。座標單位是 pt（A4 = 595.28 × 841.89），
// 位置是照公司原始 Word 檔輸出的 PDF 量出來的。
import { CAPITAL_UNITS } from './numerals.js';

export const PAGE = { w: 595.28, h: 841.89 };

const FONT_STACK = '"NotoTC", "PingFang TC", "Heiti TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';
const ASCENT = 1.058; // 原檔字型（微軟正黑體）行頂到基線的距離（em）
const SHADE_TOP = 2.1; // 黃底比行頂高出多少 pt
const SHADE_H = 17.5; // 10pt 字的黃底高度
const UNDERLINE_GAP = 2.55; // 底線在基線下方多少 pt
const AUTOSPACE = 0.25; // Word 會在中文與英數字之間自動留 1/4 字寬
const TEXT_SCALE = 50;
const BOX_CHAR = '□';
const BOX = { adv: 0.66, side: 0.504, lsb: 0.064, stroke: 0.042 }; // 量自原檔（em）

// 原檔「微軟正黑體 粗體」的筆畫粗細最接近 Noto Sans TC Medium
const BOLD = 500;
const REGULAR = 400;

const INK = '#000000';
const RED = '#FF0000';
const YELLOW = '#FFF2CC';
const RULE = 0.5;

const RIGHT_LIMIT = 556; // 表格內文字最右邊界

const HAN = /[⺀-⿟々-〇〡-〩〸-〻㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134F}]/u;
const LATIN = /[A-Za-z0-9]/;

export async function ensureFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load(`${REGULAR} 10px NotoTC`, '測試'),
    document.fonts.load(`${BOLD} 10px NotoTC`, '測試'),
  ]);
}

/** 依 Word 的中英自動間距規則切段 */
function autospaceSegments(str) {
  const segs = [];
  let cur = '';
  let prev = '';
  for (const ch of str) {
    const cls = HAN.test(ch) ? 'H' : LATIN.test(ch) ? 'L' : 'O';
    if ((prev === 'H' && cls === 'L') || (prev === 'L' && cls === 'H')) {
      segs.push(cur);
      cur = '';
    }
    cur += ch;
    prev = cls;
  }
  if (cur) segs.push(cur);
  return segs;
}

class Pen {
  constructor(ctx) {
    this.ctx = ctx;
  }

  // 字級放大 TEXT_SCALE 倍排字再縮回來：瀏覽器在小字級時會把每個字寬四捨五入成整數，
  // 10pt 的「1」會從 5.7 變成 6，數字就被撐開
  setFont(size, bold) {
    this.size = size;
    this.ctx.font = `${bold ? BOLD : REGULAR} ${size * TEXT_SCALE}px ${FONT_STACK}`;
  }

  measure(seg) {
    let w = 0;
    seg.split(BOX_CHAR).forEach((part, i) => {
      if (i > 0) w += BOX.adv * this.size;
      if (part) w += this.ctx.measureText(part).width / TEXT_SCALE;
    });
    return w;
  }

  /** 畫一段字（不含自動間距的切段），回傳寬度 */
  drawSeg(seg, x, baseline) {
    const { ctx } = this;
    let cx = x;
    seg.split(BOX_CHAR).forEach((part, i) => {
      if (i > 0) {
        // 原檔的勾選框是比中文字小的方框，照原檔尺寸畫
        const s = this.size;
        const side = BOX.side * s;
        const t = BOX.stroke * s;
        const bx = cx + BOX.lsb * s;
        const by = baseline - side;
        ctx.fillRect(bx, by, side, t);
        ctx.fillRect(bx, baseline - t, side, t);
        ctx.fillRect(bx, by, t, side);
        ctx.fillRect(bx + side - t, by, t, side);
        cx += BOX.adv * s;
      }
      if (part) {
        ctx.save();
        ctx.translate(cx, baseline);
        ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
        ctx.fillText(part, 0, 0);
        ctx.restore();
        cx += ctx.measureText(part).width / TEXT_SCALE;
      }
    });
    return cx - x;
  }

  width(str, size = 10, bold = true) {
    if (!str) return 0;
    this.setFont(size, bold);
    const segs = autospaceSegments(str);
    let w = 0;
    for (const s of segs) w += this.measure(s);
    return w + (segs.length - 1) * AUTOSPACE * size;
  }

  /** 在寬度內能用的最大字級 */
  fitSize(str, maxWidth, size = 10, bold = true, min = 6) {
    let s = size;
    while (s > min && this.width(str, s, bold) > maxWidth) s -= 0.25;
    return s;
  }

  shade(x0, x1, top, h = SHADE_H) {
    if (x1 <= x0) return;
    this.ctx.fillStyle = YELLOW;
    this.ctx.fillRect(x0, top - SHADE_TOP, x1 - x0, h);
  }

  underline(x0, x1, baseline, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x0, baseline + UNDERLINE_GAP - RULE / 2, x1 - x0, RULE);
  }

  /**
   * 寫一段字。top 是 Word 的行頂位置；回傳結束的 x。
   * opts: size, lineSize（決定基線用的字級）, bold, color, shade, underline, maxWidth
   */
  text(str, x, top, opts = {}) {
    const lineSize = opts.lineSize ?? opts.size ?? 10;
    const bold = opts.bold ?? true;
    let size = opts.size ?? 10;
    if (opts.maxWidth) size = this.fitSize(str, opts.maxWidth, size, bold);
    const w = this.width(str, size, bold);
    const baseline = top + ASCENT * lineSize;
    if (opts.shade) this.shade(x, x + w, top);
    if (!str) return x;
    this.setFont(size, bold);
    this.ctx.fillStyle = opts.color ?? INK;
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';
    let cx = x;
    for (const seg of autospaceSegments(str)) cx += this.drawSeg(seg, cx, baseline) + AUTOSPACE * size;
    if (opts.underline) this.underline(x, x + w, baseline, opts.color ?? INK);
    return x + w;
  }

  /** 置中寫字 */
  center(str, cx, top, opts = {}) {
    const size = opts.maxWidth ? this.fitSize(str, opts.maxWidth, opts.size ?? 10, opts.bold ?? true) : opts.size ?? 10;
    const w = this.width(str, size, opts.bold ?? true);
    return this.text(str, cx - w / 2, top, { ...opts, size, maxWidth: undefined, lineSize: opts.lineSize ?? opts.size ?? 10 });
  }

  /** 有底線的填空欄位（值置中） */
  slot(value, x0, x1, top, opts = {}) {
    const size = opts.size ?? 10;
    const lineSize = opts.lineSize ?? size;
    const bold = opts.bold ?? true;
    const baseline = top + ASCENT * lineSize;
    if (opts.shade) this.shade(x0, x1, top);
    const v = value ?? '';
    const s = this.fitSize(v, x1 - x0 - 2, size, bold);
    const w = this.width(v, s, bold);
    this.text(v, (x0 + x1) / 2 - w / 2, top, { size: s, lineSize, bold, color: opts.color });
    this.underline(x0, x1, baseline, opts.color ?? INK);
    return x1;
  }
}

function hline(ctx, y, x0, x1) {
  ctx.fillStyle = INK;
  ctx.fillRect(x0 - RULE / 2, y - RULE / 2, x1 - x0 + RULE, RULE);
}

function vline(ctx, x, y0, y1) {
  ctx.fillStyle = INK;
  ctx.fillRect(x - RULE / 2, y0 - RULE / 2, RULE, y1 - y0 + RULE);
}

const box = (on) => (on ? 'Ｖ' : '□');

/** 把文字切成最多 maxLines 行（逐字換行） */
function wrap(pen, str, maxWidth, size, bold) {
  const lines = [];
  let cur = '';
  for (const ch of str) {
    if (cur && pen.width(cur + ch, size, bold) > maxWidth) {
      lines.push(cur);
      cur = ch.trim() ? ch : '';
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 圖片等比例縮放後放進框內（置中） */
export function containRect(iw, ih, x, y, w, h, alignBottom = false) {
  const k = Math.min(w / iw, h / ih);
  const dw = iw * k;
  const dh = ih * k;
  return { x: x + (w - dw) / 2, y: alignBottom ? y + h - dh : y + (h - dh) / 2, w: dw, h: dh };
}

export const PHOTO_BOX = {
  front: { x: 15.5 + 5, y: 619 + 3, w: 269 - 10, h: 161.5 - 6 },
  back: { x: 284.5 + 5, y: 619 + 3, w: 276.5 - 10, h: 161.5 - 6 },
};

const SIGN_BOX = { x: 246.5, y: 524, w: 129, h: 40 };

/** 身分證浮水印文字，公司名稱取自 Word 檔 */
export function watermarkText(company) {
  return `限${(company ?? '').trim()}勞務報酬單使用`;
}

/**
 * 把浮水印直接畫進身分證照片的像素裡。
 * 不另外疊一層，PDF 裡就拿不到沒有浮水印的原圖。
 * @returns {HTMLCanvasElement}
 */
export function watermarkPhoto(img, text) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  if (!text) return c;
  // 常見的身分證影本浮水印：小字、往右下斜、整張重複鋪滿；
  // 白字加淡灰邊，深色和淺色的地方都看得到，又不會蓋掉證件上的字
  const size = Math.max(9, w * 0.03);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(0.2);
  g.font = `${BOLD} ${size}px ${FONT_STACK}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1, size * 0.08);
  g.strokeStyle = 'rgba(60, 60, 60, 0.35)';
  g.fillStyle = 'rgba(255, 255, 255, 0.6)';
  const stepX = g.measureText(text).width + size * 1.5;
  const stepY = size * 2.6;
  const r = Math.hypot(w, h) / 2 + stepX;
  for (let y = -r, row = 0; y <= r; y += stepY, row++) {
    // 每一行錯開，看起來不會排成直的一整排
    for (let x = -r - ((row * size * 3.7) % stepX); x <= r; x += stepX) {
      g.strokeText(text, x, y);
      g.fillText(text, x, y);
    }
  }
  g.restore();
  return c;
}

/** 簽名列：黃底、「領款人:」、簽名線、簽名、（簽章）、日期 */
export function drawSignatureRow(ctx, signature, signDate) {
  const pen = new Pen(ctx);
  const t = 552.2;
  ctx.fillStyle = YELLOW;
  ctx.fillRect(201.5, 531.5, 504.0 - 201.5, 567.5 - 531.5);
  pen.text('領款人:', 203.9, t);
  ctx.fillStyle = INK;
  ctx.fillRect(246.5, 562.0 - 0.935, 129, 1.87);
  if (signature) {
    const r = containRect(signature.width, signature.height, SIGN_BOX.x, SIGN_BOX.y, SIGN_BOX.w, SIGN_BOX.h, true);
    ctx.drawImage(signature, r.x, r.y, r.w, r.h);
  }
  pen.text('（簽章）', 385.3, t);
  pen.text(`日期：${signDate ?? ''}`, 435.3, t, { maxWidth: 561 - 3 - 435.3 });
}

/**
 * 畫一整頁報酬單。
 * @param {CanvasRenderingContext2D} ctx 已設定好 pt→px 轉換的 context
 * @param {object} f 表單資料（parse.js 的 emptyForm 格式，mailAddress 已決定好）
 * @param {{signature?: CanvasImageSource & {width:number,height:number}, idFront?: any, idBack?: any}} assets
 * @param {{photos?: boolean}} options photos=false 時不畫身分證（PDF 會另外嵌入照片）
 * @returns {{photos: Array<{key: string, x: number, y: number, w: number, h: number}>}}
 */
export function drawForm(ctx, f, assets = {}, { photos = true } = {}) {
  const pen = new Pen(ctx);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);

  // ── 標題 ──
  pen.center('勞務報酬單', PAGE.w / 2, 31.7, { size: 16 });
  pen.center(f.company, PAGE.w / 2, 63.6, { size: 16, maxWidth: 540 });

  let t = 93.8;
  pen.text(`${box(f.kind.salary)}薪資`, 50.8, t);
  pen.text(`${box(f.kind.other)}其他`, 85.8, t);
  pen.text('填表日期:', 282.3, t);
  pen.center(f.fillDate.y, 341.4, t);
  pen.text('年', 360.3, t);
  pen.center(f.fillDate.m, 383.3, t);
  pen.text('月', 399.7, t);
  pen.center(f.fillDate.d, 427.7, t);
  pen.text('日', 444.1, t);
  pen.text(`單號：${f.serialNo ?? ''}`, 456.6, t, { maxWidth: 561 - 456.6 });

  // 身分證字號和聯絡電話在原檔是同一段，中間的空白也有黃底
  const idEnd = pen.width(`身分證字號：${f.idNo}`) + 172.6;
  const phoneX = Math.max(315.9, idEnd + 12);
  pen.shade(172.6, Math.min(RIGHT_LIMIT, phoneX + pen.width(`聯絡電話：${f.phone}`)), 141.6);

  // ── 左側直排標題 ──
  const vlabel = (str, top0, step) => [...str].forEach((ch, i) => pen.center(ch, 29.75, top0 + i * step));
  vlabel('領款人基本資料', 120.2, 17.3);
  vlabel('勞務內容', 253.2, 17.27);
  vlabel('領款金額', 377.5, 17.27);

  // ── 國籍 ──
  pen.text(`${box(f.nationality === 'local')}本國籍`, 49.4, 111.6);
  pen.text(`${box(f.nationality === 'foreign183')}外國籍`, 49.4, 146.4);
  pen.text('在台滿183天', 51.9, 163.6);
  pen.text(`${box(f.nationality === 'foreignUnder183')}外國籍`, 49.4, 198.2);
  pen.text('在台未滿183天', 59.4, 215.5);

  // ── 基本資料 ──
  const fieldW = RIGHT_LIMIT - 172.6;
  pen.text(`姓名：${f.name} `, 172.6, 111.6, { shade: true, maxWidth: fieldW });
  pen.text(`身分證字號：${f.idNo}`, 172.6, 141.6);
  pen.text(`聯絡電話：${f.phone}`, phoneX, 141.6, { maxWidth: RIGHT_LIMIT - phoneX });
  pen.text(`居留證/護照 NO.：${f.residentNo}`, 172.6, 158.8, { shade: true, maxWidth: fieldW });
  {
    const x = pen.text('戶籍地址：', 172.6, 177.1, { shade: true });
    pen.text(f.regAddress, x, 177.1, { shade: true, bold: false, maxWidth: RIGHT_LIMIT - x });
  }
  pen.text(`通訊地址：${f.mailAddress ?? ''}`, 172.6, 194.8, { shade: true, maxWidth: fieldW });

  // ── 勞務內容 ──
  {
    const str = `工作內容（下稱「本工作」）：${f.work}`;
    const maxW = RIGHT_LIMIT - 49.4;
    if (pen.width(str, 8.5) <= maxW) {
      pen.text(str, 49.4, 250.5, { shade: true, maxWidth: maxW, lineSize: 10 });
    } else {
      // 太長就分兩行
      let size = 9;
      let lines = wrap(pen, str, maxW, size, true);
      while (lines.length > 2 && size > 6) {
        size -= 0.25;
        lines = wrap(pen, str, maxW, size, true);
      }
      lines.slice(0, 2).forEach((ln, i) => {
        const top = 249.2 + i * size * 1.25;
        const w = pen.width(ln, size);
        pen.shade(49.4, 49.4 + w, top + SHADE_TOP, size * 1.25);
        pen.text(ln, 49.4, top, { size });
      });
    }
  }
  t = 276.4;
  pen.shade(49.4, 433.5, t);
  pen.text('期間：自', 49.4, t);
  pen.slot(f.period.fy, 89.4, 144.8, t);
  pen.text('年', 144.8, t);
  pen.slot(f.period.fm, 154.8, 198.3, t);
  pen.text('月', 198.3, t);
  pen.slot(f.period.fd, 208.3, 250.2, t);
  pen.text('日至', 250.2, t);
  pen.slot(f.period.ty, 275.6, 325.6, t);
  pen.text('年', 325.6, t);
  pen.slot(f.period.tm, 335.6, 369.0, t);
  pen.text('月', 369.0, t);
  pen.slot(f.period.td, 379.1, 423.4, t);
  pen.text('日', 423.4, t);

  pen.text(f.category, 49.4, 298.1, { size: 12, maxWidth: RIGHT_LIMIT - 49.4 });

  // ── 領款金額 ──
  {
    t = 345.3;
    let x = pen.text('支領金額：', 55.0, t);
    const x0 = x;
    pen.shade(x0, x0 + pen.width('新台幣') + 61.3 + pen.width('元'), t);
    x = pen.text('新台幣', x, t);
    x = pen.slot(f.gross, x, x + 61.3, t);
    pen.text('元', x, t);

    const red = { color: RED };
    t = 363.8;
    x = pen.text('代扣所得稅（', 55.0, t, red);
    x = pen.slot(f.taxRate, x, x + 19.4, t, red);
    x = pen.text('%）：新台幣', x, t, red);
    x = pen.slot(f.tax, x, x + 23, t, red);
    pen.text('元', x, t, red);

    t = 383.5;
    x = pen.text(`二代健保補充保費(${f.nhiRate}%)：新台幣`, 55.0, t, red);
    x = pen.slot(f.nhi, x, x + 26, t, red);
    pen.text('元', x, t, red);

    t = 400.8;
    x = pen.text('支領淨額：新台幣', 55.0, t, red);
    x = pen.slot(f.net, x, x + 48.8, t, red);
    pen.text('元', x, t, red);

    t = 418.0;
    x = pen.text('付款方式：', 55.0, t);
    x = pen.text(`${box(f.pay.cash)}現金`, x, t) + 4.9;
    x = pen.text(`${box(f.pay.cheque)}支票`, x, t) + 7.4;
    pen.text(`${box(f.pay.transfer)}匯款`, x, t);
  }

  // ── 右側代扣說明 ──
  {
    const notes = f.notes ?? [];
    const n = notes.length;
    const step = n > 1 ? Math.min(17.3, (496.5 - 325.4 - 14) / (n - 1)) : 17.3;
    notes.forEach((raw, i) => {
      const lead = /^[ 　]*/.exec(raw)[0];
      const indent = [...lead].reduce((a, c) => a + (c === '　' ? 10 : 2.5), 0);
      const x = 276.0 + indent;
      pen.text(raw.trim(), x, 325.4 + i * step, { maxWidth: 561 - 3 - x, lineSize: 10 });
    });
  }

  // ── 收據文字 ──
  {
    t = 498.9;
    const units = CAPITAL_UNITS;
    const slotW = [25, 25, 30, 22.5, 20, 25];
    const head1 = '茲收到 ';
    const comp = `${f.company} `;
    const head2 = '支付本人之報酬，共計 ';
    const nt = '新台幣';
    const total = (s) => pen.width(head1, s) + pen.width(comp, s) + pen.width(head2, s) + pen.width(nt, s)
      + slotW.reduce((a, b) => a + b, 0) * (s / 10) + units.reduce((a, u) => a + pen.width(u, s), 0);
    let size = 10;
    while (size > 7 && 21.4 + total(size) > 561 - 4) size -= 0.25;
    const k = size / 10;
    let x = pen.text(head1, 21.4, t, { size, lineSize: 10 });
    x = pen.text(comp, x, t, { size, lineSize: 10, underline: true });
    x = pen.text(head2, x, t, { size, lineSize: 10 });
    x = pen.text(nt, x, t, { size, lineSize: 10 });
    pen.shade(x, 21.4 + total(size), t);
    const digits = f.capital ?? [];
    units.forEach((u, i) => {
      x = pen.slot(digits[i] ?? '', x, x + slotW[i] * k, t, { size, lineSize: 10 });
      x = pen.text(u, x, t, { size, lineSize: 10 });
    });

    t = 516.2;
    const s1 = '本人保證提供之勞務服務並無違反法令或侵害他人權益，並同意 ';
    const s2 = '使用本工作之所有內容。';
    let size2 = 10;
    while (size2 > 7 && 21.4 + pen.width(s1, size2) + pen.width(comp, size2) + pen.width(s2, size2) > 561 - 4) size2 -= 0.25;
    x = pen.text(s1, 21.4, t, { size: size2, lineSize: 10 });
    x = pen.text(comp, x, t, { size: size2, lineSize: 10, underline: true });
    pen.text(s2, x, t, { size: size2, lineSize: 10 });
  }

  drawSignatureRow(ctx, assets.signature, f.signDate);
  pen.text('請附身分證影本（外籍人士請附居留證/護照影本）', 370.9, 569.4, { size: 8 });

  // ── 身分證黏貼處 ──
  pen.text('身分證（居留證/護照）影本黏貼處', 218.3, 583.9);
  pen.text('經辦人：', 430.2, 583.9);
  pen.center('正面', 150.0, 601.6, { shade: true });
  pen.center('反面', 422.75, 601.6, { shade: true });

  // ── 表格框線（最後畫，才不會被黃底蓋住）──
  const L = 15.5;
  const R = 561.0;
  for (const [y, x0] of [[109.0, L], [139.0, 167], [174.5, 167], [192.5, 167], [248.0, L], [274.0, 44], [295.0, 44], [323.0, L], [496.5, L], [581.5, L], [599.5, L], [619.0, L], [780.5, L]]) {
    hline(ctx, y, x0, R);
  }
  vline(ctx, L, 109.0, 581.5);
  vline(ctx, R, 109.0, 581.5);
  vline(ctx, L, 599.5, 780.5);
  vline(ctx, R, 599.5, 780.5);
  vline(ctx, 44.0, 109.0, 496.5);
  vline(ctx, 167.0, 109.0, 248.0);
  vline(ctx, 270.0, 323.0, 496.5);
  vline(ctx, 284.5, 599.5, 780.5);

  const placed = [];
  for (const [key, img] of [['front', assets.idFront], ['back', assets.idBack]]) {
    if (!img) continue;
    const b = PHOTO_BOX[key];
    const r = containRect(img.width, img.height, b.x, b.y, b.w, b.h);
    placed.push({ key, ...r });
    if (photos) ctx.drawImage(img, r.x, r.y, r.w, r.h);
  }

  ctx.restore();
  return { photos: placed };
}

/**
 * 建立一張已經設定好比例的 canvas 並畫出報酬單。
 * @param {number} pxPerPt 每 pt 幾個像素
 */
export function renderToCanvas(f, assets, pxPerPt, options) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE.w * pxPerPt);
  canvas.height = Math.round(PAGE.h * pxPerPt);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(canvas.width / PAGE.w, 0, 0, canvas.height / PAGE.h, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  const info = drawForm(ctx, f, assets, options);
  return { canvas, ctx, ...info };
}
