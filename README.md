# 勞務報酬單

把公司每個月寄來的勞務報酬單 Word 檔（.docx），自動加上**通訊地址、電子簽名、身分證正反面影本**，合併成一份 PDF。

- 可以在 iPad、Android 手機和平板上「加入主畫面」，裝好後**完全離線**使用。
- 一個月有幾份都可以：一次選取全部 .docx，每份一頁，依日期排序後合併成一份 PDF。
- 排版照公司原本的表格重新繪製，產生前可以先預覽，有需要也可以修改每一份的內容。
- 身分證影本會自動加上浮水印「限〔公司名稱〕勞務報酬單使用」：小字斜向鋪滿整張，公司名稱取自 Word 檔。

## 個資保護

- **沒有伺服器。** Word 檔、地址、簽名、身分證照片都只在你的裝置上處理和儲存（存在瀏覽器的 IndexedDB），不會上傳到任何地方。
- **網頁本身禁止對外連線。** 頁面設定了安全政策（CSP：`connect-src 'none'`），程式就算想傳資料出去，瀏覽器也會擋下來。所有程式庫和字型都放在 app 裡，不連外部 CDN。
- **Word 檔不會被保存。** 只在產生 PDF 的當下讀取；關掉頁面就消失。
- **浮水印拿不掉。** 浮水印是直接畫進身分證照片裡，不是另外疊一層，所以沒辦法從 PDF 取出沒有浮水印的原圖。存在裝置上的原始照片則保持不變。
- **可以一鍵清除。** 「我的資料 → 清除這台裝置上的所有資料」。
- 這個 repo 只有程式碼。`.gitignore` 擋掉了所有 `.docx`、`.pdf` 和照片檔，測試用的報酬單是程式產生的假資料。

> 資料是「每台裝置各自一份」：iPad 和手機要各設定一次。

## 安裝（只要做一次）

### 1. 把 app 放上 GitHub Pages

GitHub 免費方案只有公開 repo 能用 Pages。公開的只有程式碼，你的個資永遠不會出現在這裡。

1. GitHub repo 頁面 → **Settings** → **General** → 最下面 **Danger Zone** → **Change visibility** → **Make public**。
2. **Settings** → **Pages** → **Build and deployment**：
   - Source 選 **Deploy from a branch**
   - Branch 選 **main**，資料夾選 **/ (root)**，按 **Save**
3. 等一兩分鐘，頁面上方會出現網址，也就是 `https://kschiang-tw.github.io/labor-form/`。

### 2. 裝到 iPad／手機

- **iPad／iPhone（Safari）：** 打開上面的網址 → 點「分享」按鈕 → **加入主畫面**。
- **Android（Chrome）：** 打開網址 → 右上角 ⋮ → **安裝應用程式**（或「加到主畫面」）。

第一次打開時要有網路。右上角出現 **「✓ 可離線使用」** 就代表整個 app 已經存在裝置上了，之後開飛航模式也能用。

> 請一定要用「加入主畫面」的方式開啟。只在 Safari 分頁裡用的話，Safari 可能會在一段時間沒開之後自動清掉網站資料（包括你存的簽名和身分證照片）。

### 3. 設定「我的資料」

打開 app → **我的資料**：

1. **通訊地址：** 輸入後自動儲存。
2. **簽名：** 二選一。
   - 「手寫簽名」：直接用手指或 Apple Pencil 簽（Apple Pencil 有筆壓粗細）。
   - 「匯入簽名圖片」：在白紙上簽名後拍照，拉動「去背」滑桿，讓背景消失、只留下筆跡。
3. **身分證正面、反面：** 選照片後拖曳四個角裁切，可以旋轉，也可以鎖定身分證比例。

## 每個月的用法

1. 把公司寄來的 .docx 存到「檔案」（iPad）或手機裡。
2. 打開 app → **產生 PDF** → **選擇這個月的 Word 檔**，可以一次選多個。
3. 檢查清單：每一份會顯示日期、工作內容和支領淨額。
   - 「預覽」可以看完成的樣子。
   - 「編輯」可以修改任何欄位。改了支領淨額，國字大寫會自動跟著改。
   - 讀不到的欄位會用黃色提示。
4. 按 **產生 PDF**，再按 **分享／儲存到「檔案」** 傳給公司，或存起來。

檔名預設是「年月_勞務報酬單_姓名.pdf」，例如 `202608_勞務報酬單_王小明.pdf`，產生前可以修改。

## 更新 app

有新版本時，畫面下方會出現「有新版本」，按 **更新** 就好。你存的資料不會受影響。

---

## 開發者說明

純靜態網頁，沒有建置步驟；GitHub Pages 直接提供 repo 根目錄的檔案。

| 檔案 | 用途 |
| --- | --- |
| `js/docx.js` | 解壓 .docx，依序取出段落文字 |
| `js/parse.js` | 從段落文字取出各欄位（姓名、期間、金額、國字大寫…） |
| `js/render.js` | 在 canvas 上重繪報酬單（座標量自公司原檔輸出的 PDF） |
| `js/pdf.js` | 極簡 PDF 產生器：頁面用無損壓縮，身分證照片用 JPEG 原檔、整份只存一次 |
| `js/signature.js`、`js/cropper.js` | 手寫簽名板、照片裁切 |
| `js/store.js` | IndexedDB 存取 |
| `sw.js` | 離線快取（Service Worker） |

```bash
npm install          # 只需要 playwright（測試用）
npm test             # 單元測試（Node）
npm run e2e          # 用 Chromium 跑完整流程（全部假資料）
npm run serve        # 本機預覽 http://localhost:8080
```

在自己電腦上用真的檔案測試，輸出會放在 `tests/output/`，這個資料夾不會進版控：

```bash
E2E_DOCX=a.docx,b.docx E2E_SIGNATURE=sign.png E2E_ID_FRONT=front.jpg E2E_ID_BACK=back.jpg npm run e2e
```

**修改任何 app 檔案後，請把 `sw.js` 裡的 `VERSION` 改掉**，已安裝的裝置才會收到更新；`index.html` 頁尾顯示的版本號也要改成一樣（`npm test` 會檢查兩邊一致）。新增檔案時也要加進 `ASSETS` 清單（`npm test` 會檢查）。

### 授權

- 字型：[Noto Sans TC](https://github.com/notofonts/noto-cjk)，SIL Open Font License 1.1（`fonts/OFL.txt`）。原檔用的是微軟正黑體；依實測筆畫濃度，粗體改用最接近的 Noto Sans TC Medium。
- 解壓縮：[fflate](https://github.com/101arrowz/fflate)，MIT（`vendor/fflate.LICENSE.txt`）。
