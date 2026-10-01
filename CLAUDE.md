# labor-form — Claude 工作規則

## 每次修改後的固定流程

1. 用 `./bump.sh patch|minor|major` 更新版號（規則如下；會同時改 `js/version.js` 和 `sw.js`）
2. 更新 `CHANGELOG.md`，在最上方加入新版本的條目
3. `npm test` 和 `npm run e2e` 都要通過
4. `git add` 所有修改的檔案（包含 `js/version.js`、`sw.js` 和 `CHANGELOG.md`）
5. `git commit` + `git push` 到 `main`（GitHub Pages 從 `main` 部署：https://kschiang-tw.github.io/labor-form/）

**不論是新功能、bug fix、還是小調整，都要執行這個流程。**

## 版號規則（語意化版本）

格式：`主版本.次版本.修訂號`（例如 `2.1.0`）

| 情況 | 改哪一碼 | 範例 |
|------|----------|------|
| 修小 bug、微調樣式 | 修訂號 +1 | 2.1.0 → 2.1.1 |
| 修較多內容、中型功能調整 | 次版本 +1，修訂號歸零 | 2.1.0 → 2.2.0 |
| 新增全新功能 | 主版本 +1，其餘歸零 | 2.1.0 → 3.0.0 |

## 個資（最重要）

- 報酬單內含姓名、身分證字號、地址、簽名、身分證影本，**絕對不能上傳到網路上**。
- 不能把真實的 Word 檔、PDF、身分證或簽名照片、姓名、身分證字號、地址 commit 進 repo；測試一律用假資料（`tests/fixtures.mjs`）。
- 不能加入任何對外連線（CDN、字型服務、分析工具…）；`index.html` 的 CSP 是 `connect-src 'none'`，所有檔案都放在 repo 裡。

## 技術筆記

- 純靜態網頁、沒有建置步驟；Service Worker 採快取優先，所以每次改 app 檔案都要換版號。
- 新增 app 檔案時要加進 `sw.js` 的 `ASSETS`（`npm test` 會檢查）。
- 專案結構見 `README.md` 的「開發者說明」。
