import { readFileSync } from "fs";
import { runInNewContext } from "vm";
import { createManualDailyDutyAssignment, getDailyDutyFingerprint, getDailyDutyCandidates, getDailyDutyAssignmentCounts } from "./dailyDuty";

const source = readFileSync(`${__dirname}/App.js`, "utf8");
const start = source.indexOf("  const saveDutyEditorAssignment = useCallback");
const end = source.indexOf("\n  const ensureDailyDutyAssignments", start);
const store = "西螺文昌店";
const original = { members: [{ empId: "0819", name: "嫻亭" }], updatedAt: 1000 };
const employees = { "0826": { empId: "0826", name: "奕婷", store }, "0830": { empId: "0830", name: "綵妤", store }, A0315: { empId: "A0315", name: "宗富", store } };
const schedule = { "0826": { working: true }, "0830": { working: true }, A0315: { working: true, isSupport: true, supportStore: "斗南站前店" } };
const createFlow = (current = original, isAdmin = true) => {
  const get = jest.fn(async (path) => ({ val: () => path === "employees" ? employees : path.startsWith("schedules/") ? schedule : { "2026-10-09": { [store]: current } } }));
  const runTransaction = jest.fn(async (path, callback, options) => {
    expect(options.applyLocally).toBe(false);
    const result = callback(current);
    return { committed: result !== undefined, snapshot: { val: () => result === undefined ? current : result } };
  });
  const context = {
    useCallback: (callback) => callback, isAdmin, auth: { currentUser: { uid: "test_admin" } }, db: {}, get, ref: (_, path) => path, runTransaction,
    DAILY_DUTY_STORES: [store, "斗南站前店"], DAILY_DUTY_STORE_IDS: { [store]: "storeA" },
    getDailyDutyStoreKey: (name) => name, getMonthKeyFromDateKey: (date) => date.slice(0, 7),
    createManualDailyDutyAssignment, getDailyDutyFingerprint, getDailyDutyCandidates, getDailyDutyAssignmentCounts,
  };
  runInNewContext(source.slice(start, end) + "\nglobalThis.save = saveDutyEditorAssignment;", context);
  return { save: context.save, get, runTransaction };
};
const input = { dateKey: "2026-10-09", store, selectedEmpIds: ["0826", "0830"], reason: "提前離班替補", existing: original };

test("administrator saves a past correction only at the selected date and store, retaining audit history", async () => {
  const flow = createFlow();
  const result = await flow.save(input);
  expect(flow.runTransaction.mock.calls[0][0]).toBe(`daily_duty_assignments/2026-10-09/${store}`);
  expect(result.members.map((member) => member.empId)).toEqual(["0826", "0830"]);
  expect(result.revisions.rev_1.previousMembers).toEqual(original.members);
  expect(flow.get.mock.calls.map(([path]) => path)).toEqual(["schedules/2026-10-09", "employees", "daily_duty_assignments"]);
});

test("a concurrently changed assignment is not overwritten", async () => {
  const flow = createFlow({ members: [{ empId: "0830" }], updatedAt: 2000 });
  await expect(flow.save(input)).rejects.toThrow("其他裝置更新");
});

test("changed schedules are rechecked when saving, not taken from stale UI candidates", async () => {
  const flow = createFlow();
  await expect(flow.save({ ...input, selectedEmpIds: ["A0315"] })).rejects.toThrow("當天未在這間門市");
  expect(flow.runTransaction).not.toHaveBeenCalled();
});

test("non-administrator sessions cannot call the editor save handler", async () => {
  const flow = createFlow(original, false);
  await expect(flow.save(input)).rejects.toThrow("登入管理員");
  expect(flow.get).not.toHaveBeenCalled();
  expect(flow.runTransaction).not.toHaveBeenCalled();
});
