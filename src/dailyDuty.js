const employeeKey = (value) => String(value || "").trim().toUpperCase();

export const getDailyDutyMembers = (assignment) => {
  if (Array.isArray(assignment?.members) && assignment.members.length) return assignment.members.filter(Boolean);
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

// Already assigned people stay in place. Only vacant slots may be filled.
// Returning the original object means no write is needed (including timestamps).
export const completeDailyDutyAssignment = ({
  existing = null, candidates = [], counts = {}, yesterdayMembers = [],
  dateKey, store, storeId = "", memberLimit = 2, now = Date.now(),
}) => {
  const members = [...getDailyDutyMembers(existing)];
  if (members.length >= memberLimit) return existing;
  const assigned = new Set(members.map((member) => employeeKey(member.empId)));
  const yesterdayIds = new Set(yesterdayMembers.map((member) => employeeKey(member.empId)));
  const uniqueCandidates = candidates.filter((candidate) => {
    const key = employeeKey(candidate.empId);
    if (!key || assigned.has(key)) return false;
    assigned.add(key);
    return true;
  });
  const targetCount = Math.min(memberLimit, members.length + uniqueCandidates.length);
  if (targetCount === members.length) return existing;

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

  const primary = members[0];
  return {
    ...existing,
    dateKey, store, storeId: existing?.storeId || storeId,
    // Keep these legacy fields for older clients; members contains the full list.
    empId: primary.empId, name: primary.name || primary.empId, role: primary.role || "",
    assignmentCountBefore: primary.assignmentCountBefore ?? counts[employeeKey(primary.empId)] ?? 0,
    members, memberCount: members.length,
    source: existing?.source || "auto_monthly_balanced",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
};
