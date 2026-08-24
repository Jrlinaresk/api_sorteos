import { NotificationType } from './schemas/notification.schema';
import { canDeliverPush, isInsideQuietHours } from './notification-policy';

const base = {
  pushEnabled: true,
  transactionalEnabled: true,
  marketingEnabled: true,
  mutedTypes: [],
};

describe('notification policy', () => {
  it('respeta la desactivación y los tipos silenciados', () => {
    expect(
      canDeliverPush({ ...base, pushEnabled: false }, NotificationType.Order),
    ).toBe(false);
    expect(
      canDeliverPush(
        { ...base, mutedTypes: [NotificationType.Order] },
        NotificationType.Order,
      ),
    ).toBe(false);
  });

  it('distingue marketing de mensajes transaccionales', () => {
    expect(
      canDeliverPush(
        { ...base, marketingEnabled: false },
        NotificationType.Promotion,
      ),
    ).toBe(false);
    expect(
      canDeliverPush(
        { ...base, marketingEnabled: false },
        NotificationType.Payment,
      ),
    ).toBe(true);
  });

  it('maneja horas silenciosas que atraviesan medianoche', () => {
    const preferences = {
      ...base,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timezoneOffsetMinutes: -180,
    };

    expect(
      isInsideQuietHours(preferences, new Date('2026-08-25T02:00:00.000Z')),
    ).toBe(true); // 23:00 en UTC-3
    expect(
      isInsideQuietHours(preferences, new Date('2026-08-25T15:00:00.000Z')),
    ).toBe(false); // 12:00 en UTC-3
  });
});
