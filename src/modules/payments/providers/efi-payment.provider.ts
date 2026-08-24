import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { Agent, request as httpsRequest, RequestOptions } from 'https';
import {
  EFI_PRODUCTION_BASE_URL,
  EFI_SANDBOX_BASE_URL,
} from '../payment.constants';
import { PaymentProviderName } from '../payment.enums';
import {
  mapEfiChargeStatus,
  mapEfiRefundStatus,
} from '../utils/payment-status.mapper';
import {
  CancelProviderPaymentInput,
  CreateProviderPaymentInput,
  FindProviderPaymentInput,
  PaymentProvider,
  PaymentProviderError,
  ProviderPaymentResult,
  ProviderRefundResult,
  RefundProviderPaymentInput,
} from './payment-provider.interface';

interface EfiTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface EfiPixEntry {
  endToEndId?: string;
  horario?: string;
  valor?: string;
  devolucoes?: Array<{ id?: string; status?: string; valor?: string }>;
}

interface EfiChargeResponse {
  status?: string;
  txid?: string;
  location?: string;
  loc?: { id?: number; location?: string };
  calendario?: { criacao?: string; expiracao?: number | string };
  pixCopiaECola?: string;
  pix?: EfiPixEntry[];
  [key: string]: unknown;
}

interface EfiQrResponse {
  qrcode?: string;
  imagemQrcode?: string;
  linkVisualizacao?: string;
  [key: string]: unknown;
}

interface EfiRefundResponse {
  id?: string;
  status?: string;
  valor?: string;
  [key: string]: unknown;
}

