const crypto = require("crypto");

// Keep the endpoint configurable for local/staging projects, while providing
// the production Cloud Function URL used by the employee app by default.
const PUSH_URL = process.env.EMPLOYEE_APP_ADJUSTMENT_NOTIFY_URL
  || "https://asia-east1-my-warm-day-pro.cloudfunctions.net/notifyScheduleAdjustmentPartner";
const PUSH_SECRET = process.env.SCHEDULE_PUBLISH_SECRET;

const taipeiDateKey = (timestamp = Date.now()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(timestamp));

const addDateKeyDays = (dateKey, days) => {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day || !Number.isFinite(days)) return "";
  return new Date(Date.UTC(year, month - 1, day + Number(days))).toISOString().slice(0, 10);
};

module.exports = async (request, response) => {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "method-not-allowed" });
    return;
  }

  if (!PUSH_SECRET) {
    response.status(503).json({ error: "notification-service-not-configured" });
    return;
  }

  const { requestId, request: adjustmentRequest } = request.body || {};
  const id = String(requestId || "").trim();
  if (!id || !adjustmentRequest || typeof adjustmentRequest !== "object"
    || adjustmentRequest.requestType !== "調假"
    || !String(adjustmentRequest.swapWithEmpId || "").trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(adjustmentRequest.requestDate || ""))
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(adjustmentRequest.adjustmentDate || ""))) {
    response.status(400).json({ error: "invalid-payload" });
    return;
  }
  const earliestRequestDate = addDateKeyDays(taipeiDateKey(), 3);
  if (adjustmentRequest.requestDate < earliestRequestDate || adjustmentRequest.adjustmentDate < earliestRequestDate) {
    response.status(400).json({ error: "adjustment-too-late", message: "調假需要至少提前 3 天申請" });
    return;
  }

  const body = JSON.stringify({ requestId: id, request: adjustmentRequest });
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
    response.status(upstream.ok ? 200 : 502).json({ ok: upstream.ok, ...result });
  } catch (error) {
    console.error("Schedule adjustment notification proxy failed", error);
    response.status(502).json({ error: "notification-service-unavailable" });
  }
};
