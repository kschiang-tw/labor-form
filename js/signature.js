// 手寫簽名板：手指、滑鼠、Apple Pencil（有筆壓）都可以。
import { trimTransparent } from './images.js';

export class SignaturePad {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.current = null;
    this.onchange = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
  }

  /** 依畫面大小重設解析度（打開對話框後呼叫） */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.cssW = r.width;
    this.cssH = r.height;
    this.redraw();
  }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    // 滑鼠和手指沒有筆壓資訊時固定 0.5
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, p };
  }

  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.current = [this.point(e)];
    this.strokes.push(this.current);
    this.redraw();
  }

  move(e) {
    if (!this.current) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs) this.current.push(this.point(ev));
    this.redraw();
  }

  up() {
    if (!this.current) return;
    this.current = null;
    this.onchange?.();
  }

  clear() {
    this.strokes = [];
    this.redraw();
    this.onchange?.();
  }

  undo() {
    this.strokes.pop();
    this.redraw();
    this.onchange?.();
  }

  isEmpty() {
    return this.strokes.length === 0;
  }

  redraw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(ctx, this.strokes, canvas.width, canvas.height);
  }

  /** 輸出去掉空白的透明背景 PNG（canvas） */
  exportCanvas() {
    if (this.isEmpty()) return null;
    // 以固定高度輸出，讓簽名在 PDF 上夠清楚
    const H = 600;
    const W = Math.round(H * (this.cssW / this.cssH || 3));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    drawStrokes(c.getContext('2d'), this.strokes, W, H);
    return trimTransparent(c, 8);
  }
}

function drawStrokes(ctx, strokes, W, H) {
  const base = H * 0.022;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  for (const s of strokes) {
    if (s.length === 1) {
      const p = s[0];
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, (base * (0.6 + p.p * 0.8)) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // 每一小段依筆壓調整粗細，用中點做二次曲線讓線條平滑
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      const prevMid = i > 1 ? mid(s[i - 2], a) : a;
      const m = mid(a, b);
      ctx.beginPath();
      ctx.lineWidth = base * (0.6 + ((a.p + b.p) / 2) * 0.8);
      ctx.moveTo(prevMid.x * W, prevMid.y * H);
      ctx.quadraticCurveTo(a.x * W, a.y * H, m.x * W, m.y * H);
      ctx.stroke();
    }
    const last = s[s.length - 1];
    const pm = mid(s[s.length - 2], last);
    ctx.beginPath();
    ctx.moveTo(pm.x * W, pm.y * H);
    ctx.lineTo(last.x * W, last.y * H);
    ctx.stroke();
  }
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 };
}
