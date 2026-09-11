# 企業資訊安全教育訓練系統 (ISMS Education System)

此專案是一個基於 Google Apps Script (GAS) 開發的輕量化教育訓練平台，旨在提供企業內部的資訊安全宣導、影片觀看與課後測驗。

## 專案概述

*   **目的**：確保員工完成必要的資安教育訓練，並紀錄其學習進度與測驗成績。
*   **架構**：
    *   **前端 (Frontend)**：單頁應用程式 (SPA)，使用 Tailwind CSS 進行排版，並整合 YouTube API 進行影片播放控制。
    *   **後端 (Backend)**：Google Apps Script，負責提供網頁進入點與處理資料存取（Google Sheets）。

## 目錄結構

*   `example/`：專案核心程式碼目錄。
    *   `index.html`：前端使用者介面。包含登錄、影片播放邏輯（防快轉、閒置偵測）與測驗介面。
    *   `code.js`：GAS 後端程式碼。處理 `doGet` 請求以及將測驗結果寫入試算表。
    *   `test.md`：資安測驗題庫參考文件。包含資安政策、密碼管理、個資法、社交工程及 AI 趨勢等主題。

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

1.  建立一個新的 Google 試算表。
2.  點擊「擴充功能」 > 「Apps Script」。
3.  將 `example/code.js` 的內容貼入腳本編輯器中。
4.  在腳本編輯器中新增一個名為 `Index.html` 的檔案，並將 `example/index.html` 的內容貼入。
5.  在 `code.js` 中視需要修改 `SpreadsheetApp.getActiveSpreadsheet()` 的邏輯。
6.  點擊「部署」 > 「新部署」，選擇「網頁應用程式」，並設定存取權限。

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
