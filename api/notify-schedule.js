module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const LINE_TOKEN = process.env.LINE_CHANNEL_TOKEN;
  if (!LINE_TOKEN) {
    return res.status(500).json({ error: "LINE token not configured" });
  }

  const { schedules } = req.body || {};
  if (!schedules || Object.keys(schedules).length === 0) {
    return res.status(200).json({ ok: true, message: "無排班資料" });
  }

  const STORE_GROUP_MAP = {
    西螺文昌店: process.env.LINE_GROUP_XILUO,
    斗南站前店: process.env.LINE_GROUP_DOUNAN,
  };

  const byStore = {};
  Object.values(schedules).forEach((emp) => {
    const store = emp.store || "未知店面";
    if (!byStore[store]) byStore[store] = [];
    byStore[store].push(emp);
  });

  const today = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const errors = [];

  for (const [store, emps] of Object.entries(byStore)) {
    const groupId = STORE_GROUP_MAP[store];
    if (!groupId) continue;

    const lines = emps
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))
      .map((e) => `${e.name}　${e.startTime || "--:--"} 上班`)
      .join("\n");

    const message = `📋 ${store} 今日班表\n${today}\n${"─".repeat(14)}\n${lines}`;

    try {
      const resp = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_TOKEN}`,
        },
        body: JSON.stringify({
          to: groupId,
          messages: [{ type: "text", text: message }],
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        errors.push(`${store}: ${resp.status} ${errBody}`);
      }
    } catch (err) {
      errors.push(`${store}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    return res.status(207).json({ ok: false, errors });
  }

  return res.status(200).json({ ok: true });
}
