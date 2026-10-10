import { completeDailyDutyAssignment, createManualDailyDutyAssignment, getDailyDutyFingerprint, getDailyDutyCandidates, getDailyDutyMembers, getDailyDutyAssignmentCounts } from "./dailyDuty";

const store = "斗南站前店";
const candidate = (empId, name = empId) => ({ empId, name, store, role: "正職" });
const options = { dateKey: "2026-10-07", store, storeId: "storeB", now: 2000 };
const complete = (overrides = {}) => completeDailyDutyAssignment({ ...options, ...overrides });
const original = { ...options, empId: "0819", name: "原值日生", members: [candidate("0819", "原值日生")], memberCount: 1, createdAt: 1000, updatedAt: 1000, customField: "保留" };

test("fills the missing slot without changing the first person or creation time", () => {
  const result = complete({ existing: original, candidates: [candidate("0819"), candidate("0321"), candidate("0322")], counts: { "0321": 0, "0322": 2 } });
  expect(result.members).toEqual([original.members[0], { ...candidate("0321"), assignmentCountBefore: 0 }]);
  expect(result).toMatchObject({ empId: "0819", name: "原值日生", createdAt: 1000, updatedAt: 2000, memberCount: 2, customField: "保留" });
  expect(original.members).toHaveLength(1);
});

test("refreshes do not reshuffle eligible members, but changed schedules replace invalid people", () => {
  const filled = complete({ existing: original, candidates: [candidate("0819"), candidate("0321")] });
  expect(complete({ existing: filled, candidates: [candidate("0819"), candidate("0321"), candidate("0213")], now: 9999 })).toBe(filled);
  const revised = complete({ existing: filled, candidates: [candidate("0321"), candidate("0213")], now: 9999 });
  expect(revised.members.map((member) => member.empId)).toEqual(["0321", "0213"]);
  expect(revised.revisions.rev_2.previousMembers.map((member) => member.empId)).toEqual(["0819", "0321"]);
});

test("a transaction retry preserves a concurrently filled list", () => {
  const concurrent = { ...original, members: [original.members[0], candidate("0802")], memberCount: 2, updatedAt: 1500 };
  expect(complete({ existing: concurrent, candidates: [candidate("0819"), candidate("0802"), candidate("0321")] })).toBe(concurrent);
});

test("a one-person schedule stays valid and fills when another worker is added", () => {
  const first = complete({ candidates: [candidate("0819")] });
  expect(first.memberCount).toBe(1);
  expect(complete({ existing: first, candidates: [candidate("0819")] })).toBe(first);
  const later = complete({ existing: first, candidates: [candidate("0819"), candidate("0321")] });
  expect(later.members.map((member) => member.empId)).toEqual(["0819", "0321"]);
});

test("no workers never produces a placeholder; moved people are cleared with an audit record", () => {
  expect(complete()).toBeNull();
  const cleared = complete({ existing: original });
  expect(cleared.members).toEqual([]);
  expect(cleared.empId).toBe("");
  expect(getDailyDutyMembers(cleared)).toEqual([]);
  expect(cleared.revisions.rev_1.previousMembers).toEqual(original.members);
  expect(complete({ existing: cleared })).toBe(cleared);
});

test("legacy single-person records and object-shaped members are preserved when filled", () => {
  const legacy = { empId: "0819", name: "原值日生", createdAt: 1000 };
  const result = complete({ existing: legacy, candidates: [candidate("0819"), candidate("0321")] });
  expect(result.members[0]).toEqual(legacy);
  expect(result.memberCount).toBe(2);
  const objectMembers = { ...original, members: { first: original.members[0] } };
  expect(complete({ existing: objectMembers, candidates: [candidate("0819"), candidate("0321")] }).members).toHaveLength(2);
});

test("monthly balancing and avoiding yesterday's duty still apply to the new slot", () => {
  const result = complete({ existing: original, candidates: [candidate("0819"), candidate("0321"), candidate("0322")], counts: { "0321": 0, "0322": 2 }, yesterdayMembers: [candidate("0321")] });
  expect(result.members[1].empId).toBe("0322");
  const fallback = complete({ existing: original, candidates: [candidate("0819"), candidate("0321")], yesterdayMembers: [candidate("0321")] });
  expect(fallback.members[1].empId).toBe("0321");
});

