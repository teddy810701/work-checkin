function normalizeStoreName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("斗南")) return "斗南站前店";
  if (text.includes("西螺")) return "西螺文昌店";
  return text;
}

function getManagerGroupIdByStore(store) {
  const normalized = normalizeStoreName(store);
  if (normalized === "斗南站前店") return process.env.LINE_GROUP_ID_MANAGER_DOUNAN;
  if (normalized === "西螺文昌店") return process.env.LINE_GROUP_ID_MANAGER_XILUO;
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const token = process.env.LINE_TOKEN;
    const { message, store } = req.body || {};
    const groupId = getManagerGroupIdByStore(store);

    if (!token) {
      return res.status(500).json({ success: false, error: "缺少 LINE_TOKEN" });
    }

    if (!groupId) {
      return res.status(500).json({ success: false, error: `缺少 ${store || "對應店別"} 的店長群組 ID` });
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
