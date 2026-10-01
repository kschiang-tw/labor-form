// 從報酬單 docx 的段落文字中取出各欄位
import { parseAmount, formatAmount, toCapitalDigits, capitalDigitsToNumber } from './numerals.js';

export const DEFAULT_NOTES = [
  '代扣所得稅:',
  '本國籍應扣繳稅額<20,000者,不預先扣繳',
  '・非固定薪資(50) : 5% (起扣點84,501)',
  '・執行業務報酬(9A、9B)/ 租賃所得(51) /',
  '  機會中獎獎金(91) : 10% (起扣點20,001)',
  '代扣二代健保:',
  '・非固定薪資(50) : 2.11%  (起扣點24,000)',
  '・執行業務報酬(9A、9B) : 2.11%  (起扣點20,000)',
  '若有加入職業工會,請提供在保證明或繳費單，即可免扣。',
  '・租賃所得(51) :  2.11% (起扣點20,000)',
];

const CHECK_MARK = /[ＶVv✓✔☑☒■▣●◉✗✘Xx×]/;

export function emptyForm() {
  return {
    company: '',
    kind: { salary: true, other: false },
    fillDate: { y: '', m: '', d: '' },
    serialNo: '',
    nationality: 'local', // local | foreign183 | foreignUnder183 | ''
    name: '',
    idNo: '',
    phone: '',
    residentNo: '',
    regAddress: '',
    mailAddress: '',
    work: '',
    period: { fy: '', fm: '', fd: '', ty: '', tm: '', td: '' },
    category: '',
    gross: '',
    taxRate: '10',
    tax: '0',
    nhiRate: '2.11',
    nhi: '0',
    net: '',
    pay: { cash: false, cheque: false, transfer: true },
    notes: DEFAULT_NOTES.slice(),
    capital: ['零', '零', '零', '零', '零', '零'],
    signDate: '',
  };
}

