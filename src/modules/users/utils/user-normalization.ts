export function normalizePhone(phone: string): string {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');

  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;

  // La plataforma opera en Brasil. Aceptamos el formato nacional para que el
  // checkout web no tenga que pedir el prefijo internacional explícitamente.
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

export function phoneLookupCandidates(phone: string): string[] {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  const normalized = normalizePhone(raw);
  const values = new Set<string>([raw, digits, `+${digits}`, normalized]);

  // Compatibilidad con documentos históricos guardados en formato nacional.
  if (normalized.startsWith('+55')) values.add(normalized.slice(3));
  return [...values].filter(Boolean);
}

export function normalizeEmail(email?: string): string | undefined {
  const normalized = String(email ?? '')
    .trim()
    .toLowerCase();
  return normalized || undefined;
}

export function normalizeCpf(cpf?: string): string | undefined {
  const normalized = String(cpf ?? '').replace(/\D/g, '');
  return normalized || undefined;
}

export function normalizeHumanName(name?: string): string | undefined {
  const normalized = String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized || undefined;
}
