# 企業資訊安全教育訓練系統 (ISMS Education System)

此專案是一個基於 Google Apps Script (GAS) 開發的輕量化教育訓練平台，旨在提供企業內部的資訊安全宣導、影片觀看與課後測驗。

## 專案概述

*   **目的**：確保員工完成必要的資安教育訓練，並紀錄其學習進度與測驗成績。
*   **架構**：
    *   **前端 (Frontend)**：單頁應用程式 (SPA)，使用 Tailwind CSS 進行排版，並整合 YouTube API 進行影片播放控制。
    *   **後端 (Backend)**：Google Apps Script，負責提供網頁進入點與處理資料存取（Google Sheets）。

## 目錄結構

*   `code.js`：根目錄的 GAS 後端；處理 `doGet`、資料存取與寄信工作流程。
*   `index.html`：根目錄的小寫主頁 HTML；包含影片與測驗介面。
*   `mention.html`：根目錄的催辦、報表與教育訓練匯入 HTML。
*   `env.js`：環境設定，包含 `ENV.MASTER_SHEET_ID`。
*   `appsscript.json`：GAS manifest 與 OAuth 範圍。
*   `example/`：參考與舊版材料，不是部署目標。

## 核心功能說明

### 1. 影片觀看控制 (防呆與防弊)
*   **禁止快轉**：系統每秒檢查觀看進度，若偵測到跳轉超過 3 秒，會強制暫停並跳回原處。
*   **閒置偵測**：每 5 分鐘彈出視窗確認使用者是否在座位上，逾時未確認將自動暫停。
*   **焦點監控**：當使用者切換分頁或縮小瀏覽器時，影片會自動暫停，確保學習品質。
*   **進度保存**：使用 `localStorage` 紀錄觀看時間，即使重新整理頁面也能接續觀看。

### 2. 課後測驗與紀錄
*   **自動評分**：前端即時計算測驗分數，達到及格門檻（預設 80 分）才算通過。
*   **資料同步**：透過 `google.script.run` 調用後端函數，將「姓名、員工編號、觀看影片、測驗分數、結果」寫入 Google 試算表。

## 部署說明

此專案設計為部署於 **Google Apps Script**：

請以根目錄的部署檔案為準；`example/` 僅供參考，不是部署目標。

1. 建立或開啟綁定 Google 試算表的 Apps Script 專案。
2. 將根目錄的 `code.js`、`env.js` 與 `appsscript.json` 同步至 Apps Script 專案；`appsscript.json` 的 OAuth 範圍必須一併保留。
3. 將根目錄的小寫的 `index.html` 與 `mention.html` 同步為 Apps Script 的 HTML 檔案。`doGet()` 會載入小寫的 `index`，因此不得改成 `Index.html`。
4. 在 `env.js` 設定 `ENV.MASTER_SHEET_ID`，使其指向可連線的 Google 試算表；該試算表必須包含 `人員主檔`，且 A 欄為 Email、B 欄為顯示名稱。
5. 點擊「部署」>「新部署」，選擇「網頁應用程式」，設定執行身分與存取權限，並完成要求的 OAuth 授權。

### 教育訓練匯入信件設定

教育訓練匯入功能會從 Drive 的 XLSX 範本建立單一附件，並以一封信寄給固定收件人。部署管理員應依序完成下列設定：

1. 將 `importtemplate_v20251226 (1).xlsx` 上傳到 Google Drive；請保持為 XLSX，**不需要轉換成 Google Sheet**。
2. 複製該 Drive 檔案 ID，於 Apps Script「專案設定」>「指令碼屬性」設定 `TRAINING_IMPORT_TEMPLATE_FILE_ID`。
3. 在同一處設定 `TRAINING_IMPORT_RECIPIENT_EMAIL` 為固定收件者的 Email。
4. 確認固定收件者 Email 與部署操作者 Email 都在 `人員主檔` 的 A:B 欄有對應中文姓名（A 欄 Email、B 欄姓名）。
5. 將範本檔案以 Viewer 權限分享給 Web App 的執行帳號。
6. 重新部署 Web App，並核准新增的唯讀 Drive 授權範圍。
7. 先執行一筆測試寄送，開啟產生的 `importtemplate_vYYYYMMDD.xlsx`，再匯入目標系統，確認空白 `certNo` 也能被接受。

請勿將實際收件者 Email 或 Drive 檔案 ID 寫入原始碼或文件。

## 開發慣例

*   **前端**：偏好使用 CDN 引入函式庫（如 Tailwind, SweetAlert2），以減少部屬複雜度。
*   **繁體中文**：所有介面與註解皆使用繁體中文（zh-TW）。
