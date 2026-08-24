import { createECDH, randomBytes } from 'node:crypto';
import { PushProviderKind } from '../schemas/push-subscription.schema';
import {
  InvalidWebPushSubscriptionError,
  validateWebPushSubscription,
} from './web-push-subscription';

describe('Web Push subscription validation', () => {
  const browserCurve = createECDH('prime256v1');
  browserCurve.generateKeys();
  const credentials = {
    p256dh: browserCurve.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };

  it('accepts a browser subscription from an allowed push service', () => {
    expect(
      validateWebPushSubscription({
        provider: PushProviderKind.WebPush,
        address: 'https://fcm.googleapis.com/fcm/send/opaque-token',
        credentials,
      }),
    ).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/opaque-token',
      keys: credentials,
    });
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/token',
    'https://127.0.0.1/internal',
    'https://push-attacker.example/internal',
    'https://user:password@fcm.googleapis.com/fcm/send/token',
  ])('rejects unsafe endpoint %s', (address) => {
    expect(() =>
      validateWebPushSubscription({
        provider: PushProviderKind.WebPush,
        address,
        credentials,
      }),
    ).toThrow(InvalidWebPushSubscriptionError);
  });

  it('rejects missing, extra or malformed browser keys', () => {
    expect(() =>
      validateWebPushSubscription({
        provider: PushProviderKind.WebPush,
        address: 'https://fcm.googleapis.com/fcm/send/token',
        credentials: { ...credentials, privateKey: 'must-not-be-stored' },
      }),
    ).toThrow('sólo p256dh y auth');
    expect(() =>
      validateWebPushSubscription({
        provider: PushProviderKind.WebPush,
        address: 'https://fcm.googleapis.com/fcm/send/token',
        credentials: { p256dh: 'bad', auth: 'bad' },
      }),
    ).toThrow(InvalidWebPushSubscriptionError);
  });
});
