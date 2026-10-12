const { test } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/revenue-permission");
const body = { checkoutRecordId: String(Date.parse("2026-10-12T14:00:00+08:00")), deviceId: "DEV-TEST", dateKey: "2026-10-12", storeId: "storeA", checkinToken: "kiosk-session-not-printed", pointsToken: "points-session-not-printed" };
const profile = (values = {}) => ({ document: { fields: { empId: { stringValue: "0326" }, active: { booleanValue: true }, role: { stringValue: "employee" }, isManager: { booleanValue: true }, managerTitle: { stringValue: "店長" }, storeId: { stringValue: "storeA" }, ...values } } });
function mockRead({ profiles = [profile()], record = {}, config = { devices: { "西螺文昌店": { id: body.deviceId } } }, fail = false } = {}) {
  const calls = [];
  const previous = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    assert.ok(!options.method || options.method === "POST"); // Never writes to either database.
    if (fail) return { ok: false };
    const value = url.includes("/records/") ? { empId: "0326", type: "下班", device: body.deviceId, dateKey: body.dateKey, createdAt: Number(body.checkoutRecordId), ...record }
      : url.includes("/config/") ? config : profiles;
    return { ok: true, json: async () => value };
  };
  return { calls, close: () => { global.fetch = previous; } };
}
test("canonical manager and acting manager allowed; only minimal projected fields returned", async () => {
  for (const title of ["店長", "代理店長"]) {
    const f = mockRead({ profiles: [profile({ managerTitle: { stringValue: title } })] });
    try {
      assert.deepEqual(await handler.lookupPermission(body), { allowed: true, empId: "0326", storeId: "storeA", managerTitle: title });
      const query = JSON.parse(f.calls.find((call) => call.url.includes("firestore")).options.body).structuredQuery;
      assert.deepEqual(query.select.fields.map((field) => field.fieldPath), ["empId", "active", "role", "storeId", "isManager", "managerTitle"]);
      assert.equal(query.limit, 2); assert.equal(query.where.fieldFilter.value.stringValue, "0326");
    } finally { f.close(); }
  }
});
test("legacy manager without title retains existing App manager permission; ordinary staff without title is denied", async () => {
  const legacy = profile(); delete legacy.document.fields.managerTitle;
  let f = mockRead({ profiles: [legacy] });
  try { assert.deepEqual(await handler.lookupPermission(body), { allowed: true, empId: "0326", storeId: "storeA", managerTitle: "店長" }); } finally { f.close(); }
  legacy.document.fields.isManager.booleanValue = false;
  f = mockRead({ profiles: [legacy] });
  try { assert.deepEqual(await handler.lookupPermission(body), { allowed: false }); } finally { f.close(); }
});
test("ordinary, former, cross-store, ambiguous and missing accounts are denied despite claimed titles", async () => {
  for (const profiles of [[profile({ isManager: { booleanValue: false } })], [profile({ active: { booleanValue: false } })], [profile({ storeId: { stringValue: "storeB" } })], [profile({ managerTitle: { stringValue: "正職" } })], [profile({ role: { stringValue: "admin" } })], [profile(), profile()], []]) {
    const f = mockRead({ profiles });
    try { assert.deepEqual(await handler.lookupPermission({ ...body, isManager: true, managerTitle: "店長" }), { allowed: false }); } finally { f.close(); }
  }
});
test("a real completed checkout and matching bound store are required", async () => {
  const cases = [{ record: { type: "上班" } }, { record: { device: "OTHER" } }, { record: { dateKey: "2026-10-11" } }, { record: { createdAt: Date.parse("2026-10-12T13:29:00+08:00") } }, { config: {} }, { config: { devices: { "斗南站前店": { id: body.deviceId } } } }, { config: { devices: { "西螺文昌店": { id: body.deviceId }, "斗南站前店": { id: body.deviceId } } } }];
  for (const item of cases) {
    const f = mockRead(item);
    try { assert.deepEqual(await handler.lookupPermission(body), { allowed: false }); assert.ok(!f.calls.some((call) => call.url.includes("firestore"))); } finally { f.close(); }
  }
  const f = mockRead({ record: { createdAt: Date.parse("2026-10-12T13:29:00+08:00") } });
  try { assert.deepEqual(await handler.lookupPermission({ ...body, checkoutRecordId: String(Date.parse("2026-10-12T13:29:00+08:00")) }), { allowed: false }); } finally { f.close(); }
});
test("legacy device binding works without changing its existing settings", async () => {
  const f = mockRead({ config: { id: body.deviceId, store: "西螺文昌店" } });
  try { assert.equal((await handler.lookupPermission(body)).allowed, true); } finally { f.close(); }
});
test("invalid payload or upstream error never fails open", async () => {
  const f = mockRead({ fail: true });
  try {
    await assert.rejects(handler.lookupPermission({ ...body, checkoutRecordId: "../" }), { status: 400 }); assert.equal(f.calls.length, 0);
    await assert.rejects(handler.lookupPermission(body), /permission-read-failed/);
  } finally { f.close(); }
});
test("route is read-only POST, never cacheable, and does not expose credentials in failure output", async () => {
  const headers = {}; let status, output;
  const response = { setHeader: (key, value) => { headers[key] = value; }, status: (value) => { status = value; return response; }, json: (value) => { output = value; } };
  await handler({ method: "GET" }, response); assert.equal(status, 405); assert.equal(headers["Cache-Control"], "no-store");
  const f = mockRead({ fail: true });
  try { await handler({ method: "POST", body }, response); assert.equal(status, 503); assert.ok(!JSON.stringify(output).includes(body.checkinToken)); } finally { f.close(); }
});
