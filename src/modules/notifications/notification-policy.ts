import { NotificationType } from './schemas/notification.schema';

export interface NotificationPreferenceSnapshot {
  pushEnabled: boolean;
  transactionalEnabled: boolean;
  marketingEnabled: boolean;
  mutedTypes: NotificationType[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezoneOffsetMinutes?: number;
}

const TRANSACTIONAL_TYPES = new Set<NotificationType>([
  NotificationType.Order,
  NotificationType.Payment,
  NotificationType.Winner,
  NotificationType.System,
]);

function toMinuteOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isInsideQuietHours(
  preferences: NotificationPreferenceSnapshot,
  now = new Date(),
): boolean {
  if (!preferences.quietHoursStart || !preferences.quietHoursEnd) return false;

  const offset = preferences.timezoneOffsetMinutes ?? 0;
  const local = new Date(now.getTime() + offset * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = toMinuteOfDay(preferences.quietHoursStart);
  const end = toMinuteOfDay(preferences.quietHoursEnd);

  if (start === end) return false;
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

export function canDeliverPush(
  preferences: NotificationPreferenceSnapshot,
  type: NotificationType,
  now = new Date(),
): boolean {
  return (
    canDeliverPushIgnoringQuietHours(preferences, type) &&
    !isInsideQuietHours(preferences, now)
  );
}

/**
 * Evalúa únicamente los bloqueos permanentes de las preferencias. Las horas
 * silenciosas son una demora temporal y nunca deben convertir una entrega en
 * `skipped`.
 */
export function canDeliverPushIgnoringQuietHours(
  preferences: NotificationPreferenceSnapshot,
  type: NotificationType,
): boolean {
  if (!preferences.pushEnabled) return false;
  if (preferences.mutedTypes.includes(type)) return false;
  if (type === NotificationType.Promotion && !preferences.marketingEnabled) {
    return false;
  }
  if (TRANSACTIONAL_TYPES.has(type) && !preferences.transactionalEnabled) {
    return false;
  }
  return true;
}

/** Devuelve el primer instante UTC que queda fuera del intervalo silencioso. */
export function nextAllowedPushAt(
  preferences: NotificationPreferenceSnapshot,
  now = new Date(),
): Date {
  if (!isInsideQuietHours(preferences, now)) return new Date(now);

  const offset = preferences.timezoneOffsetMinutes ?? 0;
  const localNow = new Date(now.getTime() + offset * 60_000);
  const end = toMinuteOfDay(preferences.quietHoursEnd!);
  const endHours = Math.floor(end / 60);
  const endMinutes = end % 60;
  const localEnd = new Date(localNow);
  localEnd.setUTCHours(endHours, endMinutes, 0, 0);
  if (localEnd.getTime() <= localNow.getTime()) {
    localEnd.setUTCDate(localEnd.getUTCDate() + 1);
  }

  return new Date(localEnd.getTime() - offset * 60_000);
}
