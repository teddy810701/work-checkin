export default async function handler(req, res) {
  try {
    const { schedule, store } = req.body;

    const LINE_TOKEN = process.env.LINE_TOKEN;
    const GROUP_DOUNAN = process.env.LINE_GROUP_ID_DOUNAN;
    const GROUP_XILUO = process.env.LINE_GROUP_ID_XILUO;

    const groupId =
      store === "douNan" ? GROUP_DOUNAN :
      store === "xiLuo" ? GROUP_XILUO :
      null;

    if (!LINE_TOKEN) {
      return res.status(500).json({ error: "LINE_TOKEN missing" });
    }

    if (!groupId) {
      return res.status(500).json({ error: "groupId missing" });
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
            text: `📅 班表通知\n${schedule}`,
          },
        ],
      }),
    });

    const text = await response.text();
    console.log("LINE response:", text);

    if (!response.ok) {
      return res.status(500).json({ error: text });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}