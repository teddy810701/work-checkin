module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const LINE_TOKEN = process.env.LINE_TOKEN || process.env.LINE_CHANNEL_TOKEN;
    const { events } = req.body || {};

    if (!LINE_TOKEN) {
      return res.status(500).json({ ok: false, error: "缺少 LINE token" });
    }

    if (!events || events.length === 0) {
      return res.status(200).end();
    }

    for (const event of events) {
      if (event.type !== "message" || event.message?.type !== "text") continue;
      if (!event.replyToken) continue;

      const source = event.source || {};
      let replyText = "";

      if (source.type === "group") {
        replyText = `📋 ID 資訊
群組 ID：
${source.groupId || "抓不到"}

用戶 ID：
${source.userId || "抓不到"}`;
      } else if (source.type === "user") {
        replyText = `📋 你的 LINE ID：
${source.userId || "抓不到"}`;
      } else if (source.type === "room") {
        replyText = `📋 Room ID：
${source.roomId || "抓不到"}`;
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

    return res.status(200).end();
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
