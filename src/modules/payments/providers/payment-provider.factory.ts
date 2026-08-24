import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProviderName } from '../payment.enums';
import { EfiPaymentProvider } from './efi-payment.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentProvider } from './payment-provider.interface';

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly mock: MockPaymentProvider,
    private readonly efi: EfiPaymentProvider,
  ) {}

  get(provider?: PaymentProviderName): PaymentProvider {
    const selected =
      provider ??
      (this.config.get<string>('PAYMENTS_PROVIDER') as PaymentProviderName) ??
      PaymentProviderName.Mock;
    if (selected === PaymentProviderName.Mock) {
      if (
        this.config.get<string>('NODE_ENV') === 'production' &&
        this.config.get<string>('PAYMENTS_ALLOW_MOCK') !== 'true'
      ) {
        throw new ServiceUnavailableException(
          'El proveedor mock está deshabilitado en producción',
        );
      }
      return this.mock;
    }
    if (selected === PaymentProviderName.Efi) return this.efi;
    throw new BadRequestException(
      `Proveedor de pago no soportado: ${selected}`,
    );
  }
}
