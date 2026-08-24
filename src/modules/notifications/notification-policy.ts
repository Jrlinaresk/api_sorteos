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
  if (!preferences.pushEnabled) return false;
  if (preferences.mutedTypes.includes(type)) return false;
  if (type === NotificationType.Promotion && !preferences.marketingEnabled) {
    return false;
  }
  if (TRANSACTIONAL_TYPES.has(type) && !preferences.transactionalEnabled) {
    return false;
  }
  return !isInsideQuietHours(preferences, now);
}
