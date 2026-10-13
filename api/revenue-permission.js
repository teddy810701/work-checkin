// Read-only permission bridge. Uses the kiosk's existing Firebase sessions, not
// an Admin credential. The paused legacy database-rule migration is untouched.
const CHECKIN_DB = "https://work-checkin-77acf-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROFILE_QUERY = "https://firestore.googleapis.com/v1/projects/my-warm-day-pro/databases/(default)/documents:runQuery";
const STORES = { "西螺文昌店": "storeA", "斗南站前店": "storeB" };
const fields = ["empId", "active", "role", "storeId", "isManager", "managerTitle", "canEnterRevenue", "revenueStoreIds"];
const denied = () => ({ allowed: false });

async function readJson(url, options) {
  const result = await fetch(url, { ...options, signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!result.ok) throw new Error("permission-read-failed");
  return result.json();
}

async function lookupPermission(body) {
  const { checkoutRecordId, deviceId, storeId, dateKey, checkinToken, pointsToken } = body || {};
  if (!/^\d{13}$/.test(checkoutRecordId || "") || !/^[A-Za-z0-9_-]{1,100}$/.test(deviceId || "")
    || !["storeA", "storeB"].includes(storeId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")
    || typeof checkinToken !== "string" || checkinToken.length < 20 || checkinToken.length > 5000
    || typeof pointsToken !== "string" || pointsToken.length < 20 || pointsToken.length > 5000) {
    throw Object.assign(new Error("invalid-request"), { status: 400 });
  }
  const query = `?auth=${encodeURIComponent(checkinToken)}`;
  const [record, config] = await Promise.all([
    readJson(`${CHECKIN_DB}/records/${checkoutRecordId}.json${query}`),
    readJson(`${CHECKIN_DB}/config/device.json${query}`),
  ]);
  if (record?.type !== "下班" || record.device !== deviceId || record.dateKey !== dateKey
    || record.createdAt !== Number(checkoutRecordId) || !/^[A-Za-z0-9_-]{1,40}$/.test(record.empId || "")) return denied();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(record.createdAt));
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  if (`${part("year")}-${part("month")}-${part("day")}` !== dateKey || Number(part("hour")) * 60 + Number(part("minute")) < 810) return denied();
  const devices = { ...(config?.devices || {}) };
  if (config?.id && !Object.values(devices).some((item) => item?.id === config.id)) {
    devices[config.store || config.storeName || "西螺文昌店"] = { id: config.id };
  }
  const bindings = Object.entries(devices).filter(([, item]) => item?.id === deviceId);
  if (bindings.length !== 1 || STORES[bindings[0][0]] !== storeId) return denied();
  const empId = String(record.empId).trim().toUpperCase();
  const result = await readJson(PROFILE_QUERY, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${pointsToken}` },
    body: JSON.stringify({ structuredQuery: {
      select: { fields: fields.map((fieldPath) => ({ fieldPath })) },
      from: [{ collectionId: "employeeUsers" }],
      where: { fieldFilter: { field: { fieldPath: "empId" }, op: "EQUAL", value: { stringValue: empId } } },
      limit: 2,
    } }),
  });
  if (!Array.isArray(result) || result.some((entry) => entry.error)) throw new Error("invalid-permission-response");
  const profiles = result.filter((entry) => entry.document).map((entry) => entry.document.fields || {});
  // Ambiguous identities fail closed, including an inactive duplicate account.
  if (profiles.length !== 1) return denied();
  const profile = profiles[0];
  // Explicit revenue permission overrides the legacy manager/deputy-manager
  // inheritance. Profiles without the new field retain their old behavior.
  const hasRevenueOverride = typeof profile.canEnterRevenue?.booleanValue === "boolean";
  const legacyManagerTitle = profile.managerTitle?.stringValue || "店長";
  const legacyManager = profile.isManager?.booleanValue === true && ["店長", "代理店長"].includes(legacyManagerTitle);
  const canEnterRevenue = hasRevenueOverride ? profile.canEnterRevenue.booleanValue : legacyManager;
  // Missing field retains home-shop permission. An explicit list authorizes
  // only the selected shops; invalid/empty lists must never fall back to both.
  let revenueStores = [profile.storeId?.stringValue];
  if (Object.prototype.hasOwnProperty.call(profile, "revenueStoreIds")) {
    const values = profile.revenueStoreIds?.arrayValue?.values ?? (profile.revenueStoreIds?.arrayValue ? [] : null);
    if (!Array.isArray(values) || values.length > 2 || values.some((item) => !["storeA", "storeB"].includes(item?.stringValue)) || new Set(values.map((item) => item.stringValue)).size !== values.length) return denied();
    revenueStores = values.map((item) => item.stringValue);
  }
  const managerTitle = profile.managerTitle?.stringValue || (legacyManager ? "店長" : "");
  if (profile.empId?.stringValue !== empId || profile.active?.booleanValue !== true
    || profile.role?.stringValue === "admin" || !revenueStores.includes(storeId) || !canEnterRevenue) return denied();
  return { allowed: true, empId, storeId, managerTitle };
}

module.exports = async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST"); return response.status(405).json({ error: "method-not-allowed" });
  }
  try {
    return response.status(200).json(await lookupPermission(request.body));
  } catch (error) {
    // Never log tokens, account fields or upstream URLs containing credentials.
    console.warn("revenue-permission", error.status || "unavailable");
    return response.status(error.status || 503).json({ error: "無法確認營收填寫權限；打卡已成功，請繼續登記員工餐。" });
  }
};
module.exports.lookupPermission = lookupPermission;
