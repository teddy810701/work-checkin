function getLineToken() {
  return (
    process.env.LINE_TOKEN ||
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_CHANNEL_TOKEN ||
    ""
  );
}

async function replyMessage(replyToken, text) {
  const token = getLineToken();

  if (!token || !replyToken) {
    return { ok: false, status: 500, rawText: "missing token or replyToken" };
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });

  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    rawText,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const text = String(event.message.text || "").trim();

      if (text === "ping") {
        await replyMessage(event.replyToken, "pong");
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "webhook error",
      detail: error.message,
    });
  }
}
