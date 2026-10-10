const employeeKey = (value) => String(value || "").trim().toUpperCase();

export const getDailyDutyMembers = (assignment) => {
  if (Array.isArray(assignment?.members)) return assignment.members.filter(Boolean);
  if (assignment?.members && typeof assignment.members === "object") return Object.values(assignment.members).filter(Boolean);
  return assignment?.empId ? [assignment] : [];
};

export const getDailyDutyCandidates = (employees = [], scheduleData = {}, targetStore = "") => {
  const scheduleByEmployee = {};
  Object.entries(scheduleData || {}).forEach(([key, item]) => {
    scheduleByEmployee[employeeKey(item?.empId || key)] = item || {};
  });
  const seen = new Set();
  return employees.map((employee) => {
    const empId = employeeKey(employee.empId || employee.id);
    const schedule = scheduleByEmployee[empId];
    if (!empId || seen.has(empId) || employee.archived || ![true, "true"].includes(schedule?.working)) return null;
    const workStore = schedule.isSupport && schedule.supportStore
      ? schedule.supportStore
      : schedule.store || employee.store || "";
    if (workStore !== targetStore) return null;
    seen.add(empId);
    return { empId, name: employee.name || empId, store: targetStore, role: employee.role || "" };
  }).filter(Boolean);
};

export const getDailyDutyAssignmentCounts = (history = {}, monthKey, storeKey, excludeDateKey = "") => {
  const counts = {};
  Object.entries(history || {}).forEach(([dateKey, dayData]) => {
    if (dateKey === excludeDateKey || !String(dateKey).startsWith(`${monthKey}-`)) return;
    getDailyDutyMembers(dayData?.[storeKey]).forEach((member) => {
      const empId = employeeKey(member?.empId);
      if (empId) counts[empId] = (counts[empId] || 0) + 1;
    });
  });
  return counts;
};

const tieScore = (dateKey, store, empId) => (
  [...`${dateKey}|${store}|${empId}`].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) % 1000003, 7)
);

export const getDailyDutyFingerprint = (assignment) => JSON.stringify([
  assignment?.revision || 0, assignment?.updatedAt || 0,
  getDailyDutyMembers(assignment).map((member) => employeeKey(member.empId)),
]);

const withDutyRevision = (existing, next, { now, type, reason, actor }) => {
  if (!existing) return next;
  const revision = (Number(existing.revision) || 0) + 1;
  return {
    ...next, revision,
    revisions: {
      ...existing.revisions,
      [`rev_${revision}`]: {
        at: now, type, reason, actor,
        previousMembers: getDailyDutyMembers(existing), nextMembers: next.members,
        previousSource: existing.source || "", previousUpdatedAt: existing.updatedAt || 0,
      },
    },
  };
};

const assignmentWithMembers = (existing, members, { dateKey, store, storeId, counts = {}, now, source }) => {
  const primary = members[0];
  return {
    ...existing, dateKey, store, storeId: existing?.storeId || storeId,
    // Empty lists must clear legacy fields, otherwise older readers resurrect a moved employee.
    empId: primary?.empId || "", name: primary?.name || primary?.empId || "", role: primary?.role || "",
    assignmentCountBefore: primary?.assignmentCountBefore ?? counts[employeeKey(primary?.empId)] ?? 0,
    members, memberCount: members.length, source,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
};

// Preserve eligible members; replace only people no longer scheduled at this store.
// Unchanged lists return the original object, avoiding writes on every refresh.
export const completeDailyDutyAssignment = ({
  existing = null, candidates = [], counts = {}, yesterdayMembers = [],
  dateKey, store, storeId = "", memberLimit = 2, now = Date.now(),
}) => {
  const previousMembers = getDailyDutyMembers(existing);
  const eligibleIds = new Set(candidates.map((candidate) => employeeKey(candidate.empId)));
  const retainedIds = new Set();
  const members = previousMembers.filter((member) => {
    const key = employeeKey(member.empId);
    if (!eligibleIds.has(key) || retainedIds.has(key)) return false;
    retainedIds.add(key);
    return true;
  }).slice(0, memberLimit);
  const removedMember = members.length !== previousMembers.length;
  if (!removedMember && (members.length >= memberLimit || existing?.manualSelection)) return existing;
  const assigned = new Set(members.map((member) => employeeKey(member.empId)));
  const yesterdayIds = new Set(yesterdayMembers.map((member) => employeeKey(member.empId)));
  const uniqueCandidates = candidates.filter((candidate) => {
    const key = employeeKey(candidate.empId);
    if (!key || assigned.has(key)) return false;
    assigned.add(key);
    return true;
  });
  const targetCount = Math.min(memberLimit, members.length + uniqueCandidates.length);
  if (targetCount === members.length && !removedMember) return existing;

  for (let slot = members.length; slot < targetCount; slot += 1) {
    const remaining = uniqueCandidates.filter((candidate) => !members.some((member) => employeeKey(member.empId) === employeeKey(candidate.empId)));
    const nonYesterday = remaining.filter((candidate) => !yesterdayIds.has(employeeKey(candidate.empId)));
    const pool = nonYesterday.length >= targetCount - slot ? nonYesterday : remaining;
    const selected = [...pool].sort((a, b) => (
      (counts[employeeKey(a.empId)] || 0) - (counts[employeeKey(b.empId)] || 0)
      || tieScore(`${dateKey}-${slot}`, store, employeeKey(a.empId)) - tieScore(`${dateKey}-${slot}`, store, employeeKey(b.empId))
      || employeeKey(a.empId).localeCompare(employeeKey(b.empId))
    ))[0];
    members.push({ ...selected, assignmentCountBefore: counts[employeeKey(selected.empId)] || 0 });
  }

  const next = assignmentWithMembers(existing, members, {
    dateKey, store, storeId, counts, now, source: existing?.source || "auto_monthly_balanced",
  });
  return withDutyRevision(existing, next, {
    now, type: "schedule_reconcile", actor: "system",
    reason: removedMember ? "班表或門市異動，移除不符合資格的人員並補足名額" : "補足值日生名額",
  });
};

// Explicit correction, including past dates. No punches or schedule entries are changed.
export const createManualDailyDutyAssignment = ({
  existing = null, selectedEmpIds = [], candidates = [], counts = {},
  dateKey, store, storeId = "", reason = "", actor = "", now = Date.now(),
}) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || "") || !store || !actor || !reason.trim()) {
    throw new Error("請填寫日期、門市及更換原因");
  }
  const ids = selectedEmpIds.filter(Boolean).map(employeeKey);
  if (!ids.length || ids.length > 2 || new Set(ids).size !== ids.length) throw new Error("請選擇 1 至 2 位不同的值日生");
  const members = ids.map((id) => {
    const candidate = candidates.find((item) => employeeKey(item.empId) === id);
    if (!candidate) throw new Error("所選人員當天未在這間門市上班，請重新選擇");
    return { ...candidate, empId: id, assignmentCountBefore: counts[id] || 0 };
  });
  const next = {
    ...assignmentWithMembers(existing, members, { dateKey, store, storeId, counts, now, source: "manual" }),
    manualSelection: true, manualReason: reason.trim(), updatedBy: actor,
  };
  // The first manual assignment also records who chose it and why.
  return withDutyRevision(existing || { members: [] }, next, {
    now, type: "manual", reason: reason.trim(), actor,
  });
};
