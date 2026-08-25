# Referrals: contrato e integración

## Seguridad HTTP

- `GET /referrals/resolve/:code` es público y sólo devuelve datos mínimos del código.
- `POST /referrals/clicks` es público, idempotente y tiene un límite local de 60 solicitudes/minuto por dirección hasheada. La IP y el user-agent se derivan de la petición; el cuerpo no puede falsificar `userId`, `ipHash` ni metadata. En despliegues con varias réplicas se debe sustituir el guard por un límite compartido (por ejemplo, Redis).
- `GET /referrals/me/**` exige JWT y toma siempre el beneficiario de `CurrentUser`.
- `/admin/referrals/**` exige rol `operator` o `admin`; cambiar estados de comisiones exige `admin`.
- Los presenters omiten metadata y datos de tracking sensibles; la vista de usuario también omite comprador, base y total de la orden.
- Cada click nuevo recibe `expiresAt`; Mongo lo elimina mediante TTL después de
  `REFERRAL_CLICK_RETENTION_DAYS` (180 por defecto, máximo 730). La comisión
  conserva su snapshot financiero aunque el dato de navegación caduque.

## Hook de atribución de órdenes

`ReferralsModule` exporta `ReferralAttributionService`. El módulo de órdenes debe llamarlo sólo después de validar y persistir una orden autoritativa:

```ts
await referralAttribution.attributeOrder({
  orderId: order.id,
  referralCode: checkout.referralCode,
  clickId: checkout.referralClickId,
  buyerUserId: order.userId,
  campaignId: order.campaignId,
  orderAmount: order.total,
  commissionBase: order.subtotal,
  currency: order.currency,
});
```

La operación es idempotente por `orderId`, comprueba campaña/moneda/autorreferencia y crea una comisión `pending`. Este método no se expone por HTTP.

Eventos recomendados para integración posterior:

- `order.created`: ejecutar `attributeOrder` una sola vez.
- `payment.approved`: aprobar la comisión según la política comercial.
- `payment.refunded` u `order.cancelled`: revertirla mediante el flujo administrativo/auditable.

Los cambios financieros posteriores deben conservar motivo y actor en el módulo de auditoría; este módulo no realiza pagos ni envía dinero.
