interface LeaseRecord {
  owner: string;
  expiresAt: number;
}

const LEASE_MS = 120_000;
const ACQUIRE_TIMEOUT_MS = 150_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function ownerId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function readLease(storage: Storage, key: string): LeaseRecord | null {
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null') as LeaseRecord;
    return parsed &&
      typeof parsed.owner === 'string' &&
      Number.isFinite(parsed.expiresAt)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function withStorageLease<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return operation();
  }
  const key = `sorteos:cross-tab-lock:${name}`;
  const owner = ownerId();
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const now = Date.now();
    const current = readLease(storage, key);
    if (!current || current.expiresAt <= now || current.owner === owner) {
      try {
        storage.setItem(
          key,
          JSON.stringify({ owner, expiresAt: now + LEASE_MS }),
        );
      } catch {
        return operation();
      }
      await sleep(20);
      if (readLease(storage, key)?.owner === owner) break;
    }
    await sleep(50 + Math.floor(Math.random() * 50));
  }

  if (readLease(storage, key)?.owner !== owner) {
    throw new Error('No fue posible coordinar la renovación de la sesión.');
  }

  const heartbeat = window.setInterval(() => {
    if (readLease(storage, key)?.owner !== owner) return;
    storage.setItem(
      key,
      JSON.stringify({ owner, expiresAt: Date.now() + LEASE_MS }),
    );
  }, 10_000);
  try {
    return await operation();
  } finally {
    window.clearInterval(heartbeat);
    if (readLease(storage, key)?.owner === owner) storage.removeItem(key);
  }
}

export async function withCrossTabLock<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = navigator.locks;
  if (locks) {
    return locks.request(`sorteos:${name}`, { mode: 'exclusive' }, operation);
  }
  return withStorageLease(name, operation);
}
