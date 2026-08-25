const REDACTED = '[REDACTED]';
const MAX_DEPTH = 4;
const MAX_KEYS = 30;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 500;

const SENSITIVE_KEY_PATTERN =
  /(password|passwordhash|secret|token|authorization|cookie|code|cvv|pin|privatekey|apikey|pixcopy|pixpayload|phone|email|cpf|address|buyer|payer|taxid|documentnumber|fullname|firstname|middlename|lastname|secondlastname)/i;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    ['name', 'search', 'q', 'filter'].includes(normalized) ||
    SENSITIVE_KEY_PATTERN.test(key)
  );
}

export function summarizeAuditValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => summarizeAuditValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      result.push(`[+${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return result;
  }

  const entries = Object.entries(value).slice(0, MAX_KEYS);
  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    result[key] = isSensitiveKey(key)
      ? REDACTED
      : summarizeAuditValue(entryValue, depth + 1, seen);
  }
  const totalKeys = Object.keys(value).length;
  if (totalKeys > MAX_KEYS) result._truncatedKeys = totalKeys - MAX_KEYS;
  return result;
}

export function sanitizeAuditText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.slice(0, maximumLength);
}
