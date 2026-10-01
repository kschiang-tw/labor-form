import { readDocxParagraphs } from './docx.js';
import { parseForm, sortKey, yearMonth } from './parse.js';
import { parseAmount, formatAmount, toCapitalDigits, CAPITAL_UNITS } from './numerals.js';
import { PAGE, drawSignatureRow, ensureFonts, renderToCanvas, watermarkPhoto, watermarkText } from './render.js';
import { buildPdf, encodeRgb } from './pdf.js';
import { store, requestPersistence } from './store.js';
import {
  loadImageFile, downscale, recordFromCanvas, recordToBlob, decodeRecord, canvasToBlob,
  trimTransparent, removeBackground, luminance, otsuThreshold,
} from './images.js';
import { SignaturePad } from './signature.js';
import { Cropper, ID_CARD_RATIO } from './cropper.js';

const PX_PER_PT = 4; // PDF 解析度：4 px/pt ≈ 288 dpi

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  settings: { address: '', signature: null, idFront: null, idBack: null },
  images: { signature: null, idFront: null, idBack: null },
  forms: [],
  result: null,
  resultUrl: null,
};

let nextId = 1;

// ───────────────────────── 共用 ─────────────────────────

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

/** ✕ 按鈕關閉；backdrop=true 時點對話框外面也會關閉 */
function setupDialog(dlg, backdrop = false) {
  if (backdrop) {
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
  }
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
}

// ───────────────────────── 分頁 ─────────────────────────

function showTab(name) {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $('#tab-make').hidden = name !== 'make';
  $('#tab-me').hidden = name !== 'me';
  if (name === 'me') drawSignaturePreview();
  window.scrollTo({ top: 0 });
}

// ───────────────────────── 設定 ─────────────────────────

async function loadSettings() {
  try {
    const [address, signature, idFront, idBack] = await Promise.all(
      ['address', 'signature', 'idFront', 'idBack'].map((k) => store.get(k)),
    );
    Object.assign(state.settings, { address: address ?? '', signature, idFront, idBack });
    for (const k of ['signature', 'idFront', 'idBack']) state.images[k] = await decodeRecord(state.settings[k]);
  } catch (err) {
    console.error(err);
    toast('讀取已儲存的資料失敗，請重新設定');
  }
}

function missingSettings() {
  const m = [];
  if (!state.settings.address.trim()) m.push('通訊地址');
  if (!state.settings.signature) m.push('簽名');
  if (!state.settings.idFront) m.push('身分證正面');
  if (!state.settings.idBack) m.push('身分證反面');
  return m;
}

function refreshSetupState() {
  const m = missingSettings();
  $('#setup-notice').hidden = m.length === 0;
  $('#setup-missing').textContent = m.join('、');
  $('#me-dot').hidden = m.length === 0;
  $('#sig-del').hidden = !state.settings.signature;
  for (const key of ['idFront', 'idBack']) {
    const slot = $(`.id-slot[data-key="${key}"]`);
    const img = $('img', slot);
    const rec = state.settings[key];
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    if (rec) {
      const url = URL.createObjectURL(recordToBlob(rec));
      img.src = url;
      img.dataset.url = url;
    } else {
      img.removeAttribute('src');
      delete img.dataset.url;
    }
    img.hidden = !rec;
    $('.empty', slot).hidden = !!rec;
    $(`[data-id-del="${key}"]`).hidden = !rec;
  }
}

/** 儲存一項設定；失敗時提示並回傳 false */
async function saveSetting(key, value) {
  try {
    if (value === null || value === undefined) await store.del(key);
    else await store.set(key, value);
  } catch (err) {
    console.error(err);
    toast('無法儲存到這台裝置（可能是無痕模式或空間不足）', 5000);
    return false;
  }
  state.settings[key] = value;
  if (key !== 'address') state.images[key] = await decodeRecord(value);
  if (key === 'idFront' || key === 'idBack') watermarked.clear();
  requestPersistence();
  invalidateResult();
  refreshSetupState();
  return true;
}