@Injectable()
export class EfiPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderName.Efi;

  private agent?: Agent;
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  async createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    if (input.currency !== 'BRL') {
      throw new PaymentProviderError(
        'Efí Pix solo admite BRL en este módulo',
        this.name,
      );
    }

    const pixKey = this.required('EFI_PIX_KEY');
    const chargeBody: Record<string, unknown> = {
      calendario: { expiracao: input.expiresInSeconds },
      valor: { original: input.amount.toFixed(2) },
      chave: pixKey,
      solicitacaoPagador:
        input.description?.slice(0, 140) || 'Pagamento de pedido de rifa',
    };

    if (input.payer && (input.payer.cpf || input.payer.cnpj)) {
      chargeBody.devedor = {
        nome: input.payer.name,
        ...(input.payer.cpf ? { cpf: input.payer.cpf } : {}),
        ...(input.payer.cnpj ? { cnpj: input.payer.cnpj } : {}),
      };
    }

    const charge = await this.apiRequest<EfiChargeResponse>(
      'PUT',
      `/v2/cob/${encodeURIComponent(input.txid)}`,
      chargeBody,
    );
    return this.toPaymentResult(charge);
  }

  async findPayment(
    input: FindProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    const charge = await this.apiRequest<EfiChargeResponse>(
      'GET',
      `/v2/cob/${encodeURIComponent(input.txid)}`,
    );
    return this.toPaymentResult(charge);
  }

  async cancelPayment(
    input: CancelProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    const charge = await this.apiRequest<EfiChargeResponse>(
      'PATCH',
      `/v2/cob/${encodeURIComponent(input.txid)}`,
      { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' },
    );
    return this.toPaymentResult(charge);
  }

  async refundPayment(
    input: RefundProviderPaymentInput,
  ): Promise<ProviderRefundResult> {
    const refundId = createHash('sha256')
      .update(input.idempotencyKey)
      .digest('hex')
      .slice(0, 30);
    const response = await this.apiRequest<EfiRefundResponse>(
      'PUT',
      `/v2/pix/${encodeURIComponent(input.endToEndId)}/devolucao/${refundId}`,
      { valor: input.amount.toFixed(2) },
    );
    return {
      providerRefundId: response.id ?? refundId,
      status: mapEfiRefundStatus(response.status),
      amount: Number(response.valor ?? input.amount),
      raw: response,
    };
  }

  private async toPaymentResult(
    charge: EfiChargeResponse,
  ): Promise<ProviderPaymentResult> {
    let qr: EfiQrResponse | undefined;
    if (charge.loc?.id) {
      qr = await this.apiRequest<EfiQrResponse>(
        'GET',
        `/v2/loc/${charge.loc.id}/qrcode`,
      );
    }
    const receivedPix = charge.pix?.[0];
    return {
      externalId: charge.loc?.id?.toString() ?? charge.txid,
      txid: charge.txid ?? '',
      endToEndId: receivedPix?.endToEndId,
      status: mapEfiChargeStatus(charge.status),
      qrCode: charge.location ?? charge.loc?.location,
      qrCodeImage: qr?.imagemQrcode,
      pixCopyPaste: qr?.qrcode ?? charge.pixCopiaECola,
      checkoutUrl: qr?.linkVisualizacao,
      paidAt: receivedPix?.horario ? new Date(receivedPix.horario) : undefined,
      raw: { charge, qr },
    };
  }

  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let token = await this.getAccessToken();
    try {
      return await this.rawRequest<T>(method, path, body, {
        Authorization: `Bearer ${token}`,
      });
    } catch (error) {
      if (
        !(error instanceof PaymentProviderError) ||
        error.statusCode !== 401
      ) {
        throw error;
      }
      this.accessToken = undefined;
      token = await this.getAccessToken();
      return this.rawRequest<T>(method, path, body, {
        Authorization: `Bearer ${token}`,
      });
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }
    const clientId = this.required('EFI_PIX_CLIENT_ID');
    const clientSecret = this.required('EFI_PIX_CLIENT_SECRET');
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const token = await this.rawRequest<EfiTokenResponse>(
      'POST',
      '/oauth/token',
      { grant_type: 'client_credentials' },
      { Authorization: `Basic ${basic}` },
    );
    if (!token.access_token) {
      throw new PaymentProviderError(
        'Efí no devolvió un access_token',
        this.name,
      );
    }
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt =
      Date.now() + Math.max(30, (token.expires_in ?? 300) - 60) * 1000;
    return this.accessToken;
  }

  private rawRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const url = new URL(path, this.baseUrl());
    const options: RequestOptions = {
      method,
      agent: this.getAgent(),
      minVersion: 'TLSv1.2',
      timeout: Number(this.config.get('EFI_PIX_TIMEOUT_MS') ?? 15000),
      headers: {
        Accept: 'application/json',
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload).toString(),
            }
          : {}),
        ...headers,
      },
    };

    return new Promise<T>((resolve, reject) => {
      const request = httpsRequest(url, options, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = undefined;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = { message: text };
            }
          }
          const statusCode = response.statusCode ?? 500;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new PaymentProviderError(
                `Efí respondió HTTP ${statusCode}`,
                this.name,
                statusCode,
                parsed,
              ),
            );
            return;
          }
          resolve((parsed ?? {}) as T);
        });
      });
      request.on('timeout', () =>
        request.destroy(new Error('Timeout consultando Efí Pix')),
      );
      request.on('error', (error) =>
        reject(
          error instanceof PaymentProviderError
            ? error
            : new PaymentProviderError(error.message, this.name),
        ),
      );
      if (payload) request.write(payload);
      request.end();
    });
  }

  private getAgent(): Agent {
    if (this.agent) return this.agent;
    const p12Path = this.config.get<string>('EFI_PIX_CERTIFICATE_PATH');
    const certPath = this.config.get<string>('EFI_PIX_CERT_PATH');
    const keyPath = this.config.get<string>('EFI_PIX_KEY_PATH');
    if (!p12Path && !(certPath && keyPath)) {
      throw new PaymentProviderError(
        'Configure EFI_PIX_CERTIFICATE_PATH (.p12) o EFI_PIX_CERT_PATH + EFI_PIX_KEY_PATH (PEM)',
        this.name,
      );
    }
    this.agent = new Agent({
      ...(p12Path
        ? {
            pfx: readFileSync(p12Path),
            passphrase: this.config.get<string>(
              'EFI_PIX_CERTIFICATE_PASSPHRASE',
            ),
          }
        : {
            cert: readFileSync(certPath!),
            key: readFileSync(keyPath!),
            passphrase: this.config.get<string>(
              'EFI_PIX_CERTIFICATE_PASSPHRASE',
            ),
          }),
      keepAlive: true,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    });
    return this.agent;
  }

  private baseUrl(): string {
    const override = this.config.get<string>('EFI_PIX_BASE_URL');
    if (override) return override;
    return this.isSandbox() ? EFI_SANDBOX_BASE_URL : EFI_PRODUCTION_BASE_URL;
  }

  private isSandbox(): boolean {
    const environment = (
      this.config.get<string>('EFI_PIX_ENV') ?? 'sandbox'
    ).toLowerCase();
    return ['sandbox', 'homologation', 'homologacao', 'test'].includes(
      environment,
    );
  }

  private required(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) {
      throw new PaymentProviderError(
        `Variable de entorno obligatoria ausente: ${name}`,
        this.name,
      );
    }
    return value;
  }
}
