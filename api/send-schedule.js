export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const token = process.env.LINE_TOKEN || process.env.LINE_CHANNEL_TOKEN;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const rawStore = String(body.store || "").trim();
    const message = String(body.message || "").trim();

    if (!token) {
      return res.status(500).json({
        success: false,
        error: "缺少 LINE token",
        detail: "請在 Vercel Environment Variables 設定 LINE_TOKEN 或 LINE_CHANNEL_TOKEN",
      });
    }

    if (!rawStore) {
      return res.status(400).json({ success: false, error: "缺少 store" });
    }

    if (!message) {
      return res.status(400).json({ success: false, error: "缺少 message" });
    }

    const storeMap = {
      "斗南站前店": process.env.LINE_GROUP_ID_DOUNAN,
      "斗南": process.env.LINE_GROUP_ID_DOUNAN,
      "西螺文昌店": process.env.LINE_GROUP_ID_XILUO,
      "西螺": process.env.LINE_GROUP_ID_XILUO,
    };

    const groupId = storeMap[rawStore];

    if (!groupId) {
      return res.status(400).json({
        success: false,
        error: `找不到店別對應群組：${rawStore}`,
        detail: "可用店別：斗南站前店 / 西螺文昌店",
      });
    }

    const lineResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text: message.slice(0, 5000) }],
      }),
    });

    const raw = await lineResponse.text();

    if (!lineResponse.ok) {
      return res.status(lineResponse.status).json({
        success: false,
        error: "LINE 發送失敗",
        detail: raw || `HTTP ${lineResponse.status}`,
        store: rawStore,
      });
    }

    return res.status(200).json({
      success: true,
      store: rawStore,
      detail: raw || "ok",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "伺服器錯誤",
      detail: error?.message || String(error),
    });
  }
}
