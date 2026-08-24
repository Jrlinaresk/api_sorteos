import { registerDecorator, ValidationOptions } from 'class-validator';

export function MaxUtf8Bytes(
  maximumBytes: number,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: object.constructor,
      propertyName,
      constraints: [maximumBytes],
      options: {
        message: `La contraseña no puede superar ${maximumBytes} bytes UTF-8`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            Buffer.byteLength(value, 'utf8') <= maximumBytes
          );
        },
      },
    });
  };
}
