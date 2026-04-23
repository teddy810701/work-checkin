export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const token = process.env.LINE_TOKEN;
    const groupId = process.env.LINE_GROUP_ID_LATE;
    const { message } = req.body || {};

    if (!token) {
      return res.status(500).json({ success: false, error: "缺少 LINE_TOKEN" });
    }

    if (!groupId) {
      return res.status(500).json({ success: false, error: "缺少 LINE_GROUP_ID_LATE" });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, error: "缺少 message" });
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

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "伺服器錯誤",
    });
  }
}
