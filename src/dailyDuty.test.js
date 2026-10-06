import { completeDailyDutyAssignment, getDailyDutyCandidates, getDailyDutyMembers, getDailyDutyAssignmentCounts } from "./dailyDuty";

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

test("refreshes and later schedule changes never reshuffle a full list", () => {
  const filled = complete({ existing: original, candidates: [candidate("0321")] });
  expect(complete({ existing: filled, candidates: [candidate("0213"), candidate("0802")], now: 9999 })).toBe(filled);
});

test("a transaction retry preserves a concurrently filled list", () => {
  const concurrent = { ...original, members: [original.members[0], candidate("0802")], memberCount: 2, updatedAt: 1500 };
  expect(complete({ existing: concurrent, candidates: [candidate("0321")] })).toBe(concurrent);
});

test("a one-person schedule stays valid and fills when another worker is added", () => {
  const first = complete({ candidates: [candidate("0819")] });
  expect(first.memberCount).toBe(1);
  expect(complete({ existing: first, candidates: [candidate("0819")] })).toBe(first);
  const later = complete({ existing: first, candidates: [candidate("0819"), candidate("0321")] });
  expect(later.members.map((member) => member.empId)).toEqual(["0819", "0321"]);
});

test("no workers never produces a placeholder duty or erases an existing member", () => {
  expect(complete()).toBeNull();
  expect(complete({ existing: original })).toBe(original);
});

test("legacy single-person records and object-shaped members are preserved when filled", () => {
  const legacy = { empId: "0819", name: "原值日生", createdAt: 1000 };
  const result = complete({ existing: legacy, candidates: [candidate("0321")] });
  expect(result.members[0]).toEqual(legacy);
  expect(result.memberCount).toBe(2);
  const objectMembers = { ...original, members: { first: original.members[0] } };
  expect(complete({ existing: objectMembers, candidates: [candidate("0321")] }).members).toHaveLength(2);
});

test("monthly balancing and avoiding yesterday's duty still apply to the new slot", () => {
  const result = complete({ existing: original, candidates: [candidate("0321"), candidate("0322")], counts: { "0321": 0, "0322": 2 }, yesterdayMembers: [candidate("0321")] });
  expect(result.members[1].empId).toBe("0322");
  const fallback = complete({ existing: original, candidates: [candidate("0321")], yesterdayMembers: [candidate("0321")] });
  expect(fallback.members[1].empId).toBe("0321");
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
