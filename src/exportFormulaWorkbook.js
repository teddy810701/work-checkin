import ExcelJS from "exceljs";

const COLORS = {
  header: "FFD9EAD3",
  label: "FFEEF2FF",
  total: "FFFFF2CC",
  corrected: "FFFFFF00",
  rounded: "FFDDEBF7",
  breakCorrected: "FFE2F0D9",
  exception: "FFF4CCCC",
  support: "FFDBEAFE",
};

const thinBorder = {
  top: { style: "thin", color: { argb: "FF999999" } },
  left: { style: "thin", color: { argb: "FF999999" } },
  bottom: { style: "thin", color: { argb: "FF999999" } },
  right: { style: "thin", color: { argb: "FF999999" } },
};

const minutesBetween = (start, end) => {
  if (!start || !end || end <= start) return 0;
  return Math.round((end - start) / 60000);
};

const firstOfType = (records, type) => records
  .filter((item) => item.type === type)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null;

const lastOfType = (records, type) => records
  .filter((item) => item.type === type)
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;

const timeFraction = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return (date.getHours() * 60 + date.getMinutes()) / 1440;
};

const formatTime = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const scheduleTimestamp = (dateKey, time) => {
  if (!dateKey || !time) return null;
  const timestamp = new Date(`${dateKey}T${time}:00+08:00`).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const roundToQuarterHour = (timestamp) => {
  if (!timestamp) return null;
  return Math.round(timestamp / (15 * 60000)) * 15 * 60000;
};

const floorToMinute = (timestamp) => {
  if (!timestamp) return null;
  return Math.floor(timestamp / 60000) * 60000;
};

const columnLetter = (number) => {
  let value = number;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

const styleCell = (cell, fill) => {
  cell.border = thinBorder;
  cell.alignment = { horizontal: "center", vertical: "middle" };
  if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
};

const addLogSheet = (workbook, name, headers, rows, fill) => {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).eachCell((cell) => styleCell(cell, fill));
  rows.forEach((values) => {
    const row = sheet.addRow(values);
    row.eachCell((cell) => styleCell(cell));
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } };
  sheet.columns = headers.map((header, index) => ({
    header,
    width: index === 0 ? 14 : index === 1 ? 12 : 18,
  }));
};

export const buildFormulaWorkbook = ({ employees, records, schedulesByDate, days }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "work-checkin";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const employeeMap = {};
  employees.forEach((employee) => {
    const key = employee.empId || employee.id;
    employeeMap[key] = { empId: key, name: employee.name || key, role: employee.role || "", store: employee.store || "" };
  });
  records.forEach((record) => {
    const key = record.empId || record.id || "UNKNOWN";
    if (!employeeMap[key]) employeeMap[key] = { empId: key, name: record.name || key, role: record.role || "", store: record.store || "" };
  });

  const byEmployeeDate = {};
  records.forEach((record) => {
    const dateKey = record.dateKey || "";
    const key = `${record.empId || record.id || "UNKNOWN"}__${dateKey}`;
    if (!byEmployeeDate[key]) byEmployeeDate[key] = [];
    byEmployeeDate[key].push(record);
  });

  const workInCorrections = [];
  const workOutRounds = [];
  const breakCorrections = [];
  const breakExceptions = [];
  const lateRecords = [];
  const main = workbook.addWorksheet("薪資核對", { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
  main.addRow(["姓名", "身分", "項目", ...days.map((day) => day.label), "總工時"]);
  main.getRow(1).font = { bold: true };
  main.getRow(1).eachCell((cell) => styleCell(cell, COLORS.header));
  main.getColumn(1).width = 14;
  main.getColumn(2).width = 12;
  main.getColumn(3).width = 11;
  days.forEach((_, index) => { main.getColumn(index + 4).width = 10; });
  main.getColumn(days.length + 4).width = 12;

  const employeeList = Object.values(employeeMap).sort((a, b) =>
    String(a.store).localeCompare(String(b.store), "zh-Hant") || String(a.name).localeCompare(String(b.name), "zh-Hant")
  );

  employeeList.forEach((employee) => {
    const startRow = main.rowCount + 1;
    ["上班", "休息", "休息結束", "下班", "工時"].forEach((label, offset) => {
      const row = main.addRow([offset === 0 ? employee.name : "", offset === 0 ? employee.role : "", label]);
      row.eachCell((cell) => styleCell(cell));
      styleCell(row.getCell(3), COLORS.label);
      if (offset === 0) {
        row.getCell(1).font = { bold: true };
        row.getCell(2).font = { bold: true };
      }
    });
    main.addRow([]);

    days.forEach((day, dayIndex) => {
      const column = dayIndex + 4;
      const columnName = columnLetter(column);
      const dayRecords = (byEmployeeDate[`${employee.empId}__${day.dateKey}`] || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const schedule = schedulesByDate?.[day.dateKey]?.[employee.empId] || null;
      const supportFill = schedule?.isSupport || dayRecords.some((item) => item?.isSupport) ? COLORS.support : null;
      const workIn = firstOfType(dayRecords, "上班");
      const breakStart = firstOfType(dayRecords, "休息開始");
      const breakEnd = firstOfType(dayRecords, "休息結束");
      const workOut = lastOfType(dayRecords, "下班");
      const cells = [0, 1, 2, 3, 4].map((offset) => main.getRow(startRow + offset).getCell(column));
      cells.forEach((cell) => styleCell(cell, supportFill));

      if (!dayRecords.length) {
        cells[0].value = "休假";
        return;
      }

      const scheduledStart = schedule?.working ? scheduleTimestamp(day.dateKey, schedule.startTime) : null;
      const scheduledStartMinute = floorToMinute(scheduledStart);
      const actualWorkInMinute = floorToMinute(workIn?.createdAt);
      let correctedWorkIn = workIn?.createdAt || null;
      if (workIn && scheduledStartMinute && actualWorkInMinute < scheduledStartMinute) {
        correctedWorkIn = scheduledStart;
        workInCorrections.push([employee.name, day.dateKey, formatTime(workIn.createdAt), formatTime(scheduledStart), "早到依班表時間計薪"]);
        styleCell(cells[0], COLORS.corrected);
      } else if (workIn && scheduledStartMinute && actualWorkInMinute > scheduledStartMinute) {
        lateRecords.push([employee.name, day.dateKey, formatTime(scheduledStart), formatTime(workIn.createdAt), minutesBetween(scheduledStartMinute, actualWorkInMinute)]);
        styleCell(cells[0], COLORS.exception);
      }

      let correctedWorkOut = workOut?.createdAt || null;
      if (workOut) {
        correctedWorkOut = roundToQuarterHour(workOut.createdAt);
        if (correctedWorkOut !== workOut.createdAt) {
          workOutRounds.push([employee.name, day.dateKey, formatTime(workOut.createdAt), formatTime(correctedWorkOut), "四捨五入至最近15分鐘"]);
          styleCell(cells[3], COLORS.rounded);
        }
      }

      let correctedBreakEnd = breakEnd?.createdAt || null;
      if (breakStart && breakEnd) {
        const breakMinutes = minutesBetween(breakStart.createdAt, breakEnd.createdAt);
        if (breakMinutes <= 35 && breakMinutes !== 30) {
          correctedBreakEnd = breakStart.createdAt + 30 * 60000;
          breakCorrections.push([employee.name, day.dateKey, breakMinutes, 30, `${formatTime(breakStart.createdAt)}–${formatTime(correctedBreakEnd)}`]);
          styleCell(cells[1], COLORS.breakCorrected);
          styleCell(cells[2], COLORS.breakCorrected);
        } else if (breakMinutes > 35) {
          breakExceptions.push([employee.name, day.dateKey, formatTime(breakStart.createdAt), formatTime(breakEnd.createdAt), breakMinutes]);
          styleCell(cells[1], COLORS.exception);
          styleCell(cells[2], COLORS.exception);
        }
      }

      const timeValues = [correctedWorkIn, breakStart?.createdAt || null, correctedBreakEnd, correctedWorkOut];
      timeValues.forEach((timestamp, index) => {
        cells[index].value = timestamp ? timeFraction(timestamp) : "未打卡";
        if (timestamp) cells[index].numFmt = "hh:mm";
        else styleCell(cells[index], COLORS.exception);
      });
      const formula = `IF(OR(${columnName}${startRow}="未打卡",${columnName}${startRow + 3}="未打卡"),"",ROUND(((${columnName}${startRow + 3}-${columnName}${startRow})-IF(OR(${columnName}${startRow + 1}="未打卡",${columnName}${startRow + 2}="未打卡"),0,${columnName}${startRow + 2}-${columnName}${startRow + 1}))*24,2))`;
      cells[4].value = { formula };
      cells[4].numFmt = "0.00";
    });

    const totalCell = main.getRow(startRow + 4).getCell(days.length + 4);
    totalCell.value = { formula: `SUM(D${startRow + 4}:${columnLetter(days.length + 3)}${startRow + 4})` };
    totalCell.numFmt = "0.00";
    totalCell.font = { bold: true };
    styleCell(totalCell, COLORS.total);
  });

  main.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: days.length + 4 } };
  addLogSheet(workbook, "上班校正紀錄", ["姓名", "日期", "實際上班", "計薪上班", "原因"], workInCorrections, COLORS.corrected);
  addLogSheet(workbook, "下班捨入紀錄", ["姓名", "日期", "實際下班", "計薪下班", "規則"], workOutRounds, COLORS.rounded);
  addLogSheet(workbook, "休息時間校正紀錄", ["姓名", "日期", "原休息分鐘", "校正分鐘", "校正後時段"], breakCorrections, COLORS.breakCorrected);
  addLogSheet(workbook, "休息異常紀錄（超過35分鐘）", ["姓名", "日期", "休息開始", "休息結束", "休息分鐘"], breakExceptions, COLORS.exception);
  addLogSheet(workbook, "遲到紀錄", ["姓名", "日期", "班表上班", "實際上班", "遲到分鐘"], lateRecords, COLORS.exception);

  return workbook;
};

export const exportFormulaWorkbook = async (options) => {
  const workbook = buildFormulaWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `薪資核對版-${options.monthKey}-公式版.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
};
