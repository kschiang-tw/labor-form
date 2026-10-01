// 讀取 .docx：在裝置上解壓縮，依文件順序取出每個段落的純文字。
// 不依賴 DOMParser，所以同一份程式也能在 Node 測試裡跑。
import { unzipSync, strFromU8 } from '../vendor/fflate.js';

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

// Word 用 Wingdings 符號 (<w:sym>) 畫勾選框時的對照
const SYM_CHECKED = new Set(['F0FE', 'F0FC', 'F078', 'F0FB', 'F052', 'F053', 'F0FD']);
const SYM_UNCHECKED = new Set(['F0A8', 'F06F', 'F0A1', 'F071', 'F070', 'F0A3']);

function symChar(hex) {
  if (!hex) return '';
  const h = hex.toUpperCase();
  if (SYM_CHECKED.has(h)) return 'Ｖ';
  if (SYM_UNCHECKED.has(h)) return '□';
  return '';
}

/**
 * 從 word/document.xml 取出段落文字（含表格儲存格與文字方塊內的段落）。
 * @param {string} xml
 * @returns {string[]}
 */
export function extractParagraphs(xml) {
  const out = [];
  const stack = [];
  let inText = false;
  let inRun = 0;
  let skip = 0;
  const re = /<(\/?)([A-Za-z][\w.-]*(?::[\w.-]+)?)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) {
      if (inText && !skip && stack.length) stack[stack.length - 1].push(decodeEntities(m[5]));
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2];
    const attrs = m[3];
    const selfClose = m[4] === '/';
    // 相容性區塊會把同一個文字方塊存兩份，只讀 mc:Choice 那份
    if (name === 'mc:Fallback') {
      if (!selfClose) skip += closing ? -1 : 1;
      continue;
    }
    if (skip) continue;
    const cur = stack[stack.length - 1];
    switch (name) {
      case 'w:p':
        if (selfClose) out.push('');
        else if (!closing) stack.push([]);
        else if (stack.length) out.push(stack.pop().join(''));
        break;
      case 'w:r':
        if (!selfClose) inRun += closing ? -1 : 1;
        break;
      case 'w:t':
        if (!selfClose) inText = !closing;
        break;
      case 'w:tab':
        if (!closing && inRun > 0 && cur) cur.push('\t');
        break;
      case 'w:br':
      case 'w:cr':
        if (!closing && inRun > 0 && cur) cur.push('\n');
        break;
      case 'w:noBreakHyphen':
        if (!closing && inRun > 0 && cur) cur.push('-');
        break;
      case 'w:sym':
        if (!closing && inRun > 0 && cur) cur.push(symChar(/w:char="([0-9A-Fa-f]+)"/.exec(attrs)?.[1]));
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * @param {Uint8Array} bytes .docx 檔案內容
 * @returns {string[]} 段落文字
 */
export function readDocxParagraphs(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new Error('無法開啟：這不是 .docx 格式的 Word 檔（舊版 .doc 請先另存成 .docx）');
  }
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('無法開啟：檔案裡找不到 Word 文件內容');
  return extractParagraphs(strFromU8(xml));
}
