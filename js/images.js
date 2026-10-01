// 圖片小工具。圖片存成 { type, bytes: ArrayBuffer, width, height }，
// 不直接存 Blob，避免部分 iOS 版本的 IndexedDB 存 Blob 出問題。

/** 用 <img> 解碼（相容 iPad 的 HEIC 照片），回傳可畫到 canvas 的影像 */
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取這張圖片，請換一張 JPG 或 PNG'));
    };
    img.src = url;
  });
}

export function imageSize(img) {
  return { width: img.naturalWidth ?? img.width, height: img.naturalHeight ?? img.height };
}

/** 縮小到最長邊不超過 max，回傳 canvas */
export function downscale(img, max) {
  const { width, height } = imageSize(img);
  const k = Math.min(1, max / Math.max(width, height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * k));
  c.height = Math.max(1, Math.round(height * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), type, quality);
  });
}

export async function recordFromCanvas(canvas, type = 'image/png', quality) {
  const blob = await canvasToBlob(canvas, type, quality);
  return { type, bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height };
}

export function recordToBlob(rec) {
  return new Blob([rec.bytes], { type: rec.type });
}

/** 把存起來的圖片解碼成可以畫的影像 */
export async function decodeRecord(rec) {
  if (!rec) return null;
  const blob = recordToBlob(rec);
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* 改用 <img> */
    }
  }
  return loadImageFile(blob);
}

/** 找出不透明像素的範圍，裁掉四周空白 */
export function trimTransparent(canvas, pad = 6) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width, maxX + pad + 1);
  const y1 = Math.min(height, maxY + pad + 1);
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** 大津法自動找門檻 */
export function otsuThreshold(lum) {
  const hist = new Array(256).fill(0);
  for (const v of lum) hist[v]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 160;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/**
 * 簽名照片去背：比門檻亮的變透明，暗的保留。
 * @param {HTMLCanvasElement} src
 * @param {number} threshold 0-255
 * @param {boolean} toBlack 筆跡統一成黑色
 */
export function removeBackground(src, threshold, toBlack) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const soft = 28;
  for (let i = 0; i < d.length; i += 4) {
    const l = lumOverWhite(d, i);
    const a = Math.max(0, Math.min(1, (threshold - l) / soft + 0.5));
    if (toBlack) {
      d[i] = d[i + 1] = d[i + 2] = 0;
    }
    d[i + 3] = Math.round(a * d[i + 3]);
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** 亮度（透明的地方當作白紙，已經去背的 PNG 簽名才不會整片變黑） */
function lumOverWhite(d, i) {
  const a = d[i + 3] / 255;
  return (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
}

export function luminance(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const lum = new Uint8Array(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = Math.round(lumOverWhite(d, i));
  return lum;
}
