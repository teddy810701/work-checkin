// Read-only release probe. Never creates punches, meals, revenue or permissions.
// Temporary anonymous diagnostic sessions are removed in finally.
const { lookupPermission } = require("../api/revenue-permission");
const DB = "https://work-checkin-77acf-default-rtdb.asia-southeast1.firebasedatabase.app";
const FS = "https://firestore.googleapis.com/v1/projects/my-warm-day-pro/databases/(default)/documents:runQuery";
const KEYS = { checkin: "AIzaSyCQy8KiTnE9aN0ofMDIlUU5SEmKbBLJAZs", points: "AIzaSyAfBj728Hs928rZByNebgCkcJoU_MNxFIs" };
const sessions = [];
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000), redirect: "error" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Read-only probe HTTP ${response.status}`);
  return result;
}
async function session(key) {
  const result = await json(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
  });
  sessions.push({ key, token: result.idToken }); return result.idToken;
}
async function run() {
  const endpoint = process.argv[2] || "";
  if (endpoint && endpoint !== "https://work-checkin.vercel.app/api/revenue-permission") throw new Error("Unexpected release target");
  const [checkinToken, pointsToken] = await Promise.all([session(KEYS.checkin), session(KEYS.points)]);
  const authQuery = `auth=${encodeURIComponent(checkinToken)}`;
  const [config, recent, profilesResponse, ledgers] = await Promise.all([
    json(`${DB}/config/device.json?${authQuery}`),
    json(`${DB}/records.json?orderBy=%22%24key%22&limitToLast=200&${authQuery}`),
    json(FS, { method: "POST", headers: { authorization: `Bearer ${pointsToken}`, "content-type": "application/json" },
      body: JSON.stringify({ structuredQuery: { select: { fields: ["empId", "active", "role", "storeId", "isManager", "managerTitle"].map((fieldPath) => ({ fieldPath })) },
        from: [{ collectionId: "employeeUsers" }], where: { fieldFilter: { field: { fieldPath: "isManager" }, op: "EQUAL", value: { booleanValue: true } } }, limit: 10 } }) }),
    Promise.all(["storeA", "storeB"].map((id) => json(`${DB}/daily_store_revenue/${id}/2026-10.json?${authQuery}`))),
  ]);
  if (!Array.isArray(profilesResponse) || profilesResponse.some((entry) => entry.error)) throw new Error("Permission projection response invalid");
  const profiles = profilesResponse.filter((entry) => entry.document).map((entry) => Object.fromEntries(Object.entries(entry.document.fields || {}).map(([key, value]) => [key, value.stringValue ?? value.booleanValue]))).filter((entry) => entry.active === true && entry.role !== "admin");
  if (!profiles.length) throw new Error("No active manager permission found");
  if (profiles.some((entry) => !entry.empId || !["storeA", "storeB"].includes(entry.storeId) || !["店長", "代理店長"].includes(entry.managerTitle || "店長"))) {
    console.log(JSON.stringify({ existingManagerPermissionShape: profiles.map(({ empId, role, storeId, isManager, managerTitle }) => ({ empId, role, storeId, isManager, managerTitle })) }));
    throw new Error("Existing manager permission schema differs from the new revenue check");
  }
  const devices = { ...(config?.devices || {}) };
  if (config?.id && !Object.values(devices).some((item) => item?.id === config.id)) devices[config.store || config.storeName || "西螺文昌店"] = { id: config.id };
  const storeIds = { "西螺文昌店": "storeA", "斗南站前店": "storeB" };
  const cases = [];
  for (const [checkoutRecordId, record] of Object.entries(recent || {}).reverse()) {
    if (record?.type !== "下班" || !/^\d{13}$/.test(checkoutRecordId) || record.createdAt !== Number(checkoutRecordId)) continue;
    const bindings = Object.entries(devices).filter(([, value]) => value?.id === record.device);
    if (bindings.length !== 1 || !storeIds[bindings[0][0]]) continue;
    const storeId = storeIds[bindings[0][0]], manager = profiles.find((entry) => entry.empId === record.empId && entry.storeId === storeId);
    if (!manager || cases.some((entry) => entry.storeId === storeId)) continue;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(record.createdAt));
    if (Number(parts.find((entry) => entry.type === "hour").value) * 60 + Number(parts.find((entry) => entry.type === "minute").value) < 810) continue;
    const body = { checkoutRecordId, deviceId: record.device, dateKey: record.dateKey, storeId, checkinToken, pointsToken };
    const result = endpoint ? await json(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : await lookupPermission(body);
    if (result.allowed !== true || result.empId !== manager.empId || result.storeId !== storeId) throw new Error(`Bound ${storeId} manager permission denied`);
    const wrongStore = { ...body, storeId: storeId === "storeA" ? "storeB" : "storeA" };
    const denied = endpoint ? await json(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wrongStore) }) : await lookupPermission(wrongStore);
    if (denied.allowed !== false) throw new Error("Cross-store permission unexpectedly allowed");
    cases.push({ storeId, managerTitle: result.managerTitle, verified: true, crossStoreDenied: true });
  }
  console.log(JSON.stringify({ target: endpoint || "local handler with production read-only data", activeManagerCount: profiles.length,
    permissionProjectionReadable: true, storeMonthRevenueReadable: ledgers.map((value, index) => ({ storeId: index ? "storeB" : "storeA", recordedDays: Object.keys(value?.days || {}).length })),
    existingCheckoutPermissionCases: cases, businessWrites: 0 }));
  if (!cases.length) throw new Error("No qualifying existing checkout available to verify the permission bridge");
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  for (const { key, token } of sessions) {
    try { await json(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }) }); }
    catch (_) { console.error("Temporary diagnostic session cleanup unconfirmed"); process.exitCode = 1; }
  }
});
