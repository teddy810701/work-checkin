import { readFileSync } from "fs";
import { runInNewContext } from "vm";
import { completeDailyDutyAssignment, getDailyDutyCandidates, getDailyDutyMembers, getDailyDutyAssignmentCounts } from "./dailyDuty";

// Exercise the actual App orchestration without mounting the live Firebase app.
const source = readFileSync(`${__dirname}/App.js`, "utf8");
const start = source.indexOf("  const ensureDailyDutyAssignments = async");
const end = source.indexOf("\n  useEffect(() => {\n    if (!isAdmin)", start);
if (start < 0 || end < start) throw new Error("Duty orchestration boundary changed");
const storeA = "西螺文昌店";
const storeB = "斗南站前店";
const employees = [
  { empId: "A1", name: "文昌一", store: storeA }, { empId: "A2", name: "文昌二", store: storeA },
  { empId: "B1", name: "斗南一", store: storeB }, { empId: "B2", name: "斗南二", store: storeB },
];
const schedule = Object.fromEntries(employees.map((e) => [e.empId, { working: true, store: e.store }]));
const assignment = (store, empIds) => ({
  dateKey: "2026-10-07", store, members: empIds.map((empId) => ({ empId, name: empId })), memberCount: empIds.length, createdAt: 1000, updatedAt: 1000,
});
const createFlow = (history, latest = history["2026-10-07"] || {}) => {
  const get = jest.fn(async () => ({ val: () => history }));
  const runTransaction = jest.fn(async (path, callback, transactionOptions) => {
    expect(transactionOptions.applyLocally).toBe(false);
    const current = latest[path.split("/").pop()] || null;
    const next = callback(current);
    return { committed: next !== undefined, snapshot: { val: () => next === undefined ? current : next } };
  });
  const context = {
    employees, db: {}, get, ref: (_, path) => path, runTransaction,
    DAILY_DUTY_STORES: [storeA, storeB], DAILY_DUTY_MEMBERS_PER_STORE: 2,
    DAILY_DUTY_STORE_IDS: { [storeA]: "storeA", [storeB]: "storeB" },
    getDailyDutyStoreKey: (store) => store,
    getMonthKeyFromDateKey: (date) => date.slice(0, 7),
    formatTaipeiDateKey: () => "2026-10-06",
    addDateKeyDays: () => "2026-10-06",
    completeDailyDutyAssignment, getDailyDutyCandidates, getDailyDutyMembers, getDailyDutyAssignmentCounts,
  };
  runInNewContext(source.slice(start, end) + "\nglobalThis.ensure = ensureDailyDutyAssignments;", context);
  return { ensure: context.ensure, get, runTransaction };
};

test("the real flow writes only the missing store and preserves the complete store", async () => {
  const full = assignment(storeA, ["A1", "A2"]);
  const partial = assignment(storeB, ["B1"]);
  const flow = createFlow({ "2026-10-07": { [storeA]: full, [storeB]: partial } });
  const result = await flow.ensure("2026-10-07", schedule);
  expect(flow.runTransaction).toHaveBeenCalledTimes(1);
  expect(flow.runTransaction.mock.calls[0][0]).toBe(`daily_duty_assignments/2026-10-07/${storeB}`);
  expect(result[storeA]).toBe(full);
  expect(result[storeB].members.map((e) => e.empId)).toEqual(["B1", "B2"]);
  expect(result[storeB].members[0]).toBe(partial.members[0]);
  expect(result[storeB].createdAt).toBe(1000);
});

test("full lists do not start any transaction on refresh", async () => {
  const flow = createFlow({ "2026-10-07": { [storeA]: assignment(storeA, ["A1", "A2"]), [storeB]: assignment(storeB, ["B1", "B2"]) } });
  await flow.ensure("2026-10-07", schedule);
  expect(flow.runTransaction).not.toHaveBeenCalled();
});

test("a concurrently added member wins over a stale one-person read", async () => {
  const latest = assignment(storeB, ["B1", "B3"]);
  const flow = createFlow({ "2026-10-07": { [storeA]: assignment(storeA, ["A1", "A2"]), [storeB]: assignment(storeB, ["B1"]) } }, { [storeB]: latest });
  const result = await flow.ensure("2026-10-07", schedule);
  expect(result[storeB]).toBe(latest);
});

test("loading tomorrow does not create a new list before publication", async () => {
  const flow = createFlow({});
  const result = await flow.ensure("2026-10-07", schedule, { fillExistingOnly: true });
  expect(result).toEqual({});
  expect(flow.runTransaction).not.toHaveBeenCalled();
});

test("past assignments are never backfilled", async () => {
  const past = { [storeA]: assignment(storeA, ["A1"]), [storeB]: assignment(storeB, ["B1"]) };
  const flow = createFlow({ "2026-10-05": past });
  const result = await flow.ensure("2026-10-05", schedule);
  expect(result[storeA]).toBe(past[storeA]);
  expect(result[storeB]).toBe(past[storeB]);
  expect(flow.runTransaction).not.toHaveBeenCalled();
});
