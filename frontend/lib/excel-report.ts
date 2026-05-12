"use client";

type ExcelCell = string | number | null | undefined;

type ExcelSection = {
  title: string;
  columns: string[];
  rows: ExcelCell[][];
};

const escapeHtml = (value: ExcelCell) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const buildTable = (section: ExcelSection) => `
  <h2>${escapeHtml(section.title)}</h2>
  <table border="1" cellspacing="0" cellpadding="6">
    <thead>
      <tr>${section.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${section.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")}
    </tbody>
  </table>
`;

export const buildPeriodLabel = ({
  preset,
  dateFrom,
  dateTo,
}: {
  preset: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  if (preset === "custom") {
    return `${dateFrom || "начало"} - ${dateTo || "сегодня"}`;
  }

  const labels: Record<string, string> = {
    day: "сегодня",
    today: "сегодня",
    yesterday: "вчера",
    week: "неделя",
    month: "месяц",
  };

  return labels[preset] ?? preset;
};

export const buildPeriodQuery = ({
  preset,
  dateFrom,
  dateTo,
}: {
  preset: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  if (preset === "custom") {
    return {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };
  }

  return { preset };
};

export function downloadExcelReport(filename: string, sections: ExcelSection[]) {
  const documentHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          h1 { font-size: 18px; }
          h2 { font-size: 15px; margin-top: 24px; }
          th { background: #eef2f7; font-weight: 700; }
          td, th { mso-number-format:"\\@"; }
        </style>
      </head>
      <body>
        ${sections.map(buildTable).join("<br />")}
      </body>
    </html>
  `;
  const blob = new Blob([documentHtml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${filename}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
