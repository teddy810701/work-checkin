// api/auto-check-late.js
// 已停用後端自動遲到推播，避免與前端檢查重複發送 LINE。
// 目前遲到通知由 src/App.js 的 runClientLateCheck 統一處理：
// 1. 超過 10 分鐘才通知
// 2. line_status/attendance_sent 會記錄同一天同一人已通知
// 3. 避免一天內重複發送

export default async function handler(req, res) {
  return res.status(200).json({
    success: true,
    disabled: true,
    message: "auto-check-late backend is disabled. Late notice is handled by frontend client check.",
  });
}
