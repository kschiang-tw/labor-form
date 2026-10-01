// 用假資料組出一份「長得像公司報酬單」的 docx，給測試用。
// 絕對不要把真實的報酬單、身分證或簽名放進 repo。
import { zipSync, strToU8 } from '../vendor/fflate.js';

export const FAKE = {
  company: '測試旅行社股份有限公司',
  name: '王小明',
  idNo: 'Z199999999',
  phone: '0900-000-000',
  regAddress: '999測試市測試區測試路1段2號3樓',
  work: '2026/9/5測試實業股份有限公司城市小旅行_大稻埕徒步導覽',
  day: '5',
  gross: '3,800',
  net: '3,800',
  capital: ['零', '零', '參', '捌', '零', '零'],
  signDate: '115/10/4',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text, rpr = '<w:rPr><w:b/></w:rPr>') => `<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const p = (...runs) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs.join('')}</w:p>`;
const cell = (...paras) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paras.join('') || '<w:p/>'}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;
const tbl = (...rows) => `<w:tbl><w:tblPr/>${rows.join('')}</w:tbl>`;

export function documentXml(f = FAKE, opts = {}) {
  const u = (s) => `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
  const body = [
    p(run('勞務報酬單')),
    p(run(f.company)),
    p(run('　　 Ｖ薪資  □其他　　　             填表日期:   '), run('115'), run('    年   '), run('09'), run('    月     '), run('30'), run('    日 單號：')),
    tbl(
      row(cell(p(run('領款人基本資料'))), cell(p(run(opts.foreign ? '□本國籍' : 'Ｖ本國籍'))), cell(p(run(`姓名：${f.name} `)))),
      row(cell(), cell(p(run(opts.foreign ? 'Ｖ外國籍' : '□外國籍')), p(run(' 在台滿183天'))), cell(p(run(`身分證字號：${f.idNo}         聯絡電話：${f.phone}`)), p(run('居留證/護照 NO.：')))),
      row(cell(), cell(), cell(p(run('戶籍地址:'), run(f.regAddress, '<w:rPr/>')))),
      row(cell(), cell(p(run('□外國籍')), p(run('　在台未滿183天'))), cell(p(run('通訊地址:　')))),
    ),
    tbl(
      row(cell(p(run('勞務內容'))), cell(p(run(`工作內容（下稱「本工作」）：${f.work}　`)))),
      row(cell(), cell(p(run('期間：自'), u('       115    　'), run('年'), u('　   9    　'), run('月'), u(`　 ${f.day}   　`), run('日至  '), u('       115  　'), run('年'), u('　  9 　'), run('月'), u(`　  ${f.day}   　`), run('日')))),
      row(cell(), cell(p(run('導覽薪資'), run(' ')))),
    ),
    tbl(
      row(
        cell(p(run('領款金額'))),
        cell(
          p(),
          p(run('支領金額：'), run('新台幣'), u(`       ${f.gross}       `), run('元')),
          p(run('代扣所得稅（'), u(' 10  '), run('%）：新台幣'), u('   0    '), run('元')),
          p(run('二代健保補充保費(2.11%)：新台幣'), u('   0   '), run('元 ')),
          p(run('支領淨額：新台幣'), u(`    ${f.net}     `), run('元')),
          p(run('付款方式：□現金  □支票  '), run(' Ｖ'), run('匯款')),
        ),
        cell(
          p(run('代扣所得稅:')),
          p(run('本國籍應扣繳稅額<20,000者,不預先扣繳')),
          p(run('・非固定薪資(50) : 5% (起扣點84,501)')),
          p(run('  '), run('機會中獎獎金(91) : 10% (起扣點20,001)')),
          p(run('代扣二代健保:')),
        ),
      ),
    ),
    p(run('茲收到 '), u(`${f.company} `), run('支付本人之報酬，共計 新台幣'),
      ...f.capital.flatMap((c, i) => [u(`  ${c}   `), run(['拾', '萬', '仟', '佰', '拾\u3000', '元整。'][i])])),
    p(run('本人保證提供之勞務服務並無違反法令或侵害他人權益，並同意 '), u(`${f.company} `), run('使用本工作之所有內容。 '),
      '<w:r><w:tab/></w:r>', run(' 領款人:　'),
      '<w:r><w:drawing><wp:inline><mc:AlternateContent><mc:Choice><w:txbxContent><w:p/></w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent><w:p><w:r><w:t>不應出現</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent></wp:inline></w:drawing></w:r>',
      run(`　（簽章）    日期：${f.signDate}　　　`)),
    p(run('　　　請附身分證影本（外籍人士請附居留證/護照影本）')),
    p(run('　　　身分證（居留證/護照）影本黏貼處　　經辦人：　')),
    tbl(row(cell(p(run('正面'))), cell(p(run('反面'))))),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body.join('')}<w:sectPr/></w:body></w:document>`;
}

export function buildDocx(f = FAKE, opts = {}) {
  const xml = documentXml(f, opts);
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(xml),
  });
}
