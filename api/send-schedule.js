function normalizeStoreName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("斗南")) return "斗南站前店";
  if (text.includes("西螺")) return "西螺文昌店";
  return text;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { schedule, message, store } = req.body || {};

    const LINE_TOKEN = process.env.LINE_TOKEN;
    const GROUP_DOUNAN = process.env.LINE_GROUP_ID_DOUNAN;
    const GROUP_XILUO = process.env.LINE_GROUP_ID_XILUO;

    const normalizedStore = normalizeStoreName(store);

    const groupId =
      normalizedStore === "斗南站前店"
        ? GROUP_DOUNAN
        : normalizedStore === "西螺文昌店"
        ? GROUP_XILUO
        : null;

    const textToSend = String(message || schedule || "").trim();

    if (!LINE_TOKEN) {
      return res.status(500).json({ success: false, error: "LINE_TOKEN missing" });
    }

    if (!groupId) {
      return res.status(500).json({
        success: false,
        error: `${normalizedStore || store || "未知店別"}：groupId missing`,
      });
    }

    if (!textToSend) {
      return res.status(400).json({ success: false, error: "message missing" });
    }

    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_TOKEN}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [
          {
            type: "text",
            text: textToSend,
          },
        ],
      }),
    });

    const text = await response.text();
    console.log("LINE response:", text);

    if (!response.ok) {
      return res.status(500).json({ success: false, error: text || "LINE 發送失敗" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message || "server error" });
  }
}
