const CSV_COLUMNS = [
  'createdAt',
  'correlationId',
  'category',
  'action',
  'outcome',
  'actorId',
  'actorRole',
  'ip',
  'userAgent',
  'resourceType',
  'resourceId',
  'before',
  'after',
  'metadata',
  'errorCode',
  'errorMessage',
] as const;

function protectSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: unknown): string {
  let text = '';
  if (value instanceof Date) text = value.toISOString();
  else if (value && typeof value === 'object') text = JSON.stringify(value);
  else if (value !== undefined && value !== null) text = String(value);
  text = protectSpreadsheetFormula(text);
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditLogsToCsv(rows: Array<Record<string, unknown>>): string {
  const header = CSV_COLUMNS.map(csvCell).join(',');
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((column) => csvCell(row[column])).join(','),
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}
