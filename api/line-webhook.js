module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const LINE_TOKEN = process.env.LINE_TOKEN;
  const { events } = req.body || {};

  if (!LINE_TOKEN) {
    return res.status(500).json({ success: false, error: "缺少 LINE_TOKEN" });
  }

  if (!events || events.length === 0) {
    return res.status(200).end();
  }

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    if (!event.replyToken) continue;

    const source = event.source;
    let replyText = "";

    if (source.type === "group") {
      replyText = `📋 ID 資訊\n群組 ID：\n${source.groupId}\n\n用戶 ID：\n${source.userId || "抓不到 userId"}`;
    } else if (source.type === "user") {
      replyText = `📋 你的 LINE ID：\n${source.userId}`;
    }

    if (!replyText) continue;

    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: replyText }],
      }),
    });
  }

  res.status(200).end();
};