/** 簽名預覽：直接用報酬單的簽名列樣式畫出來 */
async function drawSignaturePreview() {
  const canvas = $('#sig-preview');
  const region = { x: 196, y: 521, w: 314, h: 50 };
  const cssW = canvas.parentElement.clientWidth || 600;
  const k = (cssW / region.w) * Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(region.w * k);
  canvas.height = Math.round(region.h * k);
  await ensureFonts();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -region.x * k, -region.y * k);
  drawSignatureRow(ctx, state.images.signature, '');
}

// ── 通訊地址 ──
function setupAddress() {
  const input = $('#address');
  input.value = state.settings.address;
  let t;
  input.addEventListener('input', () => {
    $('#address-state').textContent = '儲存中…';
    clearTimeout(t);
    t = setTimeout(async () => {
      const ok = await saveSetting('address', input.value.trim());
      $('#address-state').textContent = ok ? '已儲存在這台裝置' : '儲存失敗';
      renderForms();
    }, 400);
  });
}

// ── 手寫簽名 ──
function setupSignaturePad() {
  const dlg = $('#dlg-sign');
  setupDialog(dlg);
  const pad = new SignaturePad($('#pad'));
  const saveBtn = $('#pad-save');
  pad.onchange = () => (saveBtn.disabled = pad.isEmpty());
  $('#sig-draw').addEventListener('click', () => {
    dlg.showModal();
    pad.strokes = [];
    requestAnimationFrame(() => pad.resize());
    saveBtn.disabled = true;
  });
  $('#pad-undo').addEventListener('click', () => pad.undo());
  $('#pad-clear').addEventListener('click', () => pad.clear());
  saveBtn.addEventListener('click', async () => {
    const c = pad.exportCanvas();
    if (!c) return;
    if (!(await saveSetting('signature', await recordFromCanvas(c, 'image/png')))) return;
    dlg.close();
    drawSignaturePreview();
    toast('簽名已儲存');
  });
  window.addEventListener('resize', () => dlg.open && pad.resize());
}

// ── 匯入簽名圖片 ──
function setupSignatureImport() {
  const dlg = $('#dlg-sigimg');
  setupDialog(dlg);
  const view = $('#sigimg-canvas');
  const thr = $('#sigimg-thr');
  const black = $('#sigimg-black');
  let src = null;
  let processed = null;

  const update = () => {
    if (!src) return;
    processed = removeBackground(src, +thr.value, black.checked);
    view.width = processed.width;
    view.height = processed.height;
    const ctx = view.getContext('2d');
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(processed, 0, 0);
  };

  $('#sig-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      src = downscale(await loadImageFile(file), 1600);
      const t = otsuThreshold(luminance(src));
      thr.value = String(Math.min(235, Math.max(60, t + 10)));
      update();
      dlg.showModal();
    } catch (err) {
      toast(err.message);
    }
  });
  thr.addEventListener('input', update);
  black.addEventListener('change', update);
  $('#sigimg-rot').addEventListener('click', () => {
    if (!src) return;
    const c = document.createElement('canvas');
    c.width = src.height;
    c.height = src.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    src = c;
    update();
  });
  $('#sigimg-save').addEventListener('click', async () => {
    if (!processed) return;
    const trimmed = trimTransparent(processed, 8);
    if (!trimmed) {
      toast('看不到筆跡，請把「去背」往右拉一點');
      return;
    }
    if (!(await saveSetting('signature', await recordFromCanvas(downscale(trimmed, 1200), 'image/png')))) return;
    dlg.close();
    drawSignaturePreview();
    toast('簽名已儲存');
  });
  $('#sig-del').addEventListener('click', async () => {
    if (!confirm('確定要刪除簽名嗎？')) return;
    await saveSetting('signature', null);
    drawSignaturePreview();
  });
}

