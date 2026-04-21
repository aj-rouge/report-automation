import ExcelJS from "exceljs";

export const createWorkbook = () => new ExcelJS.Workbook();

export const addStyledSheet = (workbook, name, columns, options = {}) => {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  const header = sheet.getRow(1);
  header.font = options.headerFont ?? {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  header.fill = options.headerFill ?? {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF366092" },
  };
  header.alignment = options.headerAlignment ?? {
    horizontal: "center",
    vertical: "center",
  };
  if (options.defaultRowHeight)
    sheet.properties.defaultRowHeight = options.defaultRowHeight;
  return sheet;
};

export const styleRows = (sheet, opts = {}) => {
  const evenFill = opts.evenFill ?? {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE7E6E6" },
  };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) row.fill = evenFill;
    row.alignment = opts.rowAlignment ?? {
      horizontal: "left",
      vertical: "center",
    };
  });
};

export const addTable = (sheet, headers, rows, tableOpts = {}) => {
  sheet.addTable({
    name: tableOpts.name ?? "Table1",
    ref: tableOpts.ref ?? "A1",
    headerRow: true,
    totalsRow: !!tableOpts.totalsRow,
    style: tableOpts.style ?? {
      theme: "TableStyleMedium9",
      showRowStripes: true,
    },
    columns: headers.map((h) => ({ name: h })),
    rows,
  });
};
