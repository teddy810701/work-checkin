import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyArchive, calculateArchivedWorkDay } from "../src/monthlyArchive.js";

test("封存日工時會扣除休息並計算補助", () => {
  const base = new Date("2026-07-01T00:00:00+08:00").getTime();
  assert.deepEqual(calculateArchivedWorkDay([
    { type: "上班", createdAt: base },
    { type: "休息開始", createdAt: base + 3 * 3_600_000 },
    { type: "休息結束", createdAt: base + 3.5 * 3_600_000 },
    { type: "下班", createdAt: base + 8 * 3_600_000 },
  ]), {
    canCalculate: true,
    workInAt: base,
    workOutAt: base + 8 * 3_600_000,
    breakHours: 0.5,
    workHours: 7.5,
    subsidyAmount: 100,
    recordCount: 4,
    status: "complete",
  });
});

test("月結封存保留原始紀錄、班表及每日快照", () => {
  const base = new Date("2026-07-02T05:00:00+08:00").getTime();
  const result = buildMonthlyArchive({
    monthKey: "2026-07",
    archivedAt: 123456,
    recordsById: {
      in1: { dateKey: "2026-07-02", empId: "0205", name: "林晏資", store: "西螺文昌店", type: "上班", createdAt: base },
      out1: { dateKey: "2026-07-02", empId: "0205", name: "林晏資", store: "西螺文昌店", type: "下班", createdAt: base + 7 * 3_600_000 },
      other: { dateKey: "2026-08-01", empId: "0205", type: "上班", createdAt: base },
    },
    schedules: {
      "2026-07-02": { "0205": { startTime: "05:00", endTime: "14:00" } },
      "2026-08-01": { "0205": { startTime: "05:00", endTime: "14:00" } },
    },
  });

  assert.deepEqual(Object.keys(result.rawRecords), ["in1", "out1"]);
  assert.deepEqual(Object.keys(result.schedules), ["2026-07-02"]);
  assert.equal(result.days["2026-07-02_0205"].subsidyAmount, 100);
  assert.deepEqual({
    sourceRecordCount: result.manifest.sourceRecordCount,
    snapshotDayCount: result.manifest.snapshotDayCount,
    employeeCount: result.manifest.employeeCount,
    incompleteDayCount: result.manifest.incompleteDayCount,
    subsidyTotal: result.manifest.subsidyTotal,
    scheduleDayCount: result.manifest.scheduleDayCount,
  }, {
    sourceRecordCount: 2,
    snapshotDayCount: 1,
    employeeCount: 1,
    incompleteDayCount: 0,
    subsidyTotal: 100,
    scheduleDayCount: 1,
  });
});