// ── 身分證 ──
function setupIdPhotos() {
  const dlg = $('#dlg-crop');
  setupDialog(dlg);
  const cropper = new Cropper($('#crop-canvas'));
  const ratio = $('#crop-ratio');
  let targetKey = null;

  for (const input of $$('[data-id-input]')) {
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      targetKey = input.dataset.idInput;
      try {
        const img = await loadImageFile(file);
        $('#crop-title').textContent = targetKey === 'idFront' ? '裁切身分證正面' : '裁切身分證反面';
        dlg.showModal();
        cropper.setRatio(ratio.checked ? ID_CARD_RATIO : null);
        requestAnimationFrame(() => cropper.setImage(downscale(img, 2400)));
      } catch (err) {
        toast(err.message);
      }
    });
  }
  ratio.addEventListener('change', () => cropper.setRatio(ratio.checked ? ID_CARD_RATIO : null));
  $('#crop-left').addEventListener('click', () => cropper.rotate(-1));
  $('#crop-right').addEventListener('click', () => cropper.rotate(1));
  $('#crop-save').addEventListener('click', async () => {
    if (!targetKey) return;
    const out = cropper.export(1400);
    if (!(await saveSetting(targetKey, await recordFromCanvas(out, 'image/jpeg', 0.9)))) return;
    dlg.close();
    toast(targetKey === 'idFront' ? '身分證正面已儲存' : '身分證反面已儲存');
  });
  window.addEventListener('resize', () => dlg.open && cropper.resize());

  for (const btn of $$('[data-id-del]')) {
    btn.addEventListener('click', async () => {
      if (!confirm('確定要刪除這張照片嗎？')) return;
      await saveSetting(btn.dataset.idDel, null);
    });
  }
}

function setupWipe() {
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('會刪除這台裝置上的通訊地址、簽名和身分證照片，確定嗎？')) return;
    await store.clear();
    state.settings = { address: '', signature: null, idFront: null, idBack: null };
    state.images = { signature: null, idFront: null, idBack: null };
    watermarked.clear();
    $('#address').value = '';
    clearForms();
    refreshSetupState();
    drawSignaturePreview();
    toast('已清除所有資料');
  });
}

// ───────────────────────── 報酬單清單 ─────────────────────────

function resolvedData(form) {
  const d = form.data;
  const mail = form.mailOverride ?? (state.settings.address.trim() || d.mailAddress);
  return { ...d, mailAddress: mail };
}

// 加了浮水印的身分證照片，依浮水印文字快取（同一個月通常都是同一家公司）
const watermarked = new Map();

/** 這一份報酬單要用的簽名與身分證（身分證已加浮水印） */
function formAssets(form) {
  const text = watermarkText(form.data.company);
  if (!watermarked.has(text)) {
    watermarked.set(text, {
      idFront: state.images.idFront ? watermarkPhoto(state.images.idFront, text) : null,
      idBack: state.images.idBack ? watermarkPhoto(state.images.idBack, text) : null,
    });
  }
  return { signature: state.images.signature, ...watermarked.get(text) };
}

async function addFiles(files) {
  const errors = $('#file-errors');
  errors.textContent = '';
  let added = 0;
  for (const file of files) {
    if (!/\.docx$/i.test(file.name)) {
      errors.append(el('p', { text: `${file.name}：不是 .docx 檔，已略過` }));
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sig = `${file.name}|${file.size}|${hashBytes(bytes)}`;
      if (state.forms.some((f) => f.sig === sig)) {
        errors.append(el('p', { text: `${file.name}：已經在清單裡了` }));
        continue;
      }
      const { data, warnings } = parseForm(readDocxParagraphs(bytes));
      state.forms.push({ id: nextId++, sig, fileName: file.name, data, warnings, mailOverride: null });
      added++;
    } catch (err) {
      console.error(err);
      errors.append(el('p', { text: `${file.name}：${err.message}` }));
    }
  }
  if (added) {
    state.forms.sort((a, b) => sortKey(a.data) - sortKey(b.data) || a.fileName.localeCompare(b.fileName));
    invalidateResult();
    renderForms();
    toast(`已加入 ${added} 份`);
  }
}

function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 7) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function clearForms() {
  state.forms = [];
  delete $('#pdf-name').dataset.touched;
  invalidateResult();
  renderForms();
}

function updateDefaultName() {
  const input = $('#pdf-name');
  if (input.dataset.touched) return;
  const first = state.forms[0]?.data;
  if (!first) return;
  const ym = yearMonth(first);
  input.value = [ym, '勞務報酬單', first.name].filter(Boolean).join('_');
}

function formSummary(form) {
  const d = resolvedData(form);
  const m = parseInt(d.period.fm, 10);
  const day = parseInt(d.period.fd, 10);
  const net = parseAmount(d.net);
  return { m, day, net, work: d.work || '（沒有讀到工作內容）' };
}

