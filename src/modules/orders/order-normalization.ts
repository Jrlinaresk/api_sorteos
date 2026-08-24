export function normalizeOrderEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeOrderPhone(value: string): string {
  return value.replace(/[^+\d]/g, '');
}
