export const PAYMENT_LIFECYCLE_HOOKS = Symbol('PAYMENT_LIFECYCLE_HOOKS');

export const DEFAULT_PAYMENT_EXPIRATION_SECONDS = 30 * 60;
export const MIN_PAYMENT_EXPIRATION_SECONDS = 60;
export const MAX_PAYMENT_EXPIRATION_SECONDS = 30 * 24 * 60 * 60;

export const EFI_PRODUCTION_BASE_URL = 'https://pix.api.efipay.com.br';
export const EFI_SANDBOX_BASE_URL = 'https://pix-h.api.efipay.com.br';