function renderForms() {
  updateDefaultName();
  const list = $('#forms');
  list.textContent = '';
  for (const form of state.forms) list.append(formCard(form));
  const n = state.forms.length;
  $('#list-head').hidden = n === 0;
  $('#make-box').hidden = n === 0;
  $('#count').textContent = String(n);
  const sum = state.forms.reduce((a, f) => a + (parseAmount(f.data.net) ?? 0), 0);
  $('#total').textContent = n ? `支領淨額合計 NT$ ${formatAmount(sum)}` : '';
  $('#make-pdf').textContent = n ? `產生 PDF（${n} 頁）` : '產生 PDF';
}

function formCard(form) {
  const s = formSummary(form);
  const warnList = el('ul', { class: 'fc-warn' }, form.warnings.map((w) => el('li', { text: w })));
  const editBox = el('div', { class: 'fc-edit', hidden: true });
  const card = el('li', { class: 'form-card', 'data-id': form.id },
    el('div', { class: 'fc-main' },
      el('div', { class: 'fc-date', 'aria-hidden': 'true' },
        el('span', { class: 'm', text: Number.isFinite(s.m) ? `${s.m}月` : '日期' }),
        el('span', { class: 'd', text: Number.isFinite(s.day) ? String(s.day) : '?' })),
      el('div', { class: 'fc-info' },
        el('p', { class: 'fc-work', text: s.work }),
        el('p', { class: 'fc-meta', text: `支領淨額 NT$ ${s.net === null ? '?' : formatAmount(s.net)}・${form.fileName}` }),
        form.warnings.length ? warnList : null)),
    el('div', { class: 'fc-actions' },
      el('button', { type: 'button', 'data-act': 'preview', text: '預覽', onclick: () => preview(form) }),
      el('button', {
        type: 'button', 'data-act': 'edit', text: '編輯', 'aria-expanded': 'false',
        onclick: (e) => {
          const open = editBox.hidden;
          if (open && !editBox.childElementCount) buildEditor(form, editBox, card);
          editBox.hidden = !open;
          e.currentTarget.setAttribute('aria-expanded', String(open));
          e.currentTarget.textContent = open ? '收合' : '編輯';
        },
      }),
      el('button', {
        type: 'button', 'data-act': 'remove', text: '移除',
        onclick: () => {
          state.forms = state.forms.filter((f) => f !== form);
          invalidateResult();
          renderForms();
        },
      })),
    editBox);
  return card;
}

const EDIT_GROUPS = [
  {
    title: '勞務內容',
    fields: [
      { label: '工作內容', path: 'work', type: 'textarea' },
      { label: '期間（民國）', row: [['自', 'period.fy', '年'], ['', 'period.fm', '月'], ['', 'period.fd', '日']] },
      { label: '', row: [['至', 'period.ty', '年'], ['', 'period.tm', '月'], ['', 'period.td', '日']] },
      { label: '項目', path: 'category' },
    ],
  },
  {
    title: '金額',
    fields: [
      { label: '支領金額', path: 'gross', numeric: true },
      { label: '代扣所得稅率 %', path: 'taxRate', numeric: true },
      { label: '代扣所得稅', path: 'tax', numeric: true },
      { label: '二代健保補充保費', path: 'nhi', numeric: true },
      { label: '支領淨額', path: 'net', numeric: true, capital: true },
    ],
  },
  {
    title: '日期',
    fields: [
      { label: '填表日期（民國）', row: [['', 'fillDate.y', '年'], ['', 'fillDate.m', '月'], ['', 'fillDate.d', '日']] },
      { label: '簽章日期', path: 'signDate' },
    ],
  },
  {
    title: '領款人',
    fields: [
      { label: '姓名', path: 'name' },
      { label: '身分證字號', path: 'idNo' },
      { label: '聯絡電話', path: 'phone' },
      { label: '戶籍地址', path: 'regAddress' },
      { label: '通訊地址（只改這一份）', mail: true },
    ],
  },
];

