import { registerDecorator, ValidationOptions } from 'class-validator';

export function isFeatureFlags(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.length <= 100 &&
    entries.every(
      ([key, flag]) =>
        /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) && typeof flag === 'boolean',
    )
  );
}

export function IsFeatureFlags(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isFeatureFlags',
      target: object.constructor,
      propertyName,
      options: {
        message:
          'featureFlags debe contener hasta 100 claves válidas con valores booleanos',
        ...validationOptions,
      },
      validator: { validate: isFeatureFlags },
    });
  };
}
