// 身分證照片裁切／旋轉工具
export const ID_CARD_RATIO = 85.6 / 54;

const HANDLE = 22; // 觸控熱區（CSS px）
const MIN = 40; // 最小裁切邊長（圖片 px）

export class Cropper {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.src = null;
    this.rect = null;
    this.ratio = null;
    this.drag = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => (this.drag = null));
    canvas.addEventListener('pointercancel', () => (this.drag = null));
  }

  /** @param {HTMLCanvasElement} src */
  setImage(src) {
    this.src = src;
    this.rect = { x: 0, y: 0, w: src.width, h: src.height };
    if (this.ratio) this.applyRatio();
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.draw();
  }

  get view() {
    const pad = 14 * this.dpr;
    const cw = this.canvas.width - pad * 2;
    const ch = this.canvas.height - pad * 2;
    const k = Math.min(cw / this.src.width, ch / this.src.height);
    return { k, ox: pad + (cw - this.src.width * k) / 2, oy: pad + (ch - this.src.height * k) / 2 };
  }

  rotate(dir) {
    if (!this.src) return;
    const s = this.src;
    const c = document.createElement('canvas');
    c.width = s.height;
    c.height = s.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    this.setImage(c);
  }

  setRatio(ratio) {
    this.ratio = ratio;
    if (this.src && ratio) this.applyRatio();
    this.draw();
  }

  applyRatio() {
    const r = this.rect;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    let w = r.w;
    let h = w / this.ratio;
    if (h > r.h) {
      h = r.h;
      w = h * this.ratio;
    }
    this.rect = this.clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  clampRect(r) {
    const W = this.src.width;
    const H = this.src.height;
    const w = Math.min(r.w, W);
    const h = Math.min(r.h, H);
    return { x: Math.min(Math.max(0, r.x), W - w), y: Math.min(Math.max(0, r.y), H - h), w, h };
  }

  toImage(e) {
    const b = this.canvas.getBoundingClientRect();
    const px = (e.clientX - b.left) * this.dpr;
    const py = (e.clientY - b.top) * this.dpr;
    const v = this.view;
    return { x: (px - v.ox) / v.k, y: (py - v.oy) / v.k, tol: (HANDLE * this.dpr) / v.k };
  }

  down(e) {
    if (!this.src) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.toImage(e);
    const r = this.rect;
    const corners = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h] };
    for (const [name, [cx, cy]] of Object.entries(corners)) {
      if (Math.abs(p.x - cx) < p.tol && Math.abs(p.y - cy) < p.tol) {
        this.drag = { type: 'corner', name, start: p, rect: { ...r } };
        return;
      }
    }
    if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) {
      this.drag = { type: 'move', start: p, rect: { ...r } };
    }
  }

  move(e) {
    if (!this.drag) return;
    e.preventDefault();
    const p = this.toImage(e);
    const d = this.drag;
    const r0 = d.rect;
    if (d.type === 'move') {
      this.rect = this.clampRect({ ...r0, x: r0.x + p.x - d.start.x, y: r0.y + p.y - d.start.y });
    } else {
      // 對角固定，拖動的角跟著手指
      const ax = d.name.includes('w') ? r0.x + r0.w : r0.x;
      const ay = d.name.includes('n') ? r0.y + r0.h : r0.y;
      const W = this.src.width;
      const H = this.src.height;
      const px = Math.min(Math.max(0, p.x), W);
      const py = Math.min(Math.max(0, p.y), H);
      let w = Math.max(MIN, Math.abs(px - ax));
      let h = Math.max(MIN, Math.abs(py - ay));
      if (this.ratio) {
        if (w / h > this.ratio) h = w / this.ratio;
        else w = h * this.ratio;
        const maxW = d.name.includes('w') ? ax : W - ax;
        const maxH = d.name.includes('n') ? ay : H - ay;
        const k = Math.min(1, maxW / w, maxH / h);
        w *= k;
        h *= k;
      } else {
        w = Math.min(w, d.name.includes('w') ? ax : W - ax);
        h = Math.min(h, d.name.includes('n') ? ay : H - ay);
      }
      this.rect = {
        x: d.name.includes('w') ? ax - w : ax,
        y: d.name.includes('n') ? ay - h : ay,
        w,
        h,
      };
    }
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.src) return;
    const v = this.view;
    const iw = this.src.width * v.k;
    const ih = this.src.height * v.k;
    ctx.drawImage(this.src, v.ox, v.oy, iw, ih);
    const r = this.rect;
    const x = v.ox + r.x * v.k;
    const y = v.oy + r.y * v.k;
    const w = r.w * v.k;
    const h = r.h * v.k;
    // 裁切框外變暗
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(v.ox, v.oy, iw, ih);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * this.dpr;
    ctx.strokeRect(x, y, w, h);
    // 三分線
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(x + w * f, y);
      ctx.lineTo(x + w * f, y + h);
      ctx.moveTo(x, y + h * f);
      ctx.lineTo(x + w, y + h * f);
    }
    ctx.stroke();
    // 四角把手
    const L = 18 * this.dpr;
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 4 * this.dpr;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(cx, cy + sy * L);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * L, cy);
    }
    ctx.stroke();
  }

  /** 輸出裁切後的影像（最長邊不超過 maxSide） */
  export(maxSide = 1400) {
    const r = this.rect;
    const k = Math.min(1, maxSide / Math.max(r.w, r.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * k));
    c.height = Math.max(1, Math.round(r.h * k));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }
}
