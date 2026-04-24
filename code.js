/**
 * ==========================================
 * 後端邏輯：Google Apps Script (Code.gs)
 * ==========================================
 */

// 1. 發佈為 Web App 時的進入點
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('臺灣人體生物資料庫內部資訊安全暨個資保護教育訓練') // 設定瀏覽器標籤標題
      .addMetaTag('viewport', 'width=device-width, initial-scale=1') // 確保手機端顯示正常
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 2. 獲取當前登入使用者的 Email (供前端顯示)
function getCurrentUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

// 3. 接收前端資料並寫入 Google Sheets
function submitTrainingResult(data) {
  try {
    // 取得目前綁定此腳本的試算表 (請確認腳本是建立在試算表上的，或使用 openById)
    const ss = SpreadsheetApp.getActiveSpreadsheet(); 
    const sheetName = '訓練紀錄';
    let sheet = ss.getSheetByName(sheetName);
    
    // 如果工作表不存在，則建立一個並加上標題列
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(['時間戳記', '使用者帳號 (Email)', '觀看影片', '測驗分數', '測驗結果']);
      sheet.getRange("A1:E1").setFontWeight("bold").setBackground("#f8fafc");
    }
    
    // 寫入資料
    const timestamp = new Date();
    const resultStatus = data.isPassed ? '通過' : '未通過';
    
    sheet.appendRow([
      timestamp, 
      data.userName, // 前端傳來的 Email
      data.videoTitle, 
      data.score, 
      resultStatus
    ]);
    
    return { success: true, message: "紀錄已成功儲存！" };
  } catch (error) {
    console.error("寫入試算表失敗: ", error);
    return { success: false, message: "系統發生錯誤，無法儲存紀錄。" };
  }
}