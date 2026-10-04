import test from "node:test";
import assert from "node:assert/strict";
import { calculateMealAccount, getMealAccountMonths } from "../src/mealAccount.js";

const employee = "0531";
const punches = (dateKey, hours, empId = employee) => {
  const start = new Date(`${dateKey}T05:00:00+08:00`).getTime();
  return [
    { empId, dateKey, type: "上班", createdAt: start },
    { empId, dateKey, type: "下班", createdAt: start + hours * 3_600_000 },
  ];
};
const account = (options = {}) => calculateMealAccount({ empId: employee, monthKey: "2026-10", ...options });

test("九月實際補助 1200 元會覆蓋 9/19 餐費紀錄的錯誤零補助，不再提醒欠 90 元", () => {
  const dates = ["02", "03", "04", "05", "06", "11", "19", "20", "25", "26", "27", "28"];
  const amounts = [105, 125, 110, 20, 110, 85, 20, 120, 120, 70, 70, 245];
  const mealRecords = Object.fromEntries(dates.map((day, index) => {
    const dateKey = `2026-09-${day}`;
    return [`${dateKey}_${employee}`, { empId: employee, dateKey, mealAmount: amounts[index],
      workHours: day === "19" ? 0.02 : 7, baseSubsidyAmount: day === "19" ? 0 : 100 }];
  }));
  const result = account({ mealRecords, records: dates.flatMap((day) => punches(`2026-09-${day}`, day === "19" ? 9.33 : 7)) });
  assert.deepEqual(result.monthlyTotals["2026-09"], { totalMeal: 1200, totalSubsidy: 1200 });
  assert.deepEqual(result.previousDebts, []);
});

test("有上班但沒有餐費紀錄的日期仍累積當月補助", () => {
  const result = account({
    mealRecords: { meal: { empId: employee, dateKey: "2026-09-02", mealAmount: 180, baseSubsidyAmount: 100 } },
    records: [...punches("2026-09-01", 7), ...punches("2026-09-02", 7)],
  });
  assert.deepEqual(result.monthlyTotals["2026-09"], { totalMeal: 180, totalSubsidy: 200 });
  assert.deepEqual(result.previousDebts, []);
});

test("休息時間扣除後未滿六小時，應只補助 60 元", () => {
  const records = punches("2026-09-02", 6.4);
  const start = records[0].createdAt;
  records.push(
    { empId: employee, dateKey: "2026-09-02", type: "休息開始", createdAt: start + 3 * 3_600_000 },
    { empId: employee, dateKey: "2026-09-02", type: "休息結束", createdAt: start + 3.5 * 3_600_000 },
  );
  const result = account({ records, mealRecords: { meal: { empId: employee, dateKey: "2026-09-02", mealAmount: 100, baseSubsidyAmount: 100 } } });
  assert.deepEqual(result.previousDebts, [{ monthKey: "2026-09", amount: 36 }]);
});

test("六小時邊界不會因四捨五入而提前取得 100 元補助", () => {
  const result = account({ records: punches("2026-09-02", 5.999), mealRecords: { meal: { empId: employee, dateKey: "2026-09-02", mealAmount: 100 } } });
  assert.deepEqual(result.previousDebts, [{ monthKey: "2026-09", amount: 36 }]);
});

test("原始打卡封存後優先使用月結快照，補助倍率只套用一次", () => {
  const result = account({
    mealRecords: { meal: { empId: employee, dateKey: "2026-09-02", mealAmount: 100, baseSubsidyAmount: 0 } },
    attendanceSnapshots: { "2026-09": { days: { day: { empId: employee, dateKey: "2026-09-02", recordCount: 4, canCalculate: true, workHours: 7, subsidyAmount: 100 } } } },
    adjustments: { "2026-09": { [employee]: { multiplier: 0.5 } } },
  });
  assert.deepEqual(result.monthlyTotals["2026-09"], { totalMeal: 100, totalSubsidy: 50 });
  assert.deepEqual(result.previousDebts, [{ monthKey: "2026-09", amount: 45 }]);
});

