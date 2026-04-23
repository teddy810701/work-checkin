export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const token = process.env.LINE_TOKEN;
    const groupId = process.env.STAFF_GROUP_ID;

    if (!token) {
      return res.status(500).json({ success: false, error: "缺少 LINE_TOKEN" });
    }

    if (!groupId) {
      return res.status(500).json({ success: false, error: "缺少 STAFF_GROUP_ID" });
    }

    const { dateKey, schedule = [] } = req.body || {};

    const title = dateKey ? `📢 ${dateKey} 班表通知` : "📢 今日班表通知";

    let text = `${title}\n`;

    if (!Array.isArray(schedule) || schedule.length === 0) {
      text += "今日未安排上班人員";
    } else {
      text += schedule
        .map((item) => {
          const name = item?.name || "未命名員工";
          const time = item?.startTime || "未設定時間";
          const store = item?.store ? `（${item.store}）` : "";
          return `• ${name}${store} ${time}`;
        })
        .join("\n");
    }

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

    const raw = await lineResponse.text();

    if (!lineResponse.ok) {
      return res.status(lineResponse.status).json({
        success: false,
        error: raw || "LINE API 發送失敗",
      });
    }

    return res.status(200).json({ success: true, text });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "伺服器錯誤",
    });
  }
}
