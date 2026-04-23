function getLineToken() {
  return (
    process.env.LINE_TOKEN ||
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_CHANNEL_TOKEN ||
    ""
  );
}

async function pushLineMessage({ token, to, text }) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });

  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch (e) {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    rawText,
    json,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const token = getLineToken();
    const groupId = process.env.LINE_GROUP_ID_LATE || "";
    const message = req.body?.message || "";

    if (!token) {
      return res.status(500).json({
        success: false,
        error: "缺少 LINE Token",
        detail: "請到 Vercel Environment Variables 設定 LINE_TOKEN",
      });
    }

    if (!groupId) {
      return res.status(500).json({
        success: false,
        error: "缺少遲到通知群組 ID",
        detail: "請設定 LINE_GROUP_ID_LATE",
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "缺少訊息內容",
      });
    }

    const result = await pushLineMessage({
      token,
      to: groupId,
      text: String(message),
    });

    if (!result.ok) {
      return res.status(result.status || 500).json({
        success: false,
        error: "LINE 發送失敗",
        detail:
          result.json?.message ||
          result.rawText ||
          `HTTP ${result.status}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "遲到通知已送出",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "伺服器錯誤",
      detail: error.message,
    });
  }
}
