import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDocxParagraphs, extractParagraphs } from '../js/docx.js';
import { parseForm, sortKey, yearMonth, DEFAULT_NOTES } from '../js/parse.js';
import { buildDocx, documentXml, FAKE } from './fixtures.mjs';

test('讀出公司報酬單的所有欄位', () => {
  const { data, warnings } = parseForm(readDocxParagraphs(buildDocx()));
  assert.deepEqual(warnings, []);
  assert.equal(data.company, FAKE.company);
  assert.deepEqual(data.kind, { salary: true, other: false });
  assert.deepEqual(data.fillDate, { y: '115', m: '09', d: '30' });
  assert.equal(data.nationality, 'local');
  assert.equal(data.name, FAKE.name);
  assert.equal(data.idNo, FAKE.idNo);
  assert.equal(data.phone, FAKE.phone);
  assert.equal(data.residentNo, '');
  assert.equal(data.regAddress, FAKE.regAddress);
  assert.equal(data.mailAddress, '');
  assert.equal(data.work, FAKE.work);
  assert.deepEqual(data.period, { fy: '115', fm: '9', fd: FAKE.day, ty: '115', tm: '9', td: FAKE.day });
  assert.equal(data.category, '導覽薪資');
  assert.equal(data.gross, FAKE.gross);
  assert.equal(data.taxRate, '10');
  assert.equal(data.tax, '0');
  assert.equal(data.nhiRate, '2.11');
  assert.equal(data.nhi, '0');
  assert.equal(data.net, FAKE.net);
  assert.deepEqual(data.pay, { cash: false, cheque: false, transfer: true });
  assert.deepEqual(data.capital, FAKE.capital);
  assert.equal(data.signDate, FAKE.signDate);
  assert.equal(data.notes[1], '本國籍應扣繳稅額<20,000者,不預先扣繳');
  assert.equal(data.notes[3], '  機會中獎獎金(91) : 10% (起扣點20,001)', '保留縮排');
});

test('外國籍勾選', () => {
  const { data } = parseForm(readDocxParagraphs(buildDocx(FAKE, { foreign: true })));
  assert.equal(data.nationality, 'foreign183');
});

test('大寫金額和淨額不一致時提醒', () => {
  const { warnings } = parseForm(readDocxParagraphs(buildDocx({ ...FAKE, net: '3,900' })));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /不一致/);
});

test('讀不到的欄位會列出來，大寫金額改用淨額計算', () => {
  const { data, warnings } = parseForm(['勞務報酬單', '支領淨額：新台幣 1,234 元']);
  assert.match(warnings[0], /公司名稱.*姓名.*工作內容.*期間.*簽章日期/);
  assert.deepEqual(data.capital, ['零', '零', '壹', '貳', '參', '肆']);
  assert.deepEqual(data.notes, DEFAULT_NOTES);
});

test('段落解析：表格、tab、實體字元、相容區塊', () => {
  const paras = extractParagraphs(documentXml());
  assert.ok(paras.includes('勞務報酬單'));
  assert.ok(!paras.some((p) => p.includes('不應出現')), 'mc:Fallback 要略過');
  assert.ok(!paras.some((p) => p.startsWith('\t')), '段落的 tab 定位點不是文字');
  assert.ok(paras.some((p) => p.includes('\t 領款人')), 'run 裡的 <w:tab/> 要變成 tab');
});

test('排序與檔名年月', () => {
  const { data } = parseForm(readDocxParagraphs(buildDocx()));
  assert.equal(sortKey(data), 20260905);
  assert.equal(yearMonth(data), '202609');
  const noPeriod = { ...data, period: { fy: '', fm: '', fd: '' } };
  assert.equal(sortKey(noPeriod), 20260905, '期間讀不到時用工作內容的日期');
});

test('不是 docx 的檔案會給清楚的錯誤', () => {
  assert.throws(() => readDocxParagraphs(new Uint8Array([1, 2, 3, 4])), /不是 \.docx/);
});
