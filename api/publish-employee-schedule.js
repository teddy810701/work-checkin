const crypto = require("crypto");

const PUSH_URL = process.env.EMPLOYEE_APP_SCHEDULE_PUSH_URL;
const PUSH_SECRET = process.env.SCHEDULE_PUBLISH_SECRET;

module.exports = async (request, response) => {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "method-not-allowed" });
    return;
  }

  if (!PUSH_URL || !PUSH_SECRET) {
    response.status(503).json({ error: "notification-service-not-configured" });
    return;
  }

  const { dateKey, schedules, previousSchedules = {}, dailyDutyAssignments = {} } = request.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))
    || !schedules || typeof schedules !== "object" || Array.isArray(schedules)
    || !previousSchedules || typeof previousSchedules !== "object" || Array.isArray(previousSchedules)
    || !dailyDutyAssignments || typeof dailyDutyAssignments !== "object" || Array.isArray(dailyDutyAssignments)) {
    response.status(400).json({ error: "invalid-payload" });
    return;
  }

  const body = JSON.stringify({ dateKey, schedules, previousSchedules, dailyDutyAssignments });
  const signature = crypto.createHmac("sha256", PUSH_SECRET).update(body).digest("hex");

  try {
    const upstream = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-schedule-signature": signature,
      },
      body,
    });
    const result = await upstream.json().catch(() => ({}));
    response.status(upstream.ok ? 200 : 502).json({
      ok: upstream.ok,
      ...result,
    });
  } catch (error) {
    response.status(502).json({ error: "notification-service-unavailable" });
  }
};
