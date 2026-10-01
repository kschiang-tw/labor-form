// 金額與國字大寫

export const CAPITAL_DIGITS = '零壹貳參肆伍陸柒捌玖';
// 報酬單上大寫欄位的單位：拾(萬) 萬 仟 佰 拾 元
export const CAPITAL_UNITS = ['拾', '萬', '仟', '佰', '拾', '元整。'];

const DIGIT_VALUE = new Map([
  ...[...CAPITAL_DIGITS].map((c, i) => [c, i]),
  ...[...'〇一二三四五六七八九'].map((c, i) => [c, i]),
  ['叁', 3], ['參', 3], ['兩', 2], ['两', 2], ['貮', 2], ['O', 0], ['○', 0],
  ...[...'0123456789'].map((c, i) => [c, i]),
]);

/** '3,500' → 3500；無法解析時回傳 null */
export function parseAmount(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/[,，\s]/g, '');
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/** 3500 → '3,500' */
export function formatAmount(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('en-US');
}

/** 3500 → ['零','零','參','伍','零','零']（六個位數：拾萬到元） */
export function toCapitalDigits(n) {
  if (n === null || !Number.isFinite(n) || n < 0 || n > 999999) return null;
  return [...String(Math.floor(n)).padStart(6, '0')].map((c) => CAPITAL_DIGITS[+c]);
}

/** ['零','零','參','伍','零','零'] → 3500 */
export function capitalDigitsToNumber(digits) {
  if (!Array.isArray(digits) || digits.length !== 6) return null;
  let n = 0;
  for (const c of digits) {
    const v = DIGIT_VALUE.get(c);
    if (v === undefined) return null;
    n = n * 10 + v;
  }
  return n;
}