test("同一天的打卡、快照與餐費不會重複計入補助", () => {
  const result = account({
    records: punches("2026-09-02", 5),
    mealRecords: { meal: { empId: employee, dateKey: "2026-09-02", mealAmount: 100, baseSubsidyAmount: 100 } },
    attendanceSnapshots: { "2026-09": { days: { day: { empId: employee, dateKey: "2026-09-02", recordCount: 4, canCalculate: true, subsidyAmount: 100 } } } },
  });
  assert.equal(result.monthlyTotals["2026-09"].totalSubsidy, 60);
});

test("沒有原始打卡或月結快照時保留既有餐費補助", () => {
  const result = account({
    mealRecords: { meal: { empId: employee, dateKey: "2026-09-02", mealAmount: 100, baseSubsidyAmount: 100, calculatedSubsidyAmount: 50 } },
    adjustments: { "2026-09": { [employee]: { multiplier: 0.5 } } },
  });
  assert.deepEqual(result.previousDebts, [{ monthKey: "2026-09", amount: 45 }]);
});

test("待審核或未通過的餐費仍計入餐費，補助通過後才計入", () => {
  for (const approvalStatus of [undefined, "pending", "rejected", "approved"]) {
    const result = account({
      records: punches("2026-09-02", 7),
      mealRecords: { meal: { empId: employee, dateKey: "2026-09-02", mealAmount: 100, approvalRequired: true, approvalStatus } },
    });
    assert.deepEqual(result.previousDebts, approvalStatus === "approved" ? [] : [{ monthKey: "2026-09", amount: 90 }]);
  }
});

test("已收款月份不提醒，未收款月份保留，且不跨月抵扣", () => {
  const result = account({
    records: [...punches("2026-09-02", 7), ...punches("2026-08-02", 7), ...punches("2026-10-02", 7)],
    mealRecords: {
      august: { empId: employee, dateKey: "2026-08-02", mealAmount: 200 },
      september: { empId: employee, dateKey: "2026-09-02", mealAmount: 150 },
      october: { empId: employee, dateKey: "2026-10-02", mealAmount: 0 },
      payments: { [`2026-08_${employee}`]: { paid: true } },
    },
  });
  assert.deepEqual(result.previousDebts, [{ monthKey: "2026-09", amount: 45 }]);
  assert.equal(result.outstanding, 0);
});

test("金額會整月加總後才打九折並取整數", () => {
  const result = account({ mealRecords: {
    one: { empId: employee, dateKey: "2026-10-01", mealAmount: 1, baseSubsidyAmount: 0 },
    two: { empId: employee, dateKey: "2026-10-02", mealAmount: 1, baseSubsidyAmount: 0 },
    three: { empId: employee, dateKey: "2026-10-03", mealAmount: 1, baseSubsidyAmount: 0 },
    four: { empId: employee, dateKey: "2026-10-04", mealAmount: 1, baseSubsidyAmount: 0 },
    five: { empId: employee, dateKey: "2026-10-05", mealAmount: 1, baseSubsidyAmount: 0 },
  } });
  assert.equal(result.outstanding, 5);
});

test("只計算該員工及有效結算月份，資料讀取範圍包含打卡但沒有餐費的月份", () => {
  const mealRecords = {
    other: { empId: "9999", dateKey: "2026-09-01", mealAmount: 1000 },
    old: { empId: employee, dateKey: "2026-05-01", mealAmount: 1000 },
    future: { empId: employee, dateKey: "2026-11-01", mealAmount: 1000 },
    september: { empId: employee, dateKey: "2026-09-02", mealAmount: 100, workHours: 7 },
    payments: { somePayment: { paid: true } },
  };
  const records = punches("2026-08-02", 7);
  assert.deepEqual(getMealAccountMonths({ empId: employee, monthKey: "2026-10", mealRecords, records }), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(account({ mealRecords, records }).previousDebts, []);
});

test("舊打卡沒有 dateKey 時仍以台灣日期歸入正確月份", () => {
  const records = punches("2026-09-01", 7).map(({ dateKey, ...item }) => item);
  assert.equal(account({ records }).monthlyTotals["2026-09"].totalSubsidy, 100);
});
