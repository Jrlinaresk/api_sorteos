# Payments (Pix / Efí)

Módulo independiente de pagos para los pedidos de campañas. El proveedor por
defecto es `mock`; ninguna llamada real se realiza hasta configurar
`PAYMENTS_PROVIDER=efi`.

## Integración requerida

1. Importar `PaymentsModule` en `AppModule` (o en el módulo raíz de comercio).
2. Hacer que `OrdersService` llame `PaymentsService.create()` después de reservar
   cuotas. La clave idempotente debe ser estable por pedido e intento.
3. Registrar callbacks idempotentes con
   `paymentsService.registerLifecycleHooks(...)`. En `onPaymentPaid`, confirmar la
   reserva y asignar las cuotas dentro de una operación atómica. En cancelación o
   expiración, liberar la reserva. En devolución, actualizar el pedido.
   Se pueden registrar varios listeners; cada módulo debe conservar la función de
   desregistro devuelta por el método.
4. Programar `expireDuePayments()` y usar `retryLifecycleHooks()` para pagos con
   callbacks pendientes (`lifecycleHookError`) desde el job de pedidos.
5. Las rutas `/payments/admin/**` usan JWT y `RolesGuard`: operaciones y
   administradores pueden consultar/conciliar; solo administradores pueden
   devolver o forzar transiciones manuales. No se usa una API key administrativa.
6. Configurar el proxy TLS para verificar el certificado cliente de Efí y eliminar
   cualquier cabecera mTLS enviada por Internet antes de inyectar
   `x-ssl-client-verify: SUCCESS`.

La consulta del frontend es `GET /api/v1/payments/:id` con el secreto en la
cabecera `X-Payment-Token`. Nunca debe enviarse en la URL o query string. El
secreto solo se devuelve al crear el pago y en la base se almacena únicamente su
hash.

## Variables

```dotenv
PAYMENTS_PROVIDER=mock
PAYMENTS_PUBLIC_SECRET_KEY=use-un-secreto-aleatorio-largo
CHECKOUT_ACCESS_SECRET_KEY=use-un-secreto-distinto-para-pedidos

# Efí
EFI_PIX_ENV=sandbox
EFI_PIX_CLIENT_ID=
EFI_PIX_CLIENT_SECRET=
EFI_PIX_KEY=
EFI_PIX_CERTIFICATE_PATH=/run/secrets/efi/certificate.p12
EFI_PIX_CERTIFICATE_PASSPHRASE=
# Alternativa PEM al .p12:
# EFI_PIX_CERT_PATH=/run/secrets/efi/certificate.pem
# EFI_PIX_KEY_PATH=/run/secrets/efi/private-key.pem
EFI_PIX_TIMEOUT_MS=15000

# Webhook: activar HMAC, mTLS o ambos en producción
EFI_WEBHOOK_HMAC=
EFI_WEBHOOK_REQUIRE_MTLS=true
EFI_WEBHOOK_MTLS_HEADER=x-ssl-client-verify
EFI_WEBHOOK_MTLS_SUCCESS_VALUE=SUCCESS
```

Si se usa el secreto HMAC, debe llegar exclusivamente en la cabecera
`x-efi-webhook-token`, normalmente inyectada por el proxy confiable. Nunca se
acepta en la URL: los query strings suelen terminar en logs, historiales y
herramientas de observabilidad. Con Efí, la opción preferida es mTLS en el proxy.

Para evitar que Efí agregue `/pix`, registrar la URL con `?ignorar=`. El
controller acepta tanto `/webhooks/efi` como `/webhooks/efi/pix`.

## Referencias oficiales consultadas

- Credenciales, OAuth2 y certificado mTLS:
  <https://dev.efipay.com.br/docs/api-pix/credenciais/>
- Cobranza inmediata con `txid` y cancelación:
  <https://dev.efipay.com.br/docs/api-pix/cobrancas-imediatas/>
- Generación del QR:
  <https://dev.efipay.com.br/docs/api-pix/payload-locations/>
- Recepción y configuración de webhooks:
  <https://dev.efipay.com.br/docs/api-pix/webhooks/>
- Devoluciones Pix:
  <https://dev.efipay.com.br/docs/api-pix/gestao-de-pix/>
- Estados oficiales:
  <https://dev.efipay.com.br/docs/api-pix/status/>
