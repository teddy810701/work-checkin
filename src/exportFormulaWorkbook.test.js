import { buildFormulaWorkbook } from "./exportFormulaWorkbook";

test("creates six formula worksheets and applies correction rules", async () => {
  const workbook = buildFormulaWorkbook({
    employees: [{ empId: "001", name: "測試員工", role: "正職", store: "西螺文昌店" }],
    days: [{ day: 1, dateKey: "2026-08-01", label: "08/01" }],
    schedulesByDate: {
      "2026-08-01": { "001": { working: true, startTime: "06:00" } },
    },
    records: [
      { empId: "001", dateKey: "2026-08-01", type: "上班", createdAt: new Date("2026-08-01T05:50:00+08:00").getTime() },
      { empId: "001", dateKey: "2026-08-01", type: "休息開始", createdAt: new Date("2026-08-01T09:00:00+08:00").getTime() },
      { empId: "001", dateKey: "2026-08-01", type: "休息結束", createdAt: new Date("2026-08-01T09:32:00+08:00").getTime() },
      { empId: "001", dateKey: "2026-08-01", type: "下班", createdAt: new Date("2026-08-01T14:07:00+08:00").getTime() },
    ],
  });

  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "薪資核對",
    "上班校正紀錄",
    "下班捨入紀錄",
    "休息時間校正紀錄",
    "休息異常紀錄（超過35分鐘）",
    "遲到紀錄",
  ]);
  expect(workbook.getWorksheet("薪資核對").getCell("D6").value.formula).toContain("ROUND");
  expect(workbook.getWorksheet("上班校正紀錄").rowCount).toBe(2);
  expect(workbook.getWorksheet("下班捨入紀錄").rowCount).toBe(2);
  expect(workbook.getWorksheet("休息時間校正紀錄").rowCount).toBe(2);
  const bytes = await workbook.xlsx.writeBuffer();
  expect(bytes.byteLength).toBeGreaterThan(1000);
});
