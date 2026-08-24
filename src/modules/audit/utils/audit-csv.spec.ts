import { auditLogsToCsv, csvCell } from './audit-csv';

describe('audit CSV', () => {
  it('escapa comillas y neutraliza fórmulas', () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
  });

  it('genera CSV UTF-8 con BOM y finales CRLF', () => {
    const csv = auditLogsToCsv([
      {
        createdAt: new Date('2026-08-24T10:00:00.000Z'),
        action: 'settings.publish',
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('settings.publish');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