test("a support-store change removes the worker from home-store duty without replacing the other member", () => {
  const employees = [candidate("A0315", "宗富"), candidate("0819", "嫻亭"), candidate("0826", "奕婷")];
  const schedule = { A0315: { working: true, isSupport: true, supportStore: "西螺文昌店" }, "0819": { working: true }, "0826": { working: true } };
  const before = { members: employees.slice(0, 2), createdAt: 1000 };
  const result = complete({ existing: before, candidates: getDailyDutyCandidates(employees, schedule, store) });
  expect(result.members.map((member) => member.empId)).toEqual(["0819", "0826"]);
  expect(result.createdAt).toBe(1000);
  expect(result.revisions.rev_1.previousMembers.map((member) => member.empId)).toEqual(["A0315", "0819"]);
});

const manual = (overrides = {}) => createManualDailyDutyAssignment({
  ...options, existing: original, selectedEmpIds: ["0321", "0322"],
  candidates: [candidate("0321"), candidate("0322"), candidate("0819")], reason: "提早離班替補", actor: "admin:test", ...overrides,
});

test("manual replacements retain old records and are counted instead of the original duty", () => {
  const changed = manual();
  expect(changed.source).toBe("manual");
  expect(changed.createdAt).toBe(1000);
  expect(changed.revisions.rev_1.previousMembers).toEqual(original.members);
  expect(changed.revisions.rev_1.nextMembers).toEqual(changed.members);
  expect(getDailyDutyAssignmentCounts({ "2026-10-07": { [store]: changed } }, "2026-10", store)).toEqual({ "0321": 1, "0322": 1 });
  expect(complete({ existing: changed, candidates: [candidate("0321"), candidate("0322"), candidate("0819")] })).toBe(changed);
});

test("manual one-person choice is not automatically filled on refresh, but relocation still removes it", () => {
  const changed = manual({ selectedEmpIds: ["0321"] });
  expect(complete({ existing: changed, candidates: [candidate("0321"), candidate("0322")] })).toBe(changed);
  const relocated = complete({ existing: changed, candidates: [candidate("0322")] });
  expect(relocated.members.map((member) => member.empId)).toEqual(["0322"]);
});

test("manual changes validate required fields, duplicate workers and actual-store eligibility", () => {
  expect(() => manual({ reason: " " })).toThrow("更換原因");
  expect(() => manual({ actor: "" })).toThrow();
  expect(() => manual({ selectedEmpIds: [] })).toThrow();
  expect(() => manual({ selectedEmpIds: ["0321", "0321"] })).toThrow();
  expect(() => manual({ selectedEmpIds: ["A0315"] })).toThrow("當天未在這間門市");
});

test("past-date corrections require an explicit manual action and revision history stays complete", () => {
  const first = manual({ dateKey: "2026-10-09" });
  const second = manual({ existing: first, selectedEmpIds: ["0819"], reason: "再次核對", now: 3000 });
  expect(Object.keys(second.revisions)).toEqual(["rev_1", "rev_2"]);
  expect(second.revisions.rev_2.previousMembers).toEqual(first.members);
  expect(getDailyDutyFingerprint(second)).not.toBe(getDailyDutyFingerprint(first));
});

test("duplicate and differently cased employee IDs cannot fill both slots", () => {
  const result = complete({ candidates: [candidate("a01"), candidate(" A01 "), candidate("B02")] });
  expect(result.memberCount).toBe(2);
  expect(new Set(result.members.map((member) => member.empId.trim().toUpperCase())).size).toBe(2);
  expect(complete({ existing: { empId: "a01", name: "A" }, candidates: [candidate(" A01 ")] }).empId).toBe("a01");
});

test("selects support staff at the actual work store, excluding days off and archived staff", () => {
  const employees = [
    { ...candidate("0819"), store: "西螺文昌店" }, candidate("0321"), candidate("0322"),
    { ...candidate("0802"), archived: true }, candidate("A01"),
  ];
  const schedule = {
    "0819": { working: true, isSupport: true, supportStore: store },
    "0321": { working: true }, "0322": { working: false }, "0802": { working: true },
    "a01": { working: "true", store },
  };
  expect(getDailyDutyCandidates(employees, schedule, store).map((employee) => employee.empId)).toEqual(["0819", "0321", "A01"]);
  expect(getDailyDutyCandidates(employees, schedule, "西螺文昌店")).toEqual([]);
});

test("counts every member only in the correct store and month, excluding the target day", () => {
  const history = {
    "2026-09-30": { [store]: original },
    "2026-10-06": { [store]: { members: [candidate("0819"), candidate("0321")] }, "西螺文昌店": original },
    "2026-10-07": { [store]: original },
  };
  expect(getDailyDutyAssignmentCounts(history, "2026-10", store, "2026-10-07")).toEqual({ "0819": 1, "0321": 1 });
  expect(getDailyDutyMembers(null)).toEqual([]);
});
