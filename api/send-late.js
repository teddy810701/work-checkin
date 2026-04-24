export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const {
      store = "",
      message = "",
      dateKey = "",
      empId = "",
      name = "",
      scheduleStartTime = "",
      actualTime = "",
      lateMinutes = 0,
    } = req.body || {};

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    const xluoGroupId = process.env.LINE_GROUP_ID_XILUO;
    const dounanGroupId = process.env.LINE_GROUP_ID_DOUNAN;
    const defaultGroupId = process.env.LINE_GROUP_ID;

    const groupId = store.includes("斗南")
      ? dounanGroupId || defaultGroupId
      : store.includes("西螺")
      ? xluoGroupId || defaultGroupId
      : defaultGroupId;

    if (!token) {
      return res.status(500).json({ success: false, error: "缺少 LINE_CHANNEL_ACCESS_TOKEN" });
    }

    if (!groupId) {
      return res.status(500).json({ success: false, error: "缺少 LINE 群組 ID" });
    }

    const text =
      message ||
      [
        "⚠️ 遲到通知",
        `${store}｜${name}`,
        `日期：${dateKey}`,
        `工號：${empId}`,
        `應上班：${scheduleStartTime}`,
        `實際打卡：${actualTime}`,
        `遲到：${lateMinutes} 分鐘`,
      ].join("\n");

    const lineResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text }],
      }),
    });

    const resultText = await lineResponse.text();

    if (!lineResponse.ok) {
      return res.status(lineResponse.status).json({
        success: false,
        error: "LINE 發送失敗",
        detail: resultText,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