function norm(s) {
  return s.replace(/[　\t \n]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** label 前面（略過空白）那個字是不是勾選記號 */
function markedBefore(text, label) {
  const i = text.indexOf(label);
  if (i < 0) return undefined;
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j >= 0 && CHECK_MARK.test(text[j]);
}

/**
 * @param {string[]} raw 段落文字
 * @returns {{ data: ReturnType<typeof emptyForm>, warnings: string[] }}
 */
export function parseForm(raw) {
  const P = raw.map(norm);
  const all = P.join('\n');
  const d = emptyForm();
  const warnings = [];
  const missing = [];

  const indexOf = (re, from = 0) => {
    for (let i = from; i < P.length; i++) if (re.test(P[i])) return i;
    return -1;
  };
  const match = (re) => {
    for (const p of P) {
      const m = re.exec(p);
      if (m) return m;
    }
    return null;
  };

  // 公司名稱：標題下方那行
  const fillIdx = indexOf(/填表日期/);
  const headEnd = fillIdx < 0 ? Math.min(P.length, 5) : fillIdx;
  let company = '';
  for (let i = 0; i < headEnd; i++) {
    if (/公司|社|會|院|所/.test(P[i]) && !/報酬單/.test(P[i])) {
      company = P[i];
      break;
    }
  }
  if (!company) company = match(/茲收到\s*(.+?)\s*支付本人/)?.[1] ?? '';
  if (company) d.company = company;

  // 薪資／其他、填表日期、單號
  if (fillIdx >= 0) {
    const line = P[fillIdx];
    const salary = markedBefore(line, '薪資');
    const other = markedBefore(line, '其他');
    if (salary !== undefined) d.kind.salary = salary;
    if (other !== undefined) d.kind.other = other;
    const fd = /填表日期\s*[:：]?\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/.exec(line);
    if (fd) d.fillDate = { y: fd[1], m: fd[2], d: fd[3] };
    d.serialNo = /單號\s*[:：]\s*(.*)$/.exec(line)?.[1]?.trim() ?? '';
  }

  // 國籍
  const local = /(\S)\s*本國籍/.exec(all);
  const f183 = /(\S)\s*外國籍\s*在台滿/.exec(all);
  const fu183 = /(\S)\s*外國籍\s*在台未滿/.exec(all);
  if (local || f183 || fu183) {
    d.nationality = '';
    if (local && CHECK_MARK.test(local[1])) d.nationality = 'local';
    else if (f183 && CHECK_MARK.test(f183[1])) d.nationality = 'foreign183';
    else if (fu183 && CHECK_MARK.test(fu183[1])) d.nationality = 'foreignUnder183';
  }

  // 基本資料
  d.name = match(/姓\s*名\s*[:：]\s*(.*)$/)?.[1]?.trim() ?? '';
  d.idNo = match(/身分證字號\s*[:：]\s*([A-Za-z0-9]*)/)?.[1] ?? '';
  d.phone = match(/聯絡電話\s*[:：]\s*(.*)$/)?.[1]?.trim() ?? '';
  d.residentNo = match(/護照\s*NO\.?\s*[:：]\s*(.*)$/i)?.[1]?.trim() ?? '';
  d.regAddress = match(/戶籍地址\s*[:：]\s*(.*)$/)?.[1]?.trim() ?? '';
  d.mailAddress = match(/通訊地址\s*[:：]\s*(.*)$/)?.[1]?.trim() ?? '';

  // 勞務內容
  d.work = match(/工作內容(?:\s*[（(][^)）]*[)）])?\s*[:：]\s*(.*)$/)?.[1]?.trim() ?? '';
  const periodIdx = indexOf(/期間\s*[:：]/);
  const pm = periodIdx >= 0
    ? /自\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日\s*至\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/.exec(P[periodIdx])
    : null;
  if (pm) d.period = { fy: pm[1], fm: pm[2], fd: pm[3], ty: pm[4], tm: pm[5], td: pm[6] };
  if (periodIdx >= 0) {
    const end = indexOf(/領款金額|支領金額/, periodIdx + 1);
    d.category = P.slice(periodIdx + 1, end < 0 ? periodIdx + 2 : end).filter(Boolean).join(' ');
  }

  // 金額
  const gross = match(/支領金額\s*[:：]\s*新台幣\s*([\d,]+)\s*元/);
  if (gross) d.gross = gross[1];
  const tax = match(/代扣所得稅\s*[（(]\s*([\d.]+)\s*%\s*[)）]\s*[:：]\s*新台幣\s*([\d,]+)\s*元/);
  if (tax) {
    d.taxRate = tax[1];
    d.tax = tax[2];
  }
  const nhi = match(/二代健保補充保費\s*[（(]\s*([\d.]+)\s*%\s*[)）]\s*[:：]\s*新台幣\s*([\d,]+)\s*元/);
  if (nhi) {
    d.nhiRate = nhi[1];
    d.nhi = nhi[2];
  }
  const net = match(/支領淨額\s*[:：]\s*新台幣\s*([\d,]+)\s*元/);
  if (net) d.net = net[1];

  const payIdx = indexOf(/付款方式/);
  if (payIdx >= 0) {
    const line = P[payIdx];
    d.pay = {
      cash: !!markedBefore(line, '現金'),
      cheque: !!markedBefore(line, '支票'),
      transfer: !!markedBefore(line, '匯款'),
    };
  }

  // 右側代扣說明（保留公司原文；找不到就用預設內容）
  const receiptIdx = indexOf(/茲收到/);
  if (payIdx >= 0 && receiptIdx > payIdx) {
    const notes = raw
      .slice(payIdx + 1, receiptIdx)
      .map((s) => s.replace(/[\t\n]/g, ' ').replace(/\s+$/, ''))
      .filter((s) => s.trim());
    if (notes.length) d.notes = notes;
  }

  // 國字大寫
  const cap = /共計\s*新台幣\s*(\S)\s*拾\s*(\S)\s*萬\s*(\S)\s*仟\s*(\S)\s*佰\s*(\S)\s*拾\s*(\S)\s*元/.exec(all);
  const netNum = parseAmount(d.net);
  if (cap) {
    d.capital = cap.slice(1, 7);
    const capNum = capitalDigitsToNumber(d.capital);
    if (netNum !== null && capNum !== netNum) {
      warnings.push(`國字大寫金額（${capNum === null ? cap.slice(1, 7).join('') : formatAmount(capNum)}）和支領淨額（${d.net}）不一致，請確認`);
    }
  } else if (netNum !== null) {
    d.capital = toCapitalDigits(netNum) ?? d.capital;
  }

  // 簽章日期
  const signLine = P.find((p) => /簽章/.test(p)) ?? P.find((p) => /領款人/.test(p) && /日期/.test(p));
  d.signDate = signLine ? (/日期\s*[:：]\s*([\d/.\-年月日]+)/.exec(signLine)?.[1] ?? '') : '';

  if (!d.company) missing.push('公司名稱');
  if (!d.name) missing.push('姓名');
  if (!d.work) missing.push('工作內容');
  if (!pm) missing.push('期間');
  if (!d.net) missing.push('支領淨額');
  if (!d.signDate) missing.push('簽章日期');
  if (missing.length) warnings.unshift(`讀不到：${missing.join('、')}（可按「編輯」補上）`);

  return { data: d, warnings };
}

/** 排序用：期間起日（民國年轉西元），讀不到就用工作內容開頭的日期 */
export function sortKey(d) {
  const y = parseInt(d.period.fy, 10);
  const m = parseInt(d.period.fm, 10);
  const day = parseInt(d.period.fd, 10);
  if (y && m && day) return (y + 1911) * 10000 + m * 100 + day;
  const w = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(d.work);
  if (w) return +w[1] * 10000 + +w[2] * 100 + +w[3];
  return Number.MAX_SAFE_INTEGER;
}

/** 檔名用的年月，例如 '202608' */
export function yearMonth(d) {
  const y = parseInt(d.period.fy, 10);
  const m = parseInt(d.period.fm, 10);
  if (y && m) return `${y + 1911}${String(m).padStart(2, '0')}`;
  const w = /(\d{4})[/.-](\d{1,2})/.exec(d.work);
  if (w) return `${w[1]}${w[2].padStart(2, '0')}`;
  return '';
}
