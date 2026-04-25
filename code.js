/**
 * ==========================================
 * 後端邏輯：Google Apps Script (Code.gs)
 * ==========================================
 */

// 1. 發佈為 Web App 時的進入點
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('企業內部教育訓練系統') // 設定瀏覽器標籤標題
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

// 3. 根據 Email 從人員主檔查姓名
function getUserNameByEmail(email) {
  try {
    // 檢查是否有設定 ENV.MASTER_SHEET_ID
    if (typeof ENV === 'undefined' || !ENV.MASTER_SHEET_ID || ENV.MASTER_SHEET_ID.includes('請在此填入')) {
      return '未設定主檔ID';
    }
    
    // 開啟外部的主檔試算表
    const masterSS = SpreadsheetApp.openById(ENV.MASTER_SHEET_ID);
    const masterSheet = masterSS.getSheetByName('人員主檔');
    
    if (!masterSheet) {
      return '找不到人員主檔';
    }
    
    // 取得所有資料 (二維陣列)
    const data = masterSheet.getDataRange().getValues();
    
    // 假設第一列為標題，從第二列 (index 1) 開始搜尋
    // A 欄為信箱 (index 0)，B 欄為姓名 (index 1)
    for (let i = 1; i < data.length; i++) { 
      if (data[i][0] === email) {
        return data[i][1]; // 回傳姓名
      }
    }
    return '查無此人';
  } catch (e) {
    console.error("讀取人員主檔失敗:", e);
    return '讀取失敗';
  }
}

// 4. 接收前端資料並寫入 Google Sheets
function submitTrainingResult(data) {
  try {
    // 取得目前綁定此腳本的試算表
    const ss = SpreadsheetApp.getActiveSpreadsheet(); 
    const sheetName = '訓練紀錄';
    let sheet = ss.getSheetByName(sheetName);
    
    // 如果工作表不存在，則建立一個並加上六個標題列
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果']);
      sheet.getRange("A1:F1").setFontWeight("bold").setBackground("#f8fafc");
    }
    
    // 準備寫入的資料
    const timestamp = new Date();
    const resultStatus = data.isPassed ? '通過' : '未通過';
    const email = data.userName; // 前端的 userName 目前是用來裝載信箱的
    const name = getUserNameByEmail(email); // 透過查表函數去「人員主檔」獲取真正的姓名
    
    // 寫入到對應的欄位
    sheet.appendRow([
      timestamp,       // A: 時間戳記
      name,            // B: 姓名
      email,           // C: 使用者信箱
      data.videoTitle, // D: 課程名稱
      data.score,      // E: 測驗分數
      resultStatus     // F: 測驗結果
    ]);
    
    return { success: true, message: "紀錄已成功儲存！" };
  } catch (error) {
    console.error("寫入試算表失敗: ", error);
    return { success: false, message: "系統發生錯誤，無法儲存紀錄。" };
  }
}