function buildEditor(form, box, card) {
  const changed = () => {
    invalidateResult();
    const s = formSummary(form);
    $('.fc-work', card).textContent = s.work;
    $('.fc-meta', card).textContent = `支領淨額 NT$ ${s.net === null ? '?' : formatAmount(s.net)}・${form.fileName}`;
    $('.fc-date .m', card).textContent = Number.isFinite(s.m) ? `${s.m}月` : '日期';
    $('.fc-date .d', card).textContent = Number.isFinite(s.day) ? String(s.day) : '?';
    const sum = state.forms.reduce((a, f) => a + (parseAmount(f.data.net) ?? 0), 0);
    $('#total').textContent = `支領淨額合計 NT$ ${formatAmount(sum)}`;
  };
  const capitalText = () => form.data.capital.map((c, i) => c + CAPITAL_UNITS[i]).join('');
  const capEl = el('p', { class: 'capital' });
  const refreshCap = () => (capEl.textContent = `國字大寫：${capitalText()}`);

  for (const g of EDIT_GROUPS) {
    const fs = el('fieldset', {}, el('legend', { text: g.title }));
    for (const f of g.fields) {
      if (f.row) {
        fs.append(el('div', { class: 'field' },
          f.label ? el('span', { text: f.label }) : null,
          el('div', { class: 'field-row' }, f.row.map(([pre, path, post]) => [
            pre ? el('em', { text: pre }) : null,
            el('input', {
              value: getPath(form.data, path) ?? '', inputmode: 'numeric', 'aria-label': `${f.label}${pre}${post}`,
              oninput: (e) => { setPath(form.data, path, e.target.value.trim()); changed(); },
            }),
            el('em', { text: post }),
          ]))));
        continue;
      }
      if (f.mail) {
        fs.append(el('label', { class: 'field' }, el('span', { text: f.label }),
          el('input', {
            value: form.mailOverride ?? '',
            placeholder: state.settings.address || '（請到「我的資料」設定通訊地址）',
            oninput: (e) => { form.mailOverride = e.target.value.trim() || null; changed(); },
          })));
        continue;
      }
      const input = el(f.type === 'textarea' ? 'textarea' : 'input', {
        rows: f.type === 'textarea' ? 2 : undefined,
        inputmode: f.numeric ? 'decimal' : undefined,
        oninput: (e) => {
          setPath(form.data, f.path, e.target.value.trim());
          if (f.capital) {
            const digits = toCapitalDigits(parseAmount(e.target.value));
            if (digits) form.data.capital = digits;
            refreshCap();
          }
          changed();
        },
      });
      input.value = getPath(form.data, f.path) ?? '';
      fs.append(el('label', { class: 'field' }, el('span', { text: f.label }), input));
      if (f.capital) {
        refreshCap();
        fs.append(capEl);
      }
    }
    box.append(fs);
  }
}

// ───────────────────────── 預覽與產生 ─────────────────────────

async function preview(form) {
  await ensureFonts();
  const dlg = $('#dlg-preview');
  const { canvas } = renderToCanvas(resolvedData(form), formAssets(form), 2, { photos: true });
  const img = $('#preview-img');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(blob);
  img.src = url;
  img.dataset.url = url;
  $('#preview-title').textContent = `預覽：${form.fileName}`;
  dlg.showModal();
}

function invalidateResult() {
  state.result = null;
  $('#result').hidden = true;
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = null;
  }
}

