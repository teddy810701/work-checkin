export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const token = process.env.LINE_TOKEN;
    const { store, message } = req.body || {};

    if (!token) {
      return res.status(500).json({ success: false, error: "缺少 LINE_TOKEN" });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: "缺少 store" });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, error: "缺少 message" });
    }

    let groupId = "";

    if (store === "斗南站前店") {
      groupId = process.env.LINE_GROUP_ID_DOUNAN;
    } else if (store === "西螺文昌店") {
      groupId = process.env.LINE_GROUP_ID_XILUO;
    } else {
      return res.status(400).json({
        success: false,
        error: `未知店別：${store}`,
      });
    }

    if (!groupId) {
      return res.status(500).json({
        success: false,
        error: `缺少 ${store} 對應的群組 ID`,
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
        messages: [{ type: "text", text: String(message) }],
      }),
    });

    const raw = await lineResponse.text();

    if (!lineResponse.ok) {
      return res.status(lineResponse.status).json({
        success: false,
        error: raw || "LINE API 發送失敗",
      });
    }

    return res.status(200).json({ success: true, store });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "伺服器錯誤",
    });
  }
}