function pdfFileName() {
  let name = $('#pdf-name').value.trim() || '勞務報酬單';
  name = name.replace(/[\\/:*?"<>|]+/g, '_');
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

async function makePdf() {
  if (!state.forms.length) return;
  const missing = missingSettings();
  if (missing.length && !confirm(`還沒設定：${missing.join('、')}。\n這些地方在 PDF 上會是空白，要繼續嗎？`)) return;

  const btn = $('#make-pdf');
  const progress = $('#progress');
  btn.disabled = true;
  progress.hidden = false;
  invalidateResult();
  try {
    progress.textContent = '準備字型…';
    await ensureFonts();
    const images = {};
    const photoKeys = new Map(); // 加好浮水印的照片 → PDF 裡的圖片名稱（同一張只存一次）
    const pages = [];
    const n = state.forms.length;
    for (let i = 0; i < n; i++) {
      progress.textContent = `正在產生第 ${i + 1} / ${n} 頁…`;
      await nextFrame();
      const assets = formAssets(state.forms[i]);
      const { canvas, ctx, photos } = renderToCanvas(resolvedData(state.forms[i]), assets, PX_PER_PT, { photos: false });
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const key = `page${i}`;
      images[key] = { kind: 'rgb', width: canvas.width, height: canvas.height, bytes: encodeRgb(rgba, canvas.width, canvas.height) };
      canvas.width = 0;
      canvas.height = 0;
      const layers = [{ image: key, x: 0, y: 0, w: PAGE.w, h: PAGE.h }];
      for (const p of photos) {
        const photo = p.key === 'front' ? assets.idFront : assets.idBack;
        if (!photoKeys.has(photo)) {
          const name = `photo${photoKeys.size}`;
          const blob = await canvasToBlob(photo, 'image/jpeg', 0.92);
          images[name] = { kind: 'jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) };
          photoKeys.set(photo, name);
        }
        layers.push({ image: photoKeys.get(photo), x: p.x, y: p.y, w: p.w, h: p.h });
      }
      pages.push(layers);
    }
    progress.textContent = '組合 PDF…';
    await nextFrame();
    const name = pdfFileName();
    const bytes = buildPdf({ pageWidth: PAGE.w, pageHeight: PAGE.h, title: name.replace(/\.pdf$/i, ''), images, pages });
    state.result = { blob: new Blob([bytes], { type: 'application/pdf' }), name };
    showResult();
  } catch (err) {
    console.error(err);
    toast(`產生失敗：${err.message}`, 5000);
  } finally {
    btn.disabled = false;
    progress.hidden = true;
  }
}

function showResult() {
  const { blob, name } = state.result;
  state.resultUrl = URL.createObjectURL(blob);
  const a = $('#download-pdf');
  a.href = state.resultUrl;
  a.download = name;
  $('#result-name').textContent = name;
  const mb = blob.size / 1024 / 1024;
  $('#result-info').textContent = `${state.forms.length} 頁・${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(blob.size / 1024)} KB`}`;
  const file = new File([blob], name, { type: 'application/pdf' });
  $('#share-pdf').hidden = !navigator.canShare?.({ files: [file] });
  $('#result').hidden = false;
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function sharePdf() {
  if (!state.result) return;
  const { blob, name } = state.result;
  const file = new File([blob], name, { type: 'application/pdf' });
  try {
    await navigator.share({ files: [file], title: name });
  } catch (err) {
    if (err.name !== 'AbortError') toast(`無法分享：${err.message}`);
  }
}

// ───────────────────────── 離線（Service Worker）─────────────────────────

async function setupOffline() {
  const badge = $('#offline');
  if (!('serviceWorker' in navigator)) {
    badge.textContent = '此瀏覽器不支援離線';
    return;
  }
  const hadController = !!navigator.serviceWorker.controller;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const showUpdate = (worker) => {
      $('#update').hidden = false;
      $('#update-btn').onclick = () => worker.postMessage('skipWaiting');
    };
    if (reg.waiting && hadController) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    await navigator.serviceWorker.ready;
    badge.textContent = '✓ 可離線使用';
    badge.classList.add('ok');
  } catch (err) {
    console.error(err);
    badge.textContent = '離線功能未啟用';
  }
}

// ───────────────────────── 啟動 ─────────────────────────

async function init() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
  setupDialog($('#dlg-preview'), true);

  $('#docx-input').addEventListener('change', async (e) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    await addFiles(files);
  });
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles([...(e.dataTransfer?.files ?? [])]);
  });

  $('#pdf-name').addEventListener('input', (e) => {
    e.target.dataset.touched = '1';
    invalidateResult();
  });
  $('#clear-forms').addEventListener('click', () => {
    if (confirm('清空目前的清單？（不會刪除「我的資料」）')) clearForms();
  });
  $('#make-pdf').addEventListener('click', makePdf);
  $('#share-pdf').addEventListener('click', sharePdf);

  await loadSettings();
  setupAddress();
  setupSignaturePad();
  setupSignatureImport();
  setupIdPhotos();
  setupWipe();
  refreshSetupState();
  renderForms();
  if (missingSettings().length === 4) showTab('me');
  setupOffline();
}

init();